// Package assert evaluates response assertions (the same idea as the "Tests"
// tab in Postman): status/time/header/body/JSON-path checks.
package assert

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"curlui/server/internal/jsonpath"
	"curlui/server/internal/models"
)

// Evaluate runs every enabled assertion against the response.
func Evaluate(resp *models.Response, rules []models.Assertion) []models.AssertionResult {
	var results []models.AssertionResult
	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		passed, detail := check(resp, rule)
		results = append(results, models.AssertionResult{
			ID:      rule.ID,
			Passed:  passed,
			Message: describe(rule, detail, passed),
		})
	}
	return results
}

func check(resp *models.Response, rule models.Assertion) (bool, string) {
	switch strings.ToLower(rule.Source) {
	case "status":
		return compareNumber(float64(resp.Status), rule.Operator, rule.Value)
	case "time", "duration":
		return compareNumber(float64(resp.Duration), rule.Operator, rule.Value)
	case "header":
		return compareString(headerValue(resp, rule.Key), rule.Operator, rule.Value)
	case "body":
		return compareString(resp.Body, rule.Operator, rule.Value)
	case "jsonpath", "json":
		value, ok := jsonpath.Get([]byte(resp.Body), rule.Key)
		if !ok {
			if strings.EqualFold(rule.Operator, "exists") {
				return false, "path not found: " + rule.Key
			}
			return false, "path not found: " + rule.Key
		}
		if strings.EqualFold(rule.Operator, "exists") {
			return true, stringify(value)
		}
		if num, ok := toNumber(value); ok {
			if passed, detail := compareNumber(num, rule.Operator, rule.Value); passed || isNumericOperator(rule.Operator) {
				return passed, detail
			}
		}
		return compareString(stringify(value), rule.Operator, rule.Value)
	default:
		return false, "unknown source: " + rule.Source
	}
}

func headerValue(resp *models.Response, name string) string {
	for k, values := range resp.Headers {
		if strings.EqualFold(k, name) && len(values) > 0 {
			return values[0]
		}
	}
	return ""
}

func compareString(actual, operator, expected string) (bool, string) {
	switch strings.ToLower(operator) {
	case "eq", "equals", "==":
		return actual == expected, actual
	case "ne", "!=":
		return actual != expected, actual
	case "contains":
		return strings.Contains(actual, expected), actual
	case "not_contains":
		return !strings.Contains(actual, expected), actual
	case "exists":
		return actual != "", actual
	case "matches", "regex":
		re, err := regexp.Compile(expected)
		if err != nil {
			return false, "invalid regex"
		}
		return re.MatchString(actual), actual
	default:
		return false, "unknown operator: " + operator
	}
}

func compareNumber(actual float64, operator, expected string) (bool, string) {
	want, err := strconv.ParseFloat(strings.TrimSpace(expected), 64)
	if err != nil {
		// Fall back to string comparison for non-numeric expectations.
		return compareString(fmt.Sprintf("%g", actual), operator, expected)
	}
	switch strings.ToLower(operator) {
	case "eq", "equals", "==":
		return actual == want, fmt.Sprintf("%g", actual)
	case "ne", "!=":
		return actual != want, fmt.Sprintf("%g", actual)
	case "gt", ">":
		return actual > want, fmt.Sprintf("%g", actual)
	case "gte", ">=":
		return actual >= want, fmt.Sprintf("%g", actual)
	case "lt", "<":
		return actual < want, fmt.Sprintf("%g", actual)
	case "lte", "<=":
		return actual <= want, fmt.Sprintf("%g", actual)
	default:
		return compareString(fmt.Sprintf("%g", actual), operator, expected)
	}
}

func isNumericOperator(op string) bool {
	switch strings.ToLower(op) {
	case "gt", ">", "gte", ">=", "lt", "<", "lte", "<=":
		return true
	}
	return false
}

func toNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

func stringify(v any) string {
	switch s := v.(type) {
	case string:
		return s
	case nil:
		return ""
	case float64:
		return strconv.FormatFloat(s, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(s)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprint(v)
		}
		return string(b)
	}
}

func describe(rule models.Assertion, detail string, passed bool) string {
	desc := fmt.Sprintf("%s", rule.Source)
	if rule.Key != "" {
		desc += " " + rule.Key
	}
	desc += " " + rule.Operator
	if rule.Value != "" {
		desc += " " + rule.Value
	}
	if detail != "" {
		desc += "  (actual: " + truncate(detail, 120) + ")"
	}
	return desc
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
