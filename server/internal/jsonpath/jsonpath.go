// Package jsonpath implements a small subset of JSONPath good enough for
// extracting response values: dot notation, brackets and array indexes.
//
//	$.data.token      data.token
//	items[0].id       $.items[2].name
package jsonpath

import (
	"encoding/json"
	"strconv"
	"strings"
)

type segment struct {
	name  string
	index int // -1 when the segment is a key
}

// Get parses data and returns the value at path.
func Get(data []byte, path string) (any, bool) {
	var root any
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, false
	}
	return Walk(root, path)
}

// Walk returns the value at path within an already-decoded document.
func Walk(root any, path string) (any, bool) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" || trimmed == "$" {
		return root, true
	}
	cur := root
	for _, seg := range tokenize(trimmed) {
		switch node := cur.(type) {
		case map[string]any:
			v, ok := node[seg.name]
			if !ok {
				return nil, false
			}
			cur = v
		case []any:
			if seg.index < 0 || seg.index >= len(node) {
				return nil, false
			}
			cur = node[seg.index]
		default:
			return nil, false
		}
	}
	return cur, true
}

func tokenize(path string) []segment {
	path = strings.TrimPrefix(path, "$")
	path = strings.TrimPrefix(path, ".")

	var out []segment
	var cur strings.Builder
	flush := func() {
		if cur.Len() > 0 {
			out = append(out, segment{name: cur.String(), index: -1})
			cur.Reset()
		}
	}

	for i := 0; i < len(path); i++ {
		switch path[i] {
		case '.':
			flush()
		case '[':
			flush()
			end := strings.IndexByte(path[i:], ']')
			if end < 0 {
				return out
			}
			inner := strings.Trim(path[i+1:i+end], `'"`)
			if n, err := strconv.Atoi(inner); err == nil {
				out = append(out, segment{index: n})
			} else {
				out = append(out, segment{name: inner, index: -1})
			}
			i += end
		default:
			cur.WriteByte(path[i])
		}
	}
	flush()
	return out
}
