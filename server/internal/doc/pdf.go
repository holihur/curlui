//go:build !core

package doc

import (
	"bytes"
	"strings"

	"github.com/go-pdf/fpdf"
)

// RenderPDF renders the model to a simple PDF.
func RenderPDF(model Model) ([]byte, error) {
	pdf := fpdf.New("P", "mm", "A4", "")
	pdf.SetMargins(15, 15, 15)
	pdf.SetAutoPageBreak(true, 15)
	pdf.AddPage()

	pdf.SetFont("Helvetica", "B", 20)
	pdf.MultiCell(0, 10, model.Title, "", "L", false)
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(120, 120, 120)
	pdf.MultiCell(0, 5, "Generated "+model.GeneratedAt, "", "L", false)
	pdf.SetTextColor(0, 0, 0)

	for _, r := range model.Requests {
		pdf.Ln(3)
		pdf.SetFont("Helvetica", "B", 13)
		pdf.MultiCell(0, 6, r.Name, "", "L", false)
		pdf.SetFont("Courier", "B", 10)
		pdf.SetTextColor(29, 78, 216)
		pdf.MultiCell(0, 5, r.Method+" "+r.URL, "", "L", false)
		pdf.SetTextColor(0, 0, 0)

		if len(r.Params) > 0 || len(r.Headers) > 0 {
			pdf.SetFont("Helvetica", "", 9)
			for _, kv := range r.Params {
				pdf.MultiCell(0, 4.5, "  param  "+kv.Name+" = "+kv.Value, "", "L", false)
			}
			for _, kv := range r.Headers {
				pdf.MultiCell(0, 4.5, "  header "+kv.Name+": "+kv.Value, "", "L", false)
			}
		}
		if strings.TrimSpace(r.Body) != "" {
			pdf.Ln(1)
			pdf.SetFont("Courier", "", 9)
			pdf.MultiCell(0, 4.2, clamp(r.Body, 4000), "", "L", false)
		}
	}

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func clamp(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "\n…"
}
