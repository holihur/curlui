package curl

import (
	"context"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"curlui/server/internal/models"
)

// applyRequestAuth applies the configured authentication to the outgoing
// request. It may perform a network round-trip (OAuth2 token, Digest is handled
// after the first 401).
func (e *Executor) applyRequestAuth(ctx context.Context, client *http.Client, def *models.RequestDef, method string, header http.Header, finalURL *string, payload []byte) error {
	a := def.Auth
	switch strings.ToLower(a.Type) {
	case "basic":
		header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(a.Username+":"+a.Password)))
	case "bearer":
		if a.Token != "" {
			header.Set("Authorization", "Bearer "+a.Token)
		}
	case "apikey":
		if a.Key == "" {
			return nil
		}
		if a.AddTo == "query" {
			u, err := url.Parse(*finalURL)
			if err != nil {
				return err
			}
			q := u.Query()
			q.Set(a.Key, a.Value)
			u.RawQuery = q.Encode()
			*finalURL = u.String()
		} else {
			header.Set(a.Key, a.Value)
		}
	case "oauth2":
		token, err := fetchOAuth2Token(ctx, client, a)
		if err != nil {
			return err
		}
		header.Set("Authorization", "Bearer "+token)
	case "jwt":
		token, err := signJWT(a)
		if err != nil {
			return err
		}
		header.Set("Authorization", "Bearer "+token)
	case "aws":
		return signAWSV4(method, *finalURL, header, payload, a, time.Now())
	case "digest":
		// Handled after the server sends its challenge.
	}
	return nil
}

// --- OAuth2 ----------------------------------------------------------------

func fetchOAuth2Token(ctx context.Context, client *http.Client, a models.Auth) (string, error) {
	if a.TokenURL == "" {
		return "", fmt.Errorf("oauth2: token URL is required")
	}
	form := url.Values{}
	switch a.GrantType {
	case "password":
		form.Set("grant_type", "password")
		form.Set("username", a.Username)
		form.Set("password", a.Password)
	case "refresh_token":
		form.Set("grant_type", "refresh_token")
		form.Set("refresh_token", a.RefreshToken)
	default:
		form.Set("grant_type", "client_credentials")
	}
	if a.Scope != "" {
		form.Set("scope", a.Scope)
	}
	if a.ClientAuth == "body" {
		form.Set("client_id", a.ClientID)
		form.Set("client_secret", a.ClientSecret)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if a.ClientAuth != "body" {
		req.SetBasicAuth(a.ClientID, a.ClientSecret)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("oauth2 token request failed: %w", err)
	}
	defer resp.Body.Close()
	var out struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		Error       string `json:"error"`
		Description string `json:"error_description"`
	}
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(&out); err != nil {
		return "", fmt.Errorf("oauth2: invalid token response (%d)", resp.StatusCode)
	}
	if out.AccessToken == "" {
		msg := out.Error
		if out.Description != "" {
			msg += ": " + out.Description
		}
		if msg == "" {
			msg = fmt.Sprintf("no access_token (HTTP %d)", resp.StatusCode)
		}
		return "", fmt.Errorf("oauth2: %s", msg)
	}
	return out.AccessToken, nil
}

// --- JWT (HMAC) ------------------------------------------------------------

func signJWT(a models.Auth) (string, error) {
	alg := a.JWTAlg
	if alg == "" {
		alg = "HS256"
	}
	var newHash func() hash.Hash
	switch alg {
	case "HS256":
		newHash = sha256.New
	case "HS384":
		newHash = sha512.New384
	case "HS512":
		newHash = sha512.New
	default:
		return "", fmt.Errorf("jwt: unsupported algorithm %q (use HS256/HS384/HS512)", alg)
	}

	claims := map[string]any{}
	if strings.TrimSpace(a.JWTClaims) != "" {
		if err := json.Unmarshal([]byte(a.JWTClaims), &claims); err != nil {
			return "", fmt.Errorf("jwt: invalid claims JSON: %w", err)
		}
	}
	now := time.Now()
	if _, ok := claims["iat"]; !ok {
		claims["iat"] = now.Unix()
	}
	if _, ok := claims["exp"]; !ok {
		claims["exp"] = now.Add(time.Hour).Unix()
	}

	headerJSON, _ := json.Marshal(map[string]string{"alg": alg, "typ": "JWT"})
	claimsJSON, _ := json.Marshal(claims)
	b64 := base64.RawURLEncoding
	signingInput := b64.EncodeToString(headerJSON) + "." + b64.EncodeToString(claimsJSON)
	h := hmac.New(newHash, []byte(a.JWTSecret))
	h.Write([]byte(signingInput))
	return signingInput + "." + b64.EncodeToString(h.Sum(nil)), nil
}

// --- AWS Signature v4 ------------------------------------------------------

