# curlui

A self-hosted HTTP client in the spirit of **Postman** and **Navicat** — build,
send, inspect and organize HTTP requests. The twist: every request is actually
executed **by the Go backend**, so the browser never hits CORS, you can call
internal/private endpoints, and you get precise per-phase network timings.

![curlui](docs/screenshots/hero.png)

> **One binary, zero dependencies.** Mock server, request chaining, response
> assertions with a live pass/fail indicator, pre/post hooks, an OpenAPI
> importer and a scheduler — all in a single ~8 MB file.


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
  remembered in the browser (and on the server).
- **Pre-request / post-response hooks** — run any script as a child process;
  the context arrives as JSON on **stdin** and the result is read from
  **stdout**, so hooks can be shell, Python, Node, Go, …
- **Assertions & JSON-path extraction** — validate status/headers/body/JSON
  paths; extract response values into `{{variables}}` for child requests.
- **Request chaining** — a request can declare parent requests; their responses
  are executed first and referenced by descendants.
- **Mock responses** — define canned responses per request; send one with
  *Send as mock*, or let any client hit the built-in mock server at
  `/mock/{requestId}`.
- **Server or Browser execution** — per-request choice; browser mode uses the
  browser's `fetch()` (CORS applies).
- **Scheduler** — send after a delay, at a time, or on a repeating interval
  (optionally a fixed number of times); manage and watch jobs in the Schedules tab.
- **Duplicate** requests/folders and **copy as cURL** from the tree.
- **Options** — timeout, follow redirects, TLS verification toggle, custom proxy.
- **Response viewer** — pretty/raw body, headers, cookies, timing waterfall and
  the exact request that was sent. Binary responses can be downloaded.
- **Dark / light themes**, keyboard shortcuts, multi-tab editing.

## Screenshots

| Import OpenAPI / Swagger | Automation (hooks, assertions, chaining, mock) |
| --- | --- |
| ![Import OpenAPI](docs/screenshots/openapi-import.png) | ![Automation](docs/screenshots/automation.png) |
| **Mock server with hit stats** | **Scheduler (delayed / periodic)** |
| ![Mock](docs/screenshots/mock.png) | ![Scheduler](docs/screenshots/scheduler.png) |

<details>
<summary>Light theme</summary>

![Light theme](docs/screenshots/hero-light.png)

</details>

## Tech stack

| Layer     | Tech                                                        |
| --------- | ----------------------------------------------------------- |
| Backend   | Go (standard library only — zero dependencies)              |
| Frontend  | React 19, TypeScript, Vite                                  |
| Styling   | Tailwind CSS v4, shadcn/ui (Radix primitives), lucide icons  |
| State     | Zustand                                                     |
| Storage   | JSON file (`data/store.json`), atomic writes                 |

## Install (one line)

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/holihur/curlui/main/install.sh | sh
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/holihur/curlui/main/install.ps1 | iex
```

Both detect your OS/CPU, download the matching **single-file** binary from the
latest Release and put it on your `PATH`. Pin a version with
`CURLUI_VERSION=v1.3.0` or choose the directory with `CURLUI_INSTALL_DIR=$HOME/bin`.

Then just run:

```bash
curlui -addr :8080        # open http://localhost:8080
```

## Download & run (single binary)

Every tagged release ships pre-built, **self-contained** binaries — the web UI
is embedded, so there is nothing else to install:

1. Open the [Releases](https://github.com/holihur/curlui/releases) page and
download the archive for your platform (Linux / macOS / Windows · amd64 / arm64).
2. Unpack and run the single file:

   ```bash
   ./curlui -addr :8080        # Linux / macOS
   # curlui.exe -addr :8080    # Windows
   ```
3. Open <http://localhost:8080>.

No Node, no Go and no extra assets required — one file serves the UI and the API.

```bash
curlui -version               # print the version
curlui -help                  # all flags
```

## Quick start (from source)

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
| `-static`  | `CURLUI_STATIC`  | `web/dist`       | Frontend dir (fallback when the UI is not embedded) |
| `-version` | —                | —                | Print version and exit          |

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
| `POST`   | `/api/schedule`               | Create a delayed/periodic job    |
| `GET`    | `/api/schedule`               | List jobs                        |
| `POST`   | `/api/schedule/{id}/run`      | Run a job now                    |
| `POST`   | `/api/schedule/{id}/cancel`   | Stop future runs                 |
| `DELETE` | `/api/schedule/{id}`          | Delete a job                     |
| `GET`    | `/api/schedule/{id}/results`  | Recent run results               |
| any      | `/mock/{requestId}`           | Mock server for a saved request  |

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

## Automation (hooks, assertions, chaining)

Open the **Automation** tab in the request editor.

**Hooks** run as child processes. The context is JSON on **stdin**; the result is
JSON on **stdout**, so a hook can be any language.

*Pre-request* stdin / stdout:

```jsonc
// stdin
{"phase":"pre","request":{ … },"variables":{"baseUrl":"…"}}
// stdout (all fields optional)
{"variables":{"token":"abc"},"request":{"method":"GET"},
 "abort":false,"log":"…"}
```

*Post-response* stdin / stdout:

```jsonc
// stdin
{"phase":"post","request":{ … },"response":{"status":200,"body":"…"},"variables":{}}
// stdout
{"variables":{"id":1},"tests":[{"name":"status 200","passed":true}]}
```

`request` is **deep-merged**, so a hook only has to emit the fields it changes.

**Assertions** validate `status` / `time` / `header` / `body` / `jsonpath` with
operators `eq ne contains matches gt gte lt lte exists`. When they pass, the
indicator next to the request in the sidebar turns **green** (red on failure).

**Chaining**: a request can declare **Dependencies** (parent requests). Parents
run first; their **Extract** rules pull values out of their JSON responses with a
JSON path (e.g. `$.data.token`) into variables that descendants reference as
`{{token}}`.

**Folder hierarchy**: a folder can define **variables** and a **setup request**
with **Extract** rules (right-click a folder → *Folder settings*). Every request
inside the folder — and its subfolders — automatically inherits those variables
and has the setup request run first, so a child API can reference a parent's
return value without wiring it up manually. Variable precedence is:
environment → ancestor folder variables → parent/setup extractions → hooks.

**Drag & drop**: reorder or re-parent any node in the sidebar — drop onto a
folder to nest it, between rows to reorder, or on empty space to move it to the
root. Ordering and nesting are saved to the store.

## Notes

- `form-data` **file** fields and the **binary** body type reference paths on the
  machine running the server (this is a local, self-hosted tool).
- TLS verification can be disabled per-request (the `-k` equivalent).
