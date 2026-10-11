package jsonpath

import "testing"

func TestGet(t *testing.T) {
	data := []byte(`{"a":{"b":[1,2,3]},"n":5,"s":"hi","t":true,"nil":null}`)
	cases := []struct {
		path string
		want any
		ok   bool
	}{
		{"$.n", float64(5), true},
		{"$.s", "hi", true},
		{"$.t", true, true},
		{"$.a.b[1]", float64(2), true},
		{"$.missing", nil, false},
	}
	for _, c := range cases {
		got, ok := Get(data, c.path)
		if ok != c.ok {
			t.Errorf("Get(%q) ok = %v, want %v", c.path, ok, c.ok)
			continue
		}
		if ok && got != c.want {
			t.Errorf("Get(%q) = %#v, want %#v", c.path, got, c.want)
		}
	}
}

func TestGetInvalidJSON(t *testing.T) {
	if _, ok := Get([]byte("not json"), "$.a"); ok {
		t.Error("expected !ok for invalid JSON")
	}
}
