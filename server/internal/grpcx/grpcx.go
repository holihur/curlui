//go:build !core

// Package grpcx adds gRPC support: it loads protobuf descriptor sets (the
// output of `protoc --descriptor_set_out`, i.e. a .pb file), can fetch
// descriptors from a server via gRPC reflection, lists services/methods and
// invokes unary RPCs with a JSON request body.
package grpcx

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection/grpc_reflection_v1"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
)

// Method describes an RPC method.
type Method struct {
	Name      string `json:"name"`
	Input     string `json:"input"`
	Output    string `json:"output"`
	Streaming bool   `json:"streaming"`
}

// Service describes a gRPC service.
type Service struct {
	Name    string   `json:"name"`
	Package string   `json:"package,omitempty"`
	Methods []Method `json:"methods"`
}

// Result is the outcome of a unary call.
type Result struct {
	Response string              `json:"response"`
	Code     string              `json:"code"`
	Message  string              `json:"message,omitempty"`
	Headers  map[string][]string `json:"headers,omitempty"`
	Trailers map[string][]string `json:"trailers,omitempty"`
	Duration int64               `json:"duration"`
}

// DescriptorID is a stable id for a descriptor payload (used for caching).
func DescriptorID(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:16])
}

// DecodeBase64 accepts either raw base64 or a data: URL prefix.
func DecodeBase64(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if i := strings.Index(s, "base64,"); i >= 0 {
		s = s[i+len("base64,"):]
	}
	return base64.StdEncoding.DecodeString(s)
}

// LoadDescriptorSet parses a serialized FileDescriptorSet (.pb) or a single
// FileDescriptorProto.
func LoadDescriptorSet(data []byte) (*protoregistry.Files, error) {
	var set descriptorpb.FileDescriptorSet
	if err := proto.Unmarshal(data, &set); err != nil || len(set.File) == 0 {
		var single descriptorpb.FileDescriptorProto
		if err2 := proto.Unmarshal(data, &single); err2 != nil || single.GetName() == "" {
			return nil, fmt.Errorf("not a protobuf descriptor set (build one with: protoc --descriptor_set_out=api.pb --include_imports ...)")
		}
		set.File = []*descriptorpb.FileDescriptorProto{&single}
	}
	files, err := protodesc.NewFiles(&set)
	if err != nil {
		return nil, fmt.Errorf("invalid descriptor set (missing imports? use --include_imports): %w", err)
	}
	return files, nil
}

// MarshalDescriptorSet serialises a registry back into a FileDescriptorSet so
// descriptors fetched via reflection can be stored like an imported .pb.
func MarshalDescriptorSet(files *protoregistry.Files) ([]byte, error) {
	set := &descriptorpb.FileDescriptorSet{}
	files.RangeFiles(func(fd protoreflect.FileDescriptor) bool {
		set.File = append(set.File, protodesc.ToFileDescriptorProto(fd))
		return true
	})
	if len(set.File) == 0 {
		return nil, fmt.Errorf("no descriptors to serialise")
	}
	return proto.Marshal(set)
}