func signAWSV4(method, rawURL string, header http.Header, payload []byte, a models.Auth, now time.Time) error {
	if a.AWSAccessKey == "" || a.AWSSecretKey == "" {
		return fmt.Errorf("aws: access key and secret key are required")
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return err
	}
	region := a.AWSRegion
	if region == "" {
		region = "us-east-1"
	}
	service := a.AWSService
	if service == "" {
		service = "execute-api"
	}

	amzDate := now.UTC().Format("20060102T150405Z")
	dateStamp := now.UTC().Format("20060102")
	payloadHash := sha256Hex(payload)

	header.Set("X-Amz-Date", amzDate)
	header.Set("X-Amz-Content-Sha256", payloadHash)
	if a.AWSSessionToken != "" {
		header.Set("X-Amz-Security-Token", a.AWSSessionToken)
	}

	lower := map[string]string{"host": u.Host}
	for k, v := range header {
		lk := strings.ToLower(k)
		if lk == "authorization" || lk == "user-agent" || lk == "accept-encoding" {
			continue
		}
		lower[lk] = strings.Join(v, ", ")
	}
	keys := make([]string, 0, len(lower))
	for k := range lower {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var canonicalHeaders strings.Builder
	for _, k := range keys {
		canonicalHeaders.WriteString(k)
		canonicalHeaders.WriteString(":")
		canonicalHeaders.WriteString(strings.Join(strings.Fields(lower[k]), " "))
		canonicalHeaders.WriteString("\n")
	}
	signedHeaders := strings.Join(keys, ";")

	canonicalURI := u.EscapedPath()
	if canonicalURI == "" {
		canonicalURI = "/"
	}
	canonicalQuery := awsQueryEncode(u.Query())

	canonicalRequest := strings.Join([]string{
		method, canonicalURI, canonicalQuery, canonicalHeaders.String(), signedHeaders, payloadHash,
	}, "\n")

	scope := strings.Join([]string{dateStamp, region, service, "aws4_request"}, "/")
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256", amzDate, scope, sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	kDate := hmacSHA256([]byte("AWS4"+a.AWSSecretKey), dateStamp)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, service)
	kSigning := hmacSHA256(kService, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(kSigning, stringToSign))

	header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		a.AWSAccessKey, scope, signedHeaders, signature))
	return nil
}

// awsQueryEncode encodes query values with RFC 3986 rules (space as %20).
func awsQueryEncode(values url.Values) string {
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		vs := append([]string(nil), values[k]...)
		sort.Strings(vs)
		for _, v := range vs {
			if b.Len() > 0 {
				b.WriteByte('&')
			}
			b.WriteString(awsEscape(k))
			b.WriteByte('=')
			b.WriteString(awsEscape(v))
		}
	}
	return b.String()
}

func awsEscape(s string) string {
	return strings.ReplaceAll(url.QueryEscape(s), "+", "%20")
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

// --- Digest ----------------------------------------------------------------

var digestRe = regexp.MustCompile(`(\w+)=(?:"([^"]*)"|([^,\s]+))`)

func parseDigestChallenge(v string) map[string]string {
	v = strings.TrimSpace(v)
	if i := strings.Index(strings.ToLower(v), "digest"); i >= 0 {
		v = v[i+len("digest"):]
	}
	out := map[string]string{}
	for _, m := range digestRe.FindAllStringSubmatch(v, -1) {
		val := m[2]
		if val == "" {
			val = m[3]
		}
		out[strings.ToLower(m[1])] = val
	}
	return out
}

// digestAuthorization builds the Authorization header for an MD5 Digest
// challenge (qop=auth or legacy without qop).
func digestAuthorization(a models.Auth, method, uri string, ch map[string]string) string {
	realm := ch["realm"]
	nonce := ch["nonce"]
	qop := ch["qop"]
	if strings.Contains(qop, ",") {
		qop = "auth"
	}
	ha1 := md5Hex(a.Username + ":" + realm + ":" + a.Password)
	ha2 := md5Hex(method + ":" + uri)

	parts := []string{
		fmt.Sprintf(`username="%s"`, a.Username),
		fmt.Sprintf(`realm="%s"`, realm),
		fmt.Sprintf(`nonce="%s"`, nonce),
		fmt.Sprintf(`uri="%s"`, uri),
	}
	if qop != "" {
		nc := "00000001"
		cnonce := randomHex(8)
		response := md5Hex(ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":" + qop + ":" + ha2)
		parts = append(parts,
			fmt.Sprintf(`response="%s"`, response),
			"qop="+qop,
			"nc="+nc,
			fmt.Sprintf(`cnonce="%s"`, cnonce),
		)
	} else {
		parts = append(parts, fmt.Sprintf(`response="%s"`, md5Hex(ha1+":"+nonce+":"+ha2)))
	}
	if opaque := ch["opaque"]; opaque != "" {
		parts = append(parts, fmt.Sprintf(`opaque="%s"`, opaque))
	}
	if alg := ch["algorithm"]; alg != "" {
		parts = append(parts, "algorithm="+alg)
	}
	return "Digest " + strings.Join(parts, ", ")
}

func md5Hex(s string) string {
	sum := md5.Sum([]byte(s))
	return hex.EncodeToString(sum[:])
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
