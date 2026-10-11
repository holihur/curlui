//go:build !core

package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/dynamicpb"

	"curlui/server/internal/grpcx"
	"curlui/server/internal/models"
	"curlui/server/internal/store"
)

// grpcDescriptor imports a protobuf descriptor set (.pb, base64) or fetches one
// via server reflection, persists it and returns the service catalogue.
func (s *Server) grpcDescriptor(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Descriptor string            `json:"descriptor"` // base64 .pb
		Name       string            `json:"name"`
		Target     string            `json:"target"`
		Plaintext  bool              `json:"plaintext"`
		Reflect    bool              `json:"reflect"`
		Metadata   []models.KeyValue `json:"metadata"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	db := s.db(r)
	md := keyValueMetadata(payload.Metadata)

	var (
		files  *protoregistry.Files
		id     string
		name   string
		source string
		raw    []byte
		err    error
	)

	if payload.Reflect {
		ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
		defer cancel()
		files, err = grpcx.Reflect(ctx, payload.Target, payload.Plaintext, md)
		if err != nil {
			writeErr(w, http.StatusBadGateway, err.Error())
			return
		}
		raw, err = grpcx.MarshalDescriptorSet(files)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		id = "reflect:" + payload.Target
		name = strings.TrimSpace(payload.Name)
		if name == "" {
			name = "reflection: " + payload.Target
		}
		source = "reflection"
	} else {
		if strings.TrimSpace(payload.Descriptor) == "" {
			writeErr(w, http.StatusBadRequest, "descriptor (.pb) is required")
			return
		}
		raw, err = grpcx.DecodeBase64(payload.Descriptor)
		if err != nil {
			writeErr(w, http.StatusBadRequest, "descriptor is not valid base64")
			return
		}
		files, err = grpcx.LoadDescriptorSet(raw)
		if err != nil {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		id = grpcx.DescriptorID(raw)
		name = strings.TrimSpace(payload.Name)
		if name == "" {
			name = "descriptor.pb"
		}
		source = "file"
	}

	grpcStore(id, files)
	_ = db.SaveDescriptor(store.GrpcDescriptor{
		ID: id, Name: name, Size: len(raw), Source: source,
		Target: payload.Target, UploadedAt: time.Now().UnixMilli(),
		Data: base64Encode(raw),
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"id": id, "name": name, "source": source, "services": grpcx.Services(files),
	})
}

// listGrpcDescriptors returns the stored .pb descriptors with their services.
func (s *Server) listGrpcDescriptors(w http.ResponseWriter, r *http.Request) {
	db := s.db(r)
	out := []map[string]any{}
	for _, d := range db.Descriptors() {
		files, ok := grpcFilesFor(d)
		if !ok {
			continue
		}
		out = append(out, map[string]any{
			"id": d.ID, "name": d.Name, "size": d.Size, "source": d.Source,
			"target": d.Target, "uploadedAt": d.UploadedAt,
			"services": grpcx.Services(files),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"descriptors": out})
}

// deleteGrpcDescriptor removes a stored descriptor.
func (s *Server) deleteGrpcDescriptor(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := s.db(r).DeleteDescriptor(id); err != nil {
		writeErr(w, http.StatusNotFound, err.Error())
		return
	}
	grpcForget(id)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// grpcCall invokes a unary RPC using a stored descriptor.
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
	db := s.db(r)
	d, ok := db.FindDescriptor(payload.ID)
	if !ok {
		writeErr(w, http.StatusBadRequest, "unknown descriptor; import a .pb file or use reflection first")
		return
	}
	files, ok := grpcFilesFor(d)
	if !ok {
		writeErr(w, http.StatusBadRequest, "stored descriptor could not be parsed")
		return
	}
	target := payload.Target
	if target == "" {
		target = d.Target
	}
	timeout := time.Duration(payload.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()

	res, err := grpcx.Invoke(ctx, files, target, payload.Service, payload.Method, payload.Body, payload.Plaintext, keyValueMetadata(payload.Metadata))
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// grpcExample returns a request skeleton for a method's input message.
func (s *Server) grpcExample(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ID      string `json:"id"`
		Service string `json:"service"`
		Method  string `json:"method"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	db := s.db(r)
	d, ok := db.FindDescriptor(payload.ID)
	if !ok {
		writeErr(w, http.StatusBadRequest, "unknown descriptor")
		return
	}
	files, ok := grpcFilesFor(d)
	if !ok {
		writeErr(w, http.StatusBadRequest, "stored descriptor could not be parsed")
		return
	}
	example, err := grpcx.ExampleJSON(files, payload.Service, payload.Method)
	if err != nil {
		writeErr(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"example": example})
}

