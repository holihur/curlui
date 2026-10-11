//go:build core

package api

// buildVariant is the name of this build.
func buildVariant() string { return "core" }

// buildFeatures reports which optional subsystems are compiled in.
func buildFeatures() map[string]bool {
	return map[string]bool{
		"grpc":      false,
		"proxy":     false,
		"mcp":       false,
		"scheduler": false,
		"pdf":       false,
		"openapi":   false,
		"doc":       false,
		"postgres":  false,
		"auth":      false,
		"feedback":  true,
		"ai":        false,
	}
}
