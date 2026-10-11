//go:build core

package main

import "curlui/server/internal/api"

// runMCPServer is unavailable in the core build.
func runMCPServer(apiServer *api.Server, version string, enabled bool) bool { return false }