// invokeGrpc executes a saved gRPC request and maps the result onto the normal
// response shape so it renders in the standard response panel.
func (s *Server) invokeGrpc(ctx context.Context, st *store.Store, req models.RequestDef) (models.Response, error) {
	g := req.Grpc
	if g == nil {
		return models.Response{}, fmt.Errorf("grpc: call configuration is missing")
	}
	d, ok := st.FindDescriptor(g.DescriptorID)
	if !ok {
		return models.Response{}, fmt.Errorf("grpc: descriptor not found — import it in the gRPC tab")
	}
	files, ok := grpcFilesFor(d)
	if !ok {
		return models.Response{}, fmt.Errorf("grpc: stored descriptor could not be parsed")
	}
	target := g.Target
	if target == "" {
		target = d.Target
	}
	start := time.Now()
	res, err := grpcx.Invoke(ctx, files, target, g.Service, g.Method, g.Body, g.Plaintext, keyValueMetadata(g.Metadata))
	if err != nil {
		return models.Response{
			StatusText: "ERROR", Error: err.Error(),
			Duration: time.Since(start).Milliseconds(),
			Request:  models.SentRequest{Method: "GRPC", URL: target + "/" + g.Service + "/" + g.Method},
		}, nil
	}

	status := 200
	body := res.Response
	if res.Code != "OK" {
		status = 502
		if res.Message != "" {
			body = res.Message
		}
	}
	headers := map[string][]string{}
	for k, v := range res.Headers {
		headers[k] = v
	}
	for k, v := range res.Trailers {
		headers["trailer:"+k] = v
	}
	return models.Response{
		Status: status, StatusText: res.Code, Body: body, ContentType: "application/json",
		Size: len(body), Duration: res.Duration, Timing: models.Timing{Total: res.Duration},
		Headers: headers,
		Request: models.SentRequest{Method: "GRPC", URL: target + "/" + g.Service + "/" + g.Method},
	}, nil
}

// --- descriptor cache ------------------------------------------------------

// grpcCache holds parsed descriptor registries (keyed by descriptor id).
var grpcCache = struct {
	sync.Mutex
	m map[string]*protoregistry.Files
}{m: map[string]*protoregistry.Files{}}

// grpcFilesFor returns the parsed registry for a stored descriptor, parsing and
// caching it on first use (so calls work after a restart).
func grpcFilesFor(d store.GrpcDescriptor) (*protoregistry.Files, bool) {
	grpcCache.Lock()
	if f, ok := grpcCache.m[d.ID]; ok {
		grpcCache.Unlock()
		return f, true
	}
	grpcCache.Unlock()

	raw, err := grpcx.DecodeBase64(d.Data)
	if err != nil {
		return nil, false
	}
	files, err := grpcx.LoadDescriptorSet(raw)
	if err != nil {
		return nil, false
	}
	grpcCache.Lock()
	grpcCache.m[d.ID] = files
	grpcCache.Unlock()
	return files, true
}

func grpcStore(id string, files *protoregistry.Files) {
	grpcCache.Lock()
	grpcCache.m[id] = files
	grpcCache.Unlock()
}

func grpcForget(id string) {
	grpcCache.Lock()
	defer grpcCache.Unlock()
	delete(grpcCache.m, id)
}

// registerGrpcRoutes mounts the gRPC endpoints (full build only).
// grpcStream runs a server/client/bidi streaming RPC and forwards every event
// (meta / message / status / error) to the browser as Server-Sent Events.
func (s *Server) grpcStream(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ID        string            `json:"id"`
		Target    string            `json:"target"`
		Service   string            `json:"service"`
		Method    string            `json:"method"`
		Messages  []string          `json:"messages"`
		Body      string            `json:"body"`
		Plaintext bool              `json:"plaintext"`
		Metadata  []models.KeyValue `json:"metadata"`
	}
	if err := decode(r, &payload); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "streaming is not supported by this connection")
		return
	}
	db := s.db(r)
	d, ok := db.FindDescriptor(payload.ID)
	if !ok {
		writeErr(w, http.StatusBadRequest, "unknown descriptor; import a .pb file or use reflection first")
		return
	}
	files, ok := grpcFilesFor(d)
	if !ok {
		writeErr(w, http.StatusBadRequest, "stored descriptor could not be parsed")
		return
	}
	target := payload.Target
	if target == "" {
		target = d.Target
	}
	msgs := payload.Messages
	if len(msgs) == 0 && strings.TrimSpace(payload.Body) != "" {
		msgs = []string{payload.Body}
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	send := func(ev grpcx.Event) {
		b, _ := json.Marshal(ev)
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
	}

	err := grpcx.Stream(r.Context(), files, target, payload.Service, payload.Method, msgs, payload.Plaintext, keyValueMetadata(payload.Metadata), send)
	if err != nil {
		send(grpcx.Event{Type: "error", Message: err.Error()})
	}
}

