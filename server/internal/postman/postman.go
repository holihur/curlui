// Package postman converts between Postman Collection v2.1 documents and the
// curlui node tree, so existing collections can be imported and exported.
package postman

import (
	"encoding/json"
	"fmt"
	"strings"

	"curlui/server/internal/models"
)

// --- Postman v2.1 document -------------------------------------------------

type doc struct {
	Info struct {
		Name   string `json:"name"`
		Schema string `json:"schema"`
	} `json:"info"`
	Item     []item     `json:"item"`
	Variable []variable `json:"variable"`
	Auth     *auth      `json:"auth"`
}

type item struct {
	Name    string   `json:"name"`
	Item    []item   `json:"item"`
	Request *request `json:"request"`
	Event   []any    `json:"event"`
}

type request struct {
	Method string   `json:"method"`
	Header []kv     `json:"header"`
	Body   *body    `json:"body"`
	URL    urlField `json:"url"`
	Auth   *auth    `json:"auth"`
}

type urlField struct {
	Raw      string   `json:"raw"`
	Protocol string   `json:"protocol"`
	Host     []string `json:"host"`
	Path     []string `json:"path"`
	Query    []kv     `json:"query"`
}

type kv struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	Disabled bool   `json:"disabled"`
	Type     string `json:"type"`
	Src      string `json:"src"`
}

type body struct {
	Mode       string `json:"mode"`
	Raw        string `json:"raw"`
	URLEncoded []kv   `json:"urlencoded"`
	FormData   []kv   `json:"formdata"`
	Options    struct {
		Raw struct {
			Language string `json:"language"`
		} `json:"raw"`
	} `json:"options"`
}

type variable struct {
	Key   string `json:"key"`
	Value string `json:"value"`
	Type  string `json:"type"`
}

type auth struct {
	Type   string `json:"type"`
	Basic  []kv   `json:"basic"`
	Bearer []kv   `json:"bearer"`
	APIKey []kv   `json:"apikey"`
	OAuth2 []kv   `json:"oauth2"`
}

func kvValue(list []kv, key string) string {
	for _, e := range list {
		if strings.EqualFold(e.Key, key) {
			return e.Value
		}
	}
	return ""
}

// --- Parse -----------------------------------------------------------------

// Parse converts a Postman Collection v2.1 document into curlui nodes. The
// result is a single folder (named after the collection) so collection-level
// variables are preserved.
func Parse(data []byte) ([]*models.Node, error) {
	var d doc
	if err := json.Unmarshal(data, &d); err != nil {
		return nil, fmt.Errorf("not a valid Postman collection: %w", err)
	}
	if len(d.Item) == 0 && d.Info.Name == "" {
		return nil, fmt.Errorf("no items found in collection")
	}

	root := &models.Node{
		ID:   models.NewID(),
		Type: "folder",
		Name: d.Info.Name,
	}
	if root.Name == "" {
		root.Name = "Imported Postman collection"
	}
	for _, v := range d.Variable {
		if v.Key == "" {
			continue
		}
		root.Variables = append(root.Variables, models.KeyValue{
			ID: models.NewID(), Key: v.Key, Value: v.Value, Enabled: true,
		})
	}
	for _, it := range d.Item {
		root.Children = append(root.Children, convertItem(it, d.Auth))
	}
	return []*models.Node{root}, nil
}

