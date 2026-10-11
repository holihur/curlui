# curlui end-to-end tests

Self-contained: the runner starts a throwaway origin server (a JSON echo and an
SSE endpoint) plus a throwaway `curlui` instance on a temporary data file, then
drives the real UI with Playwright.

```bash
cd e2e
npm install
node run.mjs                                   # full build

CURLUI_BIN=../server/curlui-server-core \
CURLUI_PORT=8092 node run.mjs                  # core build
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `CURLUI_BIN` | `../server/curlui-server` | binary under test |
| `CURLUI_PORT` | `8091` | port for the instance (origin uses port+1) |
| `CHROME_PATH` | playwright's chromium | browser binary |
| `E2E_VERBOSE` | – | forward the server's stderr |

Covered:

- **smoke** — collections render, a request is sent from the editor and the
  response body/status appear
- **streaming** — the Stream toggle, incremental SSE chunks, the Chunks and
  Events tabs
- **settings** — the tab set (build-dependent), plus a 390px phone viewport
  check for horizontal overflow
- **gating** — the full build offers docs export and the WebSocket console;
  the core build offers neither
