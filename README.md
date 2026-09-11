# agent-router-ui

A small React + Vite console for [Agent Router](https://github.com/theagentrouter/agent-router)
(`aigw`). The layout and visual language borrow from
[LiteLLM's admin UI](https://docs.litellm.ai/docs/proxy/ui) — grouped sidebar
nav, white cards on a faint page, dense data tables with status pills, and
horizontal "top N" bar lists.

Runs off the Vite dev server for development, or as a container (nginx serving
the built bundle and proxying to the gateway) — see [Container](#container).

## Pages

| | |
| --- | --- |
| **Playground** | Streaming chat against `/v1/chat/completions`. Model picker fed from the gateway's own `/v1/models`, system prompt, temperature / max tokens, and editable `x-tenant-id` / `agent-session-id` attribution headers. Each turn reports total tokens, time to first token and total latency. |
| **MCP Tools** | Connects to `/mcp`, lists the aggregated tools, and calls one with JSON arguments pre-seeded from its required schema keys. Long tool descriptions are collapsed so the call form stays in view. |
| **Usage** | Live counters parsed from the gateway's Prometheus exposition at `:1064/metrics` — request/token/latency tiles plus breakdowns by model, operation, tenant and provider. Auto-refreshes every 5s. |
| **Logs** | Two sources. **Gateway** streams the aigw container's Envoy access log live — every request the gateway served, from any client (the Playground, curl, your own apps), LLM and MCP alike, with status, tokens, latency, tenant, session and client. **This browser** shows what the Playground sent from here, and is the only view with full request/response bodies. |
| **Models** | Models the gateway advertises on `/v1/models`, joined with live per-model usage (requests, tokens, average latency). **Test** sends a real one-token completion to prove a model routes end to end. Click a row for a detail view with Overview / Raw JSON tabs. |
| **Settings** | Theme (light / dark / follow OS), gateway and admin base URLs with a connectivity probe, Playground defaults, Usage refresh interval and log retention. |

**Light is the default theme**, regardless of the OS setting; switch to dark or
"follow OS" on the Settings page. The active page lives in the URL hash, so
`#models`, `#usage`, `#logs`, `#tools` and `#settings` are linkable.

## Requires

A running Agent Router gateway — by default one on `localhost:1975` (OpenAI API
and MCP) with its admin server on `localhost:1064` (health and metrics). Point
elsewhere with `AIGW_URL` / `AIGW_ADMIN_URL`, below.

The Logs page additionally expects that gateway to run under Docker Compose, so
the dev server can tail its access log; set `AIGW_COMPOSE_DIR` to that project
directory (it defaults to this repo's parent).

## Run it

With the gateway up:

```bash
npm install
npm run dev
```

Open <http://localhost:5173>.

Other scripts: `npm run build` (typecheck + production bundle into `dist/`),
`npm run preview`, `npm run typecheck`.

## Container

The `Dockerfile` builds the bundle with Node and serves it from nginx, which
also reverse-proxies `/api/gateway` and `/api/admin` exactly as the dev server
does — so the browser still never calls the CORS-less gateway directly. The
upstreams are read at container start, so one image works against any gateway:

Images are published to GitHub Container Registry by
`.github/workflows/docker.yml` on every push to `main` (`latest` plus the commit
sha) and on `v*` tags (`1.2.3`, `1.2`); pull requests build the image without
publishing. Pull one with
`docker pull ghcr.io/nishantapatil3/agent-router-ui:latest`, or build locally:

```bash
docker build -t agent-router-ui .
docker run --rm -p 8080:8080 \
  -e AIGW_URL=http://aigw:1975 \
  -e AIGW_ADMIN_URL=http://aigw:1064 \
  agent-router-ui
```

Open <http://localhost:8080>. Both variables default to `localhost`, which is
only useful with `--network host`; on the gateway's Compose network use its
service name as above. nginx resolves the upstream hostnames at startup, so the
gateway must be resolvable (not necessarily up) when this container starts.

Two differences from `npm run dev`:

- The Logs page's **Gateway** source is unavailable — tailing the aigw
  container's access log needs the docker CLI, which only the dev server has.
  The **This browser** source works as usual.
- The proxy targets shown on the Settings page are baked in at build time
  (`--build-arg AIGW_URL=... --build-arg AIGW_ADMIN_URL=...` to match); they are
  display-only and do not affect routing.

## How it talks to the gateway

aigw sends no CORS headers, so the browser never calls it directly — the Vite
dev server proxies instead (`vite.config.ts`):

| Browser path | Proxied to |
| --- | --- |
| `/api/gateway/*` | `http://localhost:1975` — `/v1/*` and `/mcp` |
| `/api/admin/*` | `http://localhost:1064` — `/health` and `/metrics` |

Point it at a gateway elsewhere with environment variables:

```bash
AIGW_URL=http://gateway.internal:1975 AIGW_ADMIN_URL=http://gateway.internal:1064 npm run dev
```

Because of that proxy, `npm run preview` and any static host serving `dist/`
will **not** reach the gateway — those paths only exist on the dev server. Use
`npm run dev` to actually drive the gateway; `build` is there for typechecking
and bundle-size sanity.

The UI sends `Authorization: Bearer unused`, the same placeholder the curl
examples use — aigw replaces it upstream from its `BackendSecurityPolicy`, so no
real provider key is ever present in the browser.

## Settings

Everything on the Settings page is stored in `localStorage` for this browser
only — nothing is sent to the gateway.

- **Theme** — Light (default), Dark, or System. The choice is applied before the
  first paint, so there is no flash.
- **Endpoints** — the base paths the UI fetches from. They default to the dev
  server's proxy paths; the page also shows the upstreams that proxy points at,
  baked in from `AIGW_URL` / `AIGW_ADMIN_URL` at dev-server start. Overriding
  them to call a gateway directly only works if something in front of it adds
  CORS headers, which aigw does not — "Test endpoints" tells you either way.
- **Playground defaults** — model, temperature, max tokens, and the
  `x-tenant-id` / `agent-session-id` headers used for new sessions.
- **Data** — Usage auto-refresh interval (0 disables it) and how many requests
  the Logs page keeps.

## Where the Logs data comes from

The **Gateway** tab needs two things, because a browser cannot read container
logs and aigw exposes no log API:

1. **`AIGW_DEBUG=true`** in the stack's `.env`. Envoy only writes its JSON access
   log to the console in debug mode; without it the gateway serves traffic
   normally but logs nothing to read.
2. **The `docker` CLI on the dev server's `PATH`.** A small Vite plugin
   (`vite-plugin-aigw-logs.ts`) runs `docker compose logs --tail 300 -f aigw` in
   the Compose project directory, keeps the JSON access-log lines, and streams
   them to the browser over SSE at `/api/logs/stream`. That directory defaults to
   this repo's parent; override it with `AIGW_COMPOSE_DIR`.

If either is missing, the tab explains what went wrong and offers a retry rather
than sitting empty. Envoy logs metadata, not payloads, so request and response
bodies only exist on the **This browser** tab.

## Notes and limits

- The **This browser** log lives in `localStorage` and keeps the last N requests
  (200 by default, configurable in Settings). It survives reload, is cleared by
  the "Clear" button, and is per-browser — open the UI somewhere else and it
  starts empty. The **Gateway** tab has no such limit: it reads the gateway's own
  log, so it shows history from before this browser ever connected.
- The Models page and the Playground dropdown both read `/v1/models`, which aigw
  populates only from **Exact** `x-ai-eg-model` matches in the `AIGatewayRoute`.
  Models reached via the catch-all rule do not appear there — the Models page
  lists them as `catch-all` when they have served traffic, and the Playground
  falls back to free text, so typing any id LiteLLM serves still works.
- **Models is read-only.** aigw reads its model config from `config/aigw.yaml` at
  startup and exposes no admin API, so there is nothing to add or delete a model
  with. Edit the file and restart the container.
- Usage counters are cumulative since the `aigw` container started and reset
  when it restarts; the page shows an empty state until the first request. For
  rate-based history use Grafana.
- Quantiles on the Usage page are read off the raw cumulative histogram buckets,
  so they cover all time. Grafana's `histogram_quantile` over a rate window is
  the accurate view.
