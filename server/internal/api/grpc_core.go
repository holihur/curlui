//go:build core

package api

import (
	"context"
	"fmt"
	"net/http"

	"curlui/server/internal/models"
	"curlui/server/internal/store"
)

// registerGrpcRoutes is a no-op in the core build (gRPC is not included).
func (s *Server) registerGrpcRoutes(mux *http.ServeMux) {}

// invokeGrpc is unavailable in the core build.
func (s *Server) invokeGrpc(ctx context.Context, st *store.Store, req models.RequestDef) (models.Response, error) {
	return models.Response{}, fmt.Errorf("gRPC support is not included in this build")
}
