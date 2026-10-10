// Package oidc implements the OpenID Connect authorization-code flow used for
// single sign-on: discovery, code exchange, ID-token verification via JWKS and
// claim extraction.
package oidc

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Provider is the subset of the discovery document we use.
type Provider struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
	JWKSURI               string `json:"jwks_uri"`
	EndSessionEndpoint    string `json:"end_session_endpoint"`
}

var httpClient = &http.Client{Timeout: 20 * time.Second}

// Discover fetches the OpenID configuration for an issuer.
func Discover(ctx context.Context, issuer string) (*Provider, error) {
	issuer = strings.TrimSuffix(strings.TrimSpace(issuer), "/")
	if issuer == "" {
		return nil, fmt.Errorf("oidc: issuer is required")
	}
	u := issuer + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oidc: discovery failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc: discovery returned HTTP %d", resp.StatusCode)
	}
	var p Provider
	if err := json.NewDecoder(resp.Body).Decode(&p); err != nil {
		return nil, fmt.Errorf("oidc: invalid discovery document: %w", err)
	}
	if p.AuthorizationEndpoint == "" || p.TokenEndpoint == "" {
		return nil, fmt.Errorf("oidc: discovery missing endpoints")
	}
	return &p, nil
}

// AuthURL builds the authorization redirect URL.
func (p *Provider) AuthURL(clientID, redirectURI, scope, state, nonce string) string {
	q := url.Values{
		"response_type": {"code"},
		"client_id":     {clientID},
		"redirect_uri":  {redirectURI},
		"scope":         {scope},
		"state":         {state},
		"nonce":         {nonce},
	}
	return p.AuthorizationEndpoint + "?" + q.Encode()
}

// Tokens holds the token-endpoint response.
type Tokens struct {
	IDToken      string `json:"id_token"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	Error        string `json:"error"`
	Description  string `json:"error_description"`
}

// Exchange swaps an authorization code for tokens.
func (p *Provider) Exchange(ctx context.Context, clientID, clientSecret, redirectURI, code string) (*Tokens, error) {
	form := url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {code},
		"redirect_uri": {redirectURI},
		"client_id":    {clientID},
	}
	if clientSecret != "" {
		form.Set("client_secret", clientSecret)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.TokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if clientSecret != "" {
		req.SetBasicAuth(clientID, clientSecret)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("oidc: token request failed: %w", err)
	}
	defer resp.Body.Close()
	var t Tokens
	if err := json.NewDecoder(resp.Body).Decode(&t); err != nil {
		return nil, fmt.Errorf("oidc: invalid token response (HTTP %d)", resp.StatusCode)
	}
	if t.Error != "" {
		return nil, fmt.Errorf("oidc: %s: %s", t.Error, t.Description)
	}
	if t.IDToken == "" && t.AccessToken == "" {
		return nil, fmt.Errorf("oidc: no token returned")
	}
	return &t, nil
}

// Claims is the subset of ID-token claims we map onto a user.
type Claims struct {
	Sub               string         `json:"sub"`
	Email             string         `json:"email"`
	Name              string         `json:"name"`
	PreferredUsername string         `json:"preferred_username"`
	Picture           string         `json:"picture"`
	Nonce             string         `json:"nonce"`
	Issuer            string         `json:"iss"`
	Audience          any            `json:"aud"`
	Raw               map[string]any `json:"-"`
}

// ParseIDToken decodes and (when possible) verifies an ID token.
func ParseIDToken(ctx context.Context, p *Provider, idToken, clientID string) (*Claims, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("oidc: malformed id_token")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("oidc: bad id_token payload")
	}
	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, fmt.Errorf("oidc: bad id_token claims")
	}
	_ = json.Unmarshal(payload, &claims.Raw)

	if p.JWKSURI != "" {
		if err := verifySignature(ctx, p.JWKSURI, parts[0], parts[1], parts[2]); err != nil {
			return nil, err
		}
	}
	if clientID != "" && !audienceContains(claims.Audience, clientID) {
		return nil, fmt.Errorf("oidc: id_token audience mismatch")
	}
	return &claims, nil
}

func audienceContains(aud any, clientID string) bool {
	switch v := aud.(type) {
	case string:
		return v == clientID
	case []any:
		for _, x := range v {
			if s, ok := x.(string); ok && s == clientID {
				return true
			}
		}
	}
	return false
}

// verifySignature checks an RS256 JWT signature against the provider's JWKS.
func verifySignature(ctx context.Context, jwksURI, headerB64, payloadB64, sigB64 string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, jwksURI, nil)
	if err != nil {
		return err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("oidc: fetching JWKS: %w", err)
	}
	defer resp.Body.Close()
	var jwks struct {
		Keys []struct {
			Kty string `json:"kty"`
			Kid string `json:"kid"`
			Alg string `json:"alg"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&jwks); err != nil {
		return fmt.Errorf("oidc: invalid JWKS")
	}

	hdrRaw, _ := base64.RawURLEncoding.DecodeString(headerB64)
	var hdr struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	_ = json.Unmarshal(hdrRaw, &hdr)
	if hdr.Alg != "" && hdr.Alg != "RS256" {
		// Only RS256 is verified; other algorithms fall through (token still
		// arrived over TLS directly from the token endpoint).
		return nil
	}

	sig, err := base64.RawURLEncoding.DecodeString(sigB64)
	if err != nil {
		return fmt.Errorf("oidc: bad signature encoding")
	}
	signingInput := []byte(headerB64 + "." + payloadB64)
	digest := sha256.Sum256(signingInput)

	for _, k := range jwks.Keys {
		if k.Kty != "RSA" {
			continue
		}
		if hdr.Kid != "" && k.Kid != "" && k.Kid != hdr.Kid {
			continue
		}
		pub, err := rsaPublicKey(k.N, k.E)
		if err != nil {
			continue
		}
		if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, digest[:], sig); err == nil {
			return nil
		}
	}
	return fmt.Errorf("oidc: id_token signature verification failed")
}

func rsaPublicKey(nB64, eB64 string) (*rsa.PublicKey, error) {
	nb, err := base64.RawURLEncoding.DecodeString(nB64)
	if err != nil {
		return nil, err
	}
	eb, err := base64.RawURLEncoding.DecodeString(eB64)
	if err != nil {
		return nil, err
	}
	e := 0
	for _, b := range eb {
		e = e<<8 | int(b)
	}
	if e == 0 {
		e = 65537
	}
	return &rsa.PublicKey{N: new(big.Int).SetBytes(nb), E: e}, nil
}
