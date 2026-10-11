//go:build !core

package api

// buildVariant is the name of this build.
func buildVariant() string { return "full" }

// buildFeatures reports which optional subsystems are compiled in.
func buildFeatures() map[string]bool {
	return map[string]bool{
		"grpc":      true,
		"proxy":     true,
		"mcp":       true,
		"scheduler": true,
		"pdf":       true,
		"openapi":   true,
		"doc":       true,
		"postgres":  true,
		"auth":      true,
		"feedback":  true,
		"ai":        true,
	}
}