func (s *Server) registerGrpcRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/grpc/descriptor", s.grpcDescriptor)
	mux.HandleFunc("GET /api/grpc/descriptors", s.listGrpcDescriptors)
	mux.HandleFunc("DELETE /api/grpc/descriptors/{id}", s.deleteGrpcDescriptor)
	mux.HandleFunc("POST /api/grpc/example", s.grpcExample)
	mux.HandleFunc("POST /api/grpc/call", s.grpcCall)
	mux.HandleFunc("POST /api/grpc/stream", s.grpcStream)
}

func base64Encode(b []byte) string { return base64.StdEncoding.EncodeToString(b) }

func init() { wsGrpcHandler = grpcWSBridge }

// grpcWSBridge drives an interactive streaming RPC over the WebSocket bridge:
// the browser can send messages at any time while responses stream back.
func grpcWSBridge(ctx context.Context, st *store.Store, c *websocket.Conn, first wsFrame, write func(wsFrame) error) error {
	d, ok := st.FindDescriptor(first.DescriptorID)
	if !ok {
		return fmt.Errorf("unknown descriptor; import a .pb file or use reflection first")
	}
	files, ok := grpcFilesFor(d)
	if !ok {
		return fmt.Errorf("stored descriptor could not be parsed")
	}
	target := first.Target
	if target == "" {
		target = d.Target
	}
	desc, err := files.FindDescriptorByName(protoreflect.FullName(first.Service))
	if err != nil {
		return fmt.Errorf("service %q not found in descriptor", first.Service)
	}
	sd, ok := desc.(protoreflect.ServiceDescriptor)
	if !ok {
		return fmt.Errorf("%q is not a service", first.Service)
	}
	mdesc := sd.Methods().ByName(protoreflect.Name(first.Method))
	if mdesc == nil {
		return fmt.Errorf("method %q not found on %s", first.Method, first.Service)
	}
	if !mdesc.IsStreamingClient() && !mdesc.IsStreamingServer() {
		return fmt.Errorf("%s/%s is a unary method", first.Service, first.Method)
	}

	conn, err := grpcx.Dial(target, first.Plaintext)
	if err != nil {
		return err
	}
	defer conn.Close()

	streamDesc := &grpc.StreamDesc{
		StreamName:    first.Method,
		ServerStreams: mdesc.IsStreamingServer(),
		ClientStreams: mdesc.IsStreamingClient(),
	}
	sctx := ctx
	if len(first.Metadata) > 0 {
		md := metadata.MD{}
		for k, v := range first.Metadata {
			md.Append(k, v)
		}
		sctx = metadata.NewOutgoingContext(sctx, md)
	}
	stream, err := conn.NewStream(sctx, streamDesc, "/"+first.Service+"/"+first.Method)
	if err != nil {
		return err
	}
	_ = write(wsFrame{Type: "open"})

	done := make(chan struct{})
	go func() {
		defer close(done)
		if hdr, hErr := stream.Header(); hErr == nil && len(hdr) > 0 {
			_ = write(wsFrame{Type: "meta", HeaderMD: hdr})
		}
		for {
			resp := dynamicpb.NewMessage(mdesc.Output())
			err := stream.RecvMsg(resp)
			if err == io.EOF {
				_ = write(wsFrame{Type: "status", Code: "OK", Trailers: stream.Trailer()})
				_ = c.Close(websocket.StatusNormalClosure, "")
				return
			}
			if err != nil {
				stt, _ := status.FromError(err)
				_ = write(wsFrame{Type: "status", Code: stt.Code().String(), Reason: stt.Message(), Trailers: stream.Trailer()})
				_ = c.Close(websocket.StatusNormalClosure, "")
				return
			}
			js, mErr := protojson.MarshalOptions{Indent: "  ", EmitUnpopulated: true}.Marshal(resp)
			if mErr != nil {
				_ = write(wsFrame{Type: "error", Error: mErr.Error()})
				continue
			}
			_ = write(wsFrame{Type: "message", Data: string(js)})
		}
	}()

	for {
		select {
		case <-done:
			return nil
		default:
		}
		var f wsFrame
		if err := wsjson.Read(ctx, c, &f); err != nil {
			return nil
		}
		switch f.Type {
		case "send":
			msg := dynamicpb.NewMessage(mdesc.Input())
			if strings.TrimSpace(f.Data) != "" {
				if err := protojson.Unmarshal([]byte(f.Data), msg); err != nil {
					_ = write(wsFrame{Type: "error", Error: err.Error()})
					continue
				}
			}
			if err := stream.SendMsg(msg); err != nil {
				_ = write(wsFrame{Type: "error", Error: err.Error()})
			}
		case "end":
			_ = stream.CloseSend()
			_ = write(wsFrame{Type: "info", Reason: "half-closed"})
		case "close":
			return nil
		}
	}
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
