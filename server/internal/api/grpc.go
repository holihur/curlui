package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"google.golang.org/protobuf/reflect/protoregistry"

	"curlui/server/internal/grpcx"
	"curlui/server/internal/models"
)

// grpcDescriptor loads a protobuf descriptor set (.pb, base64) or fetches one
// from a server via reflection, caches it and returns the service catalogue.
func (s *Server) grpcDescriptor(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Descriptor string            `json:"descriptor"` // base64 .pb
		Target     string            `json:"target"`
		Plaintext  bool              `json:"plaintext"`
		Reflect    bool              `json:"reflect"`
		Metadata   []models.KeyValue `json:"metadata"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	var (
		id     string
		source string
	)
	md := keyValueMetadata(payload.Metadata)

	if payload.Reflect {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		loaded, err := grpcx.Reflect(ctx, payload.Target, payload.Plaintext, md)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		id = "reflect:" + payload.Target
		source = "reflection"
		s.grpcStore(id, loaded)
		writeJSON(w, http.StatusOK, map[string]any{
			"id": id, "source": source, "services": grpcx.Services(loaded),
		})
		return
	}

	if strings.TrimSpace(payload.Descriptor) == "" {
		writeErr(w, http.StatusBadRequest, "descriptor (.pb) is required")
		return
	}
	raw, err := grpcx.DecodeBase64(payload.Descriptor)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "descriptor is not valid base64")
		return
	}
	loaded, err := grpcx.LoadDescriptorSet(raw)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	id = grpcx.DescriptorID(raw)
	source = "file"
	s.grpcStore(id, loaded)
	writeJSON(w, http.StatusOK, map[string]any{
		"id": id, "source": source, "services": grpcx.Services(loaded),
	})
}

// grpcCall invokes a unary RPC using a previously loaded descriptor.
func (s *Server) grpcCall(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ID        string            `json:"id"`
		Target    string            `json:"target"`
		Service   string            `json:"service"`
		Method    string            `json:"method"`
		Body      string            `json:"body"`
		Plaintext bool              `json:"plaintext"`
		Metadata  []models.KeyValue `json:"metadata"`
		TimeoutMs int               `json:"timeoutMs"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	files, ok := s.grpcLoad(payload.ID)
	if !ok {
		writeErr(w, http.StatusBadRequest, "descriptor not loaded; import a .pb file or use reflection first")
		return
	}
	timeout := time.Duration(payload.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()

	res, err := grpcx.Invoke(ctx, files, payload.Target, payload.Service, payload.Method, payload.Body, payload.Plaintext, keyValueMetadata(payload.Metadata))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) grpcStore(id string, files *protoregistry.Files) {
	s.grpcMu.Lock()
	defer s.grpcMu.Unlock()
	if s.grpcFiles == nil {
		s.grpcFiles = map[string]*protoregistry.Files{}
	}
	s.grpcFiles[id] = files
}

func (s *Server) grpcLoad(id string) (*protoregistry.Files, bool) {
	s.grpcMu.Lock()
	defer s.grpcMu.Unlock()
	f, ok := s.grpcFiles[id]
	return f, ok
}

func keyValueMetadata(kvs []models.KeyValue) map[string][]string {
	if len(kvs) == 0 {
		return nil
	}
	out := map[string][]string{}
	for _, kv := range kvs {
		if !kv.Enabled || kv.Key == "" {
			continue
		}
		out[kv.Key] = append(out[kv.Key], kv.Value)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
