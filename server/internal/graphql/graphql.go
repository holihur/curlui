// Package graphql provides a GraphQL schema introspection helper: it runs the
// standard introspection query and normalises the result so the UI can offer
// field hints.
package graphql

import (
	"encoding/json"
	"fmt"
	"sort"
)

// IntrospectionQuery is a compact but complete schema introspection query.
const IntrospectionQuery = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      fields(includeDeprecated: true) {
        name
        args { name type { ...TypeRef } }
        type { ...TypeRef }
      }
      inputFields { name type { ...TypeRef } }
      enumValues(includeDeprecated: true) { name }
    }
  }
}
fragment TypeRef on __Type {
  kind name
  ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } }
}`

// Field is a field or input field with its rendered type.
type Field struct {
	Name string `json:"name"`
	Type string `json:"type"`
	Args []Arg  `json:"args,omitempty"`
}

// Arg is a field argument.
type Arg struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// Type is a normalised GraphQL type.
type Type struct {
	Name        string   `json:"name"`
	Kind        string   `json:"kind"`
	Fields      []Field  `json:"fields,omitempty"`
	InputFields []Field  `json:"inputFields,omitempty"`
	EnumValues  []string `json:"enumValues,omitempty"`
}

// Schema is the normalised introspection result.
type Schema struct {
	QueryType        string `json:"queryType"`
	MutationType     string `json:"mutationType,omitempty"`
	SubscriptionType string `json:"subscriptionType,omitempty"`
	Types            []Type `json:"types"`
}

type typeRef struct {
	Kind   string   `json:"kind"`
	Name   string   `json:"name"`
	OfType *typeRef `json:"ofType"`
}

func renderType(t *typeRef) string {
	if t == nil {
		return ""
	}
	switch t.Kind {
	case "NON_NULL":
		return renderType(t.OfType) + "!"
	case "LIST":
		return "[" + renderType(t.OfType) + "]"
	default:
		return t.Name
	}
}

type rawSchema struct {
	Data struct {
		Schema *struct {
			QueryType        *struct{ Name string } `json:"queryType"`
			MutationType     *struct{ Name string } `json:"mutationType"`
			SubscriptionType *struct{ Name string } `json:"subscriptionType"`
			Types            []struct {
				Kind   string `json:"kind"`
				Name   string `json:"name"`
				Fields []struct {
					Name string `json:"name"`
					Args []struct {
						Name string   `json:"name"`
						Type *typeRef `json:"type"`
					} `json:"args"`
					Type *typeRef `json:"type"`
				} `json:"fields"`
				InputFields []struct {
					Name string   `json:"name"`
					Type *typeRef `json:"type"`
				} `json:"inputFields"`
				EnumValues []struct {
					Name string `json:"name"`
				} `json:"enumValues"`
			} `json:"types"`
		} `json:"__schema"`
	} `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

// ParseSchema normalises a GraphQL introspection response body.
func ParseSchema(body []byte) (*Schema, error) {
	var raw rawSchema
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("invalid JSON response: %w", err)
	}
	if len(raw.Errors) > 0 {
		return nil, fmt.Errorf("graphql: %s", raw.Errors[0].Message)
	}
	if raw.Data.Schema == nil {
		return nil, fmt.Errorf("no schema returned (is this a GraphQL endpoint?)")
	}

	out := &Schema{}
	if raw.Data.Schema.QueryType != nil {
		out.QueryType = raw.Data.Schema.QueryType.Name
	}
	if raw.Data.Schema.MutationType != nil {
		out.MutationType = raw.Data.Schema.MutationType.Name
	}
	if raw.Data.Schema.SubscriptionType != nil {
		out.SubscriptionType = raw.Data.Schema.SubscriptionType.Name
	}

	for _, t := range raw.Data.Schema.Types {
		// Skip the built-in introspection types.
		if len(t.Name) > 2 && t.Name[:2] == "__" {
			continue
		}
		nt := Type{Name: t.Name, Kind: t.Kind}
		for _, f := range t.Fields {
			nf := Field{Name: f.Name, Type: renderType(f.Type)}
			for _, a := range f.Args {
				nf.Args = append(nf.Args, Arg{Name: a.Name, Type: renderType(a.Type)})
			}
			nt.Fields = append(nt.Fields, nf)
		}
		for _, f := range t.InputFields {
			nt.InputFields = append(nt.InputFields, Field{Name: f.Name, Type: renderType(f.Type)})
		}
		for _, e := range t.EnumValues {
			nt.EnumValues = append(nt.EnumValues, e.Name)
		}
		out.Types = append(out.Types, nt)
	}

	// Query/Mutation/Subscription types first, then alphabetical.
	rank := func(name string) int {
		switch name {
		case out.QueryType:
			return 0
		case out.MutationType:
			return 1
		case out.SubscriptionType:
			return 2
		}
		return 3
	}
	sort.SliceStable(out.Types, func(i, j int) bool {
		ri, rj := rank(out.Types[i].Name), rank(out.Types[j].Name)
		if ri != rj {
			return ri < rj
		}
		return out.Types[i].Name < out.Types[j].Name
	})
	return out, nil
}
