//go:build core

package api

// buildVariant is the name of this build.
func buildVariant() string { return "core" }

// buildFeatures reports which optional subsystems are compiled in.
func buildFeatures() map[string]bool {
	return map[string]bool{
		"grpc":      false,
		"proxy":     true,
		"mcp":       true,
		"scheduler": true,
		"pdf":       false,
		"postgres":  true,
	}
}
