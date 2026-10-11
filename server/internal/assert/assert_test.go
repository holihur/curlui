package assert

import (
	"testing"

	"curlui/server/internal/models"
)

func resp() *models.Response {
	return &models.Response{
		Status:   200,
		Headers:  map[string][]string{"Content-Type": {"application/json"}},
		Body:     `{"id":5,"name":"rex"}`,
		Duration: 120,
		Size:     20,
	}
}

func TestEvaluate(t *testing.T) {
	rules := []models.Assertion{
		{Enabled: true, Source: "status", Operator: "eq", Value: "200"},
		{Enabled: true, Source: "time", Operator: "lt", Value: "500"},
		{Enabled: true, Source: "header", Key: "Content-Type", Operator: "contains", Value: "json"},
		{Enabled: true, Source: "body", Operator: "contains", Value: "rex"},
		{Enabled: true, Source: "jsonpath", Key: "$.id", Operator: "eq", Value: "5"},
	}
	got := Evaluate(resp(), rules)
	if len(got) != len(rules) {
		t.Fatalf("got %d results, want %d", len(got), len(rules))
	}
	for i, r := range got {
		if !r.Passed {
			t.Errorf("rule %d failed: %s", i, r.Message)
		}
	}
}

func TestEvaluateFailures(t *testing.T) {
	rules := []models.Assertion{
		{Enabled: true, Source: "status", Operator: "eq", Value: "404"},
		{Enabled: true, Source: "jsonpath", Key: "$.id", Operator: "gt", Value: "100"},
		{Enabled: true, Source: "body", Operator: "contains", Value: "absent"},
	}
	for i, r := range Evaluate(resp(), rules) {
		if r.Passed {
			t.Errorf("expected rule %d to fail", i)
		}
	}
}

func TestDisabledRulesSkipped(t *testing.T) {
	rules := []models.Assertion{{Enabled: false, Source: "status", Operator: "eq", Value: "999"}}
	got := Evaluate(resp(), rules)
	if len(got) != 0 {
		t.Fatalf("disabled rule produced %d results", len(got))
	}
}