// ExampleJSON builds a request skeleton for a method from its input message.
func ExampleJSON(files *protoregistry.Files, service, method string) (string, error) {
	desc, err := files.FindDescriptorByName(protoreflect.FullName(service))
	if err != nil {
		return "", fmt.Errorf("service %q not found", service)
	}
	sd, ok := desc.(protoreflect.ServiceDescriptor)
	if !ok {
		return "", fmt.Errorf("%q is not a service", service)
	}
	md := sd.Methods().ByName(protoreflect.Name(method))
	if md == nil {
		return "", fmt.Errorf("method %q not found", method)
	}
	obj := exampleMessage(md.Input(), 0, map[protoreflect.FullName]bool{})
	b, err := json.MarshalIndent(obj, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func exampleMessage(md protoreflect.MessageDescriptor, depth int, seen map[protoreflect.FullName]bool) map[string]any {
	out := map[string]any{}
	if depth > 4 || seen[md.FullName()] {
		return out
	}
	seen[md.FullName()] = true
	fields := md.Fields()
	for i := 0; i < fields.Len(); i++ {
		fd := fields.Get(i)
		name := string(fd.JSONName())
		switch {
		case fd.IsMap():
			out[name] = map[string]any{}
		case fd.IsList():
			out[name] = []any{exampleValue(fd, depth, seen)}
		default:
			out[name] = exampleValue(fd, depth, seen)
		}
	}
	delete(seen, md.FullName())
	return out
}

func exampleValue(fd protoreflect.FieldDescriptor, depth int, seen map[protoreflect.FullName]bool) any {
	switch fd.Kind() {
	case protoreflect.MessageKind, protoreflect.GroupKind:
		if wk, ok := wellKnownExample(fd.Message().FullName()); ok {
			return wk
		}
		return exampleMessage(fd.Message(), depth+1, seen)
	case protoreflect.EnumKind:
		if fd.Enum().Values().Len() > 0 {
			return string(fd.Enum().Values().Get(0).Name())
		}
		return 0
	case protoreflect.BoolKind:
		return false
	case protoreflect.StringKind, protoreflect.BytesKind:
		return ""
	default:
		return 0
	}
}

func wellKnownExample(name protoreflect.FullName) (any, bool) {
	switch name {
	case "google.protobuf.Timestamp":
		return "1970-01-01T00:00:00Z", true
	case "google.protobuf.Duration":
		return "0s", true
	case "google.protobuf.FieldMask":
		return "", true
	case "google.protobuf.Struct", "google.protobuf.Value", "google.protobuf.Any",
		"google.protobuf.ListValue":
		return map[string]any{}, true
	case "google.protobuf.Empty":
		return map[string]any{}, true
	}
	if strings.HasPrefix(string(name), "google.protobuf.") {
		return "", true
	}
	return nil, false
}

// Services lists the services and methods in a descriptor registry.
func Services(files *protoregistry.Files) []Service {
	var out []Service
	files.RangeFiles(func(fd protoreflect.FileDescriptor) bool {
		svcs := fd.Services()
		for i := 0; i < svcs.Len(); i++ {
			sd := svcs.Get(i)
			svc := Service{Name: string(sd.Name()), Package: string(sd.ParentFile().Package())}
			methods := sd.Methods()
			for j := 0; j < methods.Len(); j++ {
				md := methods.Get(j)
				svc.Methods = append(svc.Methods, Method{
					Name:      string(md.Name()),
					Input:     string(md.Input().FullName()),
					Output:    string(md.Output().FullName()),
					Streaming: md.IsStreamingClient() || md.IsStreamingServer(),
				})
			}
			out = append(out, svc)
		}
		return true
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Dial opens a client connection to target.
func Dial(target string, plaintext bool) (*grpc.ClientConn, error) {
	if strings.TrimSpace(target) == "" {
		return nil, fmt.Errorf("target address is required (host:port)")
	}
	var creds credentials.TransportCredentials
	if plaintext {
		creds = insecure.NewCredentials()
	} else {
		creds = credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12})
	}
	conn, err := grpc.NewClient(target, grpc.WithTransportCredentials(creds))
	if err != nil {
		return nil, err
	}
	return conn, nil
}

// Reflect fetches the file descriptors for every service on a server using the
// gRPC server reflection protocol.
func Reflect(ctx context.Context, target string, plaintext bool, md map[string][]string) (*protoregistry.Files, error) {
	conn, err := Dial(target, plaintext)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if len(md) > 0 {
		ctx = metadata.NewOutgoingContext(ctx, metadata.MD(md))
	}
	client := grpc_reflection_v1.NewServerReflectionClient(conn)
	stream, err := client.ServerReflectionInfo(ctx)
	if err != nil {
		return nil, fmt.Errorf("reflection unavailable: %w", err)
	}
	defer stream.CloseSend()

	// 1. list services
	if err := stream.Send(&grpc_reflection_v1.ServerReflectionRequest{
		MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_ListServices{ListServices: "*"},
	}); err != nil {
		return nil, err
	}
	resp, err := stream.Recv()
	if err != nil {
		return nil, fmt.Errorf("reflection unavailable: %w", err)
	}
	list := resp.GetListServicesResponse()
	if list == nil {
		return nil, fmt.Errorf("reflection: unexpected response")
	}

	// 2. fetch descriptors per service (dependencies come along).
	seen := map[string]*descriptorpb.FileDescriptorProto{}
	for _, s := range list.GetService() {
		name := s.GetName()
		if strings.HasPrefix(name, "grpc.reflection.") {
			continue
		}
		if err := stream.Send(&grpc_reflection_v1.ServerReflectionRequest{
			MessageRequest: &grpc_reflection_v1.ServerReflectionRequest_FileContainingSymbol{FileContainingSymbol: name},
		}); err != nil {
			return nil, err
		}
		fdResp, err := stream.Recv()
		if err != nil {
			return nil, err
		}
		fileResp := fdResp.GetFileDescriptorResponse()
		if fileResp == nil {
			continue
		}
		for _, raw := range fileResp.GetFileDescriptorProto() {
			var fdp descriptorpb.FileDescriptorProto
			if err := proto.Unmarshal(raw, &fdp); err != nil {
				continue
			}
			seen[fdp.GetName()] = &fdp
		}
	}
	if len(seen) == 0 {
		return nil, fmt.Errorf("reflection returned no descriptors")
	}
	set := &descriptorpb.FileDescriptorSet{}
	for _, fdp := range seen {
		set.File = append(set.File, fdp)
	}
	files, err := protodesc.NewFiles(set)
	if err != nil {
		return nil, fmt.Errorf("reflection descriptors invalid: %w", err)
	}
	return files, nil
}

// Invoke performs a unary RPC.
func Invoke(ctx context.Context, files *protoregistry.Files, target, service, method, bodyJSON string, plaintext bool, md map[string][]string) (*Result, error) {
	conn, err := Dial(target, plaintext)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	desc, err := files.FindDescriptorByName(protoreflect.FullName(service))
	if err != nil {
		return nil, fmt.Errorf("service %q not found in descriptor", service)
	}
	sd, ok := desc.(protoreflect.ServiceDescriptor)
	if !ok {
		return nil, fmt.Errorf("%q is not a service", service)
	}
	mdesc := sd.Methods().ByName(protoreflect.Name(method))
	if mdesc == nil {
		return nil, fmt.Errorf("method %q not found on %s", method, service)
	}
	if mdesc.IsStreamingClient() || mdesc.IsStreamingServer() {
		return nil, fmt.Errorf("streaming methods are not supported yet")
	}

	reqMsg := dynamicpb.NewMessage(mdesc.Input())
	if strings.TrimSpace(bodyJSON) != "" {
		if err := protojson.Unmarshal([]byte(bodyJSON), reqMsg); err != nil {
			return nil, fmt.Errorf("request JSON does not match %s: %w", mdesc.Input().FullName(), err)
		}
	}
	respMsg := dynamicpb.NewMessage(mdesc.Output())

	var headers, trailers metadata.MD
	if len(md) > 0 {
		ctx = metadata.NewOutgoingContext(ctx, metadata.MD(md))
	}
	start := time.Now()
	err = conn.Invoke(ctx, "/"+service+"/"+method, reqMsg, respMsg, grpc.Header(&headers), grpc.Trailer(&trailers))
	elapsed := time.Since(start).Milliseconds()

	out := &Result{
		Duration: elapsed,
		Code:     status.Code(err).String(),
		Headers:  headers,
		Trailers: trailers,
	}
	if err != nil {
		st, _ := status.FromError(err)
		out.Message = st.Message()
	}
	js, mErr := protojson.MarshalOptions{Indent: "  ", EmitUnpopulated: true}.Marshal(respMsg)
	if mErr != nil {
		return out, fmt.Errorf("cannot render response: %w", mErr)
	}
	out.Response = string(js)
	if err != nil && out.Message == "" {
		out.Message = err.Error()
	}
	return out, nil
}
