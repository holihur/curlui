# curlui

A self-hosted HTTP client in the spirit of **Postman** and **Navicat** — build,
send, inspect and organize HTTP requests. The twist: every request is actually
executed **by the Go backend**, so the browser never hits CORS, you can call
internal/private endpoints, and you get precise per-phase network timings.

```
┌──────────────┐   JSON over /api   ┌────────────────────┐   net/http   ┌────────────┐
│  React + UI  │ ─────────────────► │  Go API + executor │ ───────────► │  any HTTP  │
│ (Tailwind +  │ ◄───────────────── │  (store + curl)    │ ◄─────────── │  endpoint  │
│  shadcn/ui)  │   response + timings└────────────────────┘              └────────────┘
└──────────────┘
```

## Features

- **Full request builder** — method, URL, query params, headers, body
  (`none`, `JSON`, `XML`, `HTML`, `text`, `x-www-form-urlencoded`, `form-data`
  with file upload, `binary`), and `basic` / `bearer` / `api-key` auth.
- **Requests run in Go** — no CORS, no mixed-content blocks, private/localhost
  targets work, and you get a real `User-Agent` of `curlui/1.0`.
- **Detailed timings** — DNS, TCP connect, TLS handshake, TTFB and total,
  measured with `httptrace` and rendered as a waterfall.
- **Collections** — nested folders to organize and save requests (Navicat-style
  tree), rename/move/delete.
- **History** — every executed request is recorded and can be re-opened.
- **Environments & variables** — `{{baseUrl}}`, plus dynamic values
  `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$uuid}}`, `{{$randomInt}}`.
- **cURL import/export** — paste a `curl ...` command and it becomes a request;
  generate the equivalent cURL for any request.
- **OpenAPI / Swagger import** — enter a spec **URL** (or paste JSON/YAML / pick a
  file); every operation becomes a ready-to-send request in the Collections
  sidebar, grouped by tag, with params, request bodies (sampled from schemas),
  content types and auth configured. Supports Swagger 2.0 and OpenAPI 3.x.
- **JSON syntax highlighting** — both the request body editor and the response
  viewer highlight JSON (dependency-free, theme-aware).
- **Multi-language UI** — English and 简体中文, switchable at runtime and
  remembered in the browser.
- **Options** — timeout, follow redirects, TLS verification toggle, custom proxy.
- **Response viewer** — pretty/raw body, headers, cookies, timing waterfall and
  the exact request that was sent. Binary responses can be downloaded.
- **Dark / light themes**, keyboard shortcuts, multi-tab editing.

## Tech stack

| Layer     | Tech                                                        |
| --------- | ----------------------------------------------------------- |
| Backend   | Go (standard library only — zero dependencies)              |
| Frontend  | React 19, TypeScript, Vite                                  |
| Styling   | Tailwind CSS v4, shadcn/ui (Radix primitives), lucide icons  |
| State     | Zustand                                                     |
| Storage   | JSON file (`data/store.json`), atomic writes                 |

## Quick start

Requirements: **Go 1.22+** and **Node 20+**.

```bash
# 1) install + build everything
make build

# 2) run the server (serves the built UI and the API on :8080)
./server/curlui-server -addr :8080
```

Then open <http://localhost:8080>.

### Development

```bash
make dev        # builds the Go server, runs it, and starts Vite on :5173
```

Vite proxies `/api` to `http://localhost:8080`, so open
<http://localhost:5173> during development.

### Configuration

The server accepts flags or environment variables:

| Flag       | Env var          | Default          | Description                     |
| ---------- | ---------------- | ---------------- | ------------------------------- |
| `-addr`    | `CURLUI_ADDR`    | `:8080`          | Listen address                  |
| `-data`    | `CURLUI_DATA`    | `data/store.json`| JSON data store path            |
| `-static`  | `CURLUI_STATIC`  | `web/dist`       | Built frontend directory        |

## Project layout

```
server/
  main.go                     # flags, static serving, SPA fallback
  internal/
    api/api.go                # HTTP routes + middleware + handlers
    curl/execute.go           # Go HTTP executor (timings, auth, bodies)
    curl/parse.go             # cURL tokenizer/parser + generator
    models/models.go          # shared data types
    store/store.go            # concurrency-safe JSON store
    variables/variables.go    # {{var}} substitution + dynamic vars
web/
  src/
    components/ui/            # shadcn/ui primitives
    components/*.tsx          # app UI (editor, sidebar, response, dialogs)
    lib/{api,types,utils}.ts  # API client, types, helpers
    store.ts                  # Zustand application state
```

## API reference

| Method   | Path                          | Purpose                          |
| -------- | ----------------------------- | -------------------------------- |
| `POST`   | `/api/send`                   | Execute a request                |
| `GET`    | `/api/collections`            | Get the collection tree          |
| `POST`   | `/api/collections`            | Create a folder or request       |
| `PUT`    | `/api/collections/{id}`       | Update a node                    |
| `DELETE` | `/api/collections/{id}`       | Delete a node (and subtree)      |
| `POST`   | `/api/collections/{id}/move`  | Re-parent a node                 |
| `GET`    | `/api/history`                | List history                     |
| `DELETE` | `/api/history`                | Clear history                    |
| `DELETE` | `/api/history/{id}`           | Delete one history entry         |
| `GET`    | `/api/environments`           | List environments                |
| `POST`   | `/api/environments`           | Create/update an environment     |
| `DELETE` | `/api/environments/{id}`      | Delete an environment            |
| `POST`   | `/api/curl/parse`             | Parse a cURL command             |
| `POST`   | `/api/curl/generate`          | Generate a cURL command          |
| `POST`   | `/api/openapi/parse`          | Parse a Swagger/OpenAPI spec (URL or content) |
| `POST`   | `/api/collections/import`     | Bulk-import a parsed tree        |

Example:

```bash
curl -s localhost:8080/api/send -d '{
  "envId": "",
  "request": {
    "method": "POST",
    "url": "https://httpbin.org/post",
    "headers": [{"key":"Content-Type","value":"application/json","enabled":true}],
    "body": {"type":"json","raw":"{\"hello\":\"world\"}"},
    "auth": {"type":"none"},
    "options": {"timeout":15000,"followRedirects":true,"verifyTLS":true}
  }
}'
```

## Keyboard shortcuts

| Shortcut             | Action                |
| -------------------- | --------------------- |
| `Cmd/Ctrl + Enter`   | Send request          |
| `Cmd/Ctrl + S`       | Save request          |
| Double-click a tab   | Rename the request    |

## Variable syntax

Use `{{name}}` anywhere (URL, params, headers, body, auth). Values resolve from
the selected **Environment** at send time. Dynamic helpers:

`{{$timestamp}}` · `{{$isoTimestamp}}` · `{{$uuid}}` · `{{$randomInt}}`

## Notes

- `form-data` **file** fields and the **binary** body type reference paths on the
  machine running the server (this is a local, self-hosted tool).
- TLS verification can be disabled per-request (the `-k` equivalent).