func convertItem(it item, inherited *auth) *models.Node {
	// A folder has children and no request.
	if it.Request == nil {
		node := &models.Node{ID: models.NewID(), Type: "folder", Name: it.Name}
		if node.Name == "" {
			node.Name = "Folder"
		}
		for _, c := range it.Item {
			node.Children = append(node.Children, convertItem(c, inherited))
		}
		return node
	}

	req := &models.RequestDef{
		ID:      models.NewID(),
		Name:    it.Name,
		Method:  strings.ToUpper(it.Request.Method),
		Headers: []models.KeyValue{},
		Params:  []models.KeyValue{},
		Body:    models.Body{Type: "none", Form: []models.KeyValue{}},
		Auth:    models.Auth{Type: "none", AddTo: "header"},
		Options: models.Options{Timeout: 30000, FollowRedirects: true, VerifyTLS: true, MaxRedirects: 10},
	}
	if req.Method == "" {
		req.Method = "GET"
	}

	// URL + query params.
	u := it.Request.URL
	raw := u.Raw
	if raw == "" {
		scheme := u.Protocol
		if scheme == "" {
			scheme = "https"
		}
		host := strings.Join(u.Host, ".")
		path := strings.Join(u.Path, "/")
		raw = scheme + "://" + host + "/" + path
	}
	if i := strings.Index(raw, "?"); i >= 0 {
		raw = raw[:i]
	}
	req.URL = strings.ReplaceAll(raw, " ", "%20")
	for _, q := range u.Query {
		if q.Disabled || q.Key == "" {
			continue
		}
		req.Params = append(req.Params, models.KeyValue{ID: models.NewID(), Key: q.Key, Value: q.Value, Enabled: true})
	}

	// Headers.
	for _, h := range it.Request.Header {
		if h.Disabled || h.Key == "" {
			continue
		}
		req.Headers = append(req.Headers, models.KeyValue{ID: models.NewID(), Key: h.Key, Value: h.Value, Enabled: true})
	}

	// Body.
	if b := it.Request.Body; b != nil {
		switch b.Mode {
		case "raw":
			req.Body.Type = "raw"
			if strings.Contains(strings.ToLower(b.Options.Raw.Language), "json") {
				req.Body.Type = "json"
			}
			req.Body.Raw = b.Raw
		case "urlencoded":
			req.Body.Type = "form"
			for _, f := range b.URLEncoded {
				if f.Key == "" {
					continue
				}
				req.Body.Form = append(req.Body.Form, models.KeyValue{ID: models.NewID(), Key: f.Key, Value: f.Value, Enabled: !f.Disabled})
			}
		case "formdata":
			req.Body.Type = "form"
			for _, f := range b.FormData {
				if f.Key == "" {
					continue
				}
				req.Body.Form = append(req.Body.Form, models.KeyValue{ID: models.NewID(), Key: f.Key, Value: f.Value, Enabled: !f.Disabled, Type: "text"})
			}
		}
	}

	// Auth (request-level overrides collection-level).
	a := it.Request.Auth
	if a == nil {
		a = inherited
	}
	req.Auth = convertAuth(a)

	return &models.Node{ID: models.NewID(), Type: "request", Name: it.Name, Request: req}
}

func convertAuth(a *auth) models.Auth {
	if a == nil {
		return models.Auth{Type: "none", AddTo: "header"}
	}
	switch strings.ToLower(a.Type) {
	case "bearer":
		return models.Auth{Type: "bearer", Token: kvValue(a.Bearer, "token")}
	case "basic":
		return models.Auth{Type: "basic", Username: kvValue(a.Basic, "username"), Password: kvValue(a.Basic, "password")}
	case "apikey":
		in := kvValue(a.APIKey, "in")
		addTo := "header"
		if in == "query" {
			addTo = "query"
		}
		return models.Auth{Type: "apikey", Key: kvValue(a.APIKey, "key"), Value: kvValue(a.APIKey, "value"), AddTo: addTo}
	case "oauth2":
		grant := kvValue(a.OAuth2, "grant_type")
		if grant == "" {
			grant = "client_credentials"
		}
		return models.Auth{
			Type:         "oauth2",
			GrantType:    grant,
			TokenURL:     kvValue(a.OAuth2, "accessTokenUrl"),
			AuthURL:      kvValue(a.OAuth2, "authUrl"),
			ClientID:     kvValue(a.OAuth2, "clientId"),
			ClientSecret: kvValue(a.OAuth2, "clientSecret"),
			Scope:        kvValue(a.OAuth2, "scope"),
		}
	}
	return models.Auth{Type: "none", AddTo: "header"}
}

// --- Export ----------------------------------------------------------------

