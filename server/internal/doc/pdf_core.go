//go:build core

package doc

import "fmt"

// RenderPDF is unavailable in the core build.
func RenderPDF(model Model) ([]byte, error) {
	return nil, fmt.Errorf("PDF export is not included in this core build")
}
