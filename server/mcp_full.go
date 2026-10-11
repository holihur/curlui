//go:build !core

package main

import (
	"os"

	"curlui/server/internal/api"
	"curlui/server/internal/mcp"
)

// runMCPServer serves MCP over stdio and reports whether it took over.
func runMCPServer(apiServer *api.Server, version string, enabled bool) bool {
	if !enabled {
		return false
	}
	if err := mcp.Serve(os.Stdin, os.Stdout, version, apiServer); err != nil {
		panic(err)
	}
	return true
}