type exportDoc struct {
	Info struct {
		Name   string `json:"name"`
		Schema string `json:"schema"`
	} `json:"info"`
	Item     []any      `json:"item"`
	Variable []variable `json:"variable,omitempty"`
}

// Export converts curlui nodes into a Postman Collection v2.1 document.
func Export(name string, nodes []*models.Node) ([]byte, error) {
	d := exportDoc{}
	d.Info.Name = name
	if d.Info.Name == "" {
		d.Info.Name = "curlui export"
	}
	d.Info.Schema = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"

	// If the tree is a single folder, lift its variables and children.
	if len(nodes) == 1 && nodes[0].Type == "folder" {
		if nodes[0].Name != "" {
			d.Info.Name = nodes[0].Name
		}
		for _, v := range nodes[0].Variables {
			d.Variable = append(d.Variable, variable{Key: v.Key, Value: v.Value, Type: "string"})
		}
		for _, c := range nodes[0].Children {
			d.Item = append(d.Item, exportNode(c))
		}
	} else {
		for _, n := range nodes {
			d.Item = append(d.Item, exportNode(n))
		}
	}
	return json.MarshalIndent(d, "", "  ")
}

func exportNode(n *models.Node) any {
	if n.Type == "folder" || n.Request == nil {
		folder := map[string]any{"name": n.Name}
		items := []any{}
		for _, c := range n.Children {
			items = append(items, exportNode(c))
		}
		folder["item"] = items
		return folder
	}

	req := n.Request
	headers := []map[string]any{}
	for _, h := range req.Headers {
		headers = append(headers, map[string]any{"key": h.Key, "value": h.Value, "disabled": !h.Enabled})
	}
	query := []map[string]any{}
	for _, p := range req.Params {
		query = append(query, map[string]any{"key": p.Key, "value": p.Value, "disabled": !p.Enabled})
	}

	urlObj := map[string]any{"raw": req.URL}
	if len(query) > 0 {
		urlObj["query"] = query
	}

	pmReq := map[string]any{
		"method": strings.ToUpper(req.Method),
		"header": headers,
		"url":    urlObj,
	}

	switch req.Body.Type {
	case "json", "raw", "xml":
		pmReq["body"] = map[string]any{
			"mode": "raw",
			"raw":  req.Body.Raw,
			"options": map[string]any{
				"raw": map[string]any{"language": map[bool]string{true: "json", false: "text"}[req.Body.Type == "json"]},
			},
		}
	case "form":
		form := []map[string]any{}
		for _, f := range req.Body.Form {
			form = append(form, map[string]any{"key": f.Key, "value": f.Value, "disabled": !f.Enabled})
		}
		pmReq["body"] = map[string]any{"mode": "urlencoded", "urlencoded": form}
	}

	if a := exportAuth(req.Auth); a != nil {
		pmReq["auth"] = a
	}

	return map[string]any{"name": n.Name, "request": pmReq}
}

func exportAuth(a models.Auth) map[string]any {
	entry := func(k, v string) map[string]any { return map[string]any{"key": k, "value": v, "type": "string"} }
	switch strings.ToLower(a.Type) {
	case "bearer":
		return map[string]any{"type": "bearer", "bearer": []map[string]any{entry("token", a.Token)}}
	case "basic":
		return map[string]any{"type": "basic", "basic": []map[string]any{entry("username", a.Username), entry("password", a.Password)}}
	case "apikey":
		in := "header"
		if a.AddTo == "query" {
			in = "query"
		}
		return map[string]any{"type": "apikey", "apikey": []map[string]any{entry("key", a.Key), entry("value", a.Value), entry("in", in)}}
	case "oauth2":
		return map[string]any{"type": "oauth2", "oauth2": []map[string]any{
			entry("grant_type", a.GrantType),
			entry("accessTokenUrl", a.TokenURL),
			entry("authUrl", a.AuthURL),
			entry("clientId", a.ClientID),
			entry("clientSecret", a.ClientSecret),
			entry("scope", a.Scope),
		}}
	}
	return nil
}
