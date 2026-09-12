# Agent Router on Docker Compose

Runs [Agent Router](https://github.com/theagentrouter/agent-router) (the project
formerly known as Envoy AI Gateway) as a Docker Compose stack in front of an
existing **LiteLLM** endpoint, with Prometheus and Grafana for observability.

Agent Router's CLI, `aigw`, has a standalone mode that starts Envoy Gateway,
Envoy and the external processor inside a single container — so no Kubernetes is
needed. This stack uses the official `envoyproxy/ai-gateway-cli` image, so
there is no build step.

```
UI :8080 ────┐
client ──────┴▶ aigw :1975 ──▶ LiteLLM (OpenAI-compatible) ──▶ providers
                  │  :1064 /metrics ──▶ Prometheus :9090 ──▶ Grafana :3000
                  └─ /mcp ──▶ MCP backends declared in config/aigw.yaml
```

## Prerequisites

- Docker with Compose v2
- A LiteLLM endpoint and a LiteLLM virtual key

## Quick start

```bash
cp .env.example .env   # then set LITELLM_API_KEY (and the host, if not Outshift)
docker compose up -d --wait
```

`--wait` blocks until `aigw` reports healthy (the image's own healthcheck hits
`:1064/health`), so a clean return means Envoy came up and the gateway is
serving.

| Endpoint | URL |
| --- | --- |
| OpenAI-compatible API | <http://localhost:1975/v1> |
| MCP gateway | <http://localhost:1975/mcp> |
| Health / metrics | <http://localhost:1064/health>, <http://localhost:1064/metrics> |
| Prometheus | <http://localhost:9090> |
| Grafana | <http://localhost:3000> (`admin` / `$GRAFANA_ADMIN_PASSWORD`) |
| Web UI | <http://localhost:8080> (`UI_PORT`), or :5173 from the dev server |

Shut down with `docker compose down --remove-orphans`.

## Sending requests

Use any model name your LiteLLM serves. The client's `Authorization` header is
*not* the LiteLLM key — aigw replaces it upstream from the
`BackendSecurityPolicy`, so callers never hold the real key.

```bash
curl -s localhost:1975/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer unused' \
  -H 'x-tenant-id: tenant-1' \
  -H 'agent-session-id: session-123' \
  -d '{"model":"bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0",
       "messages":[{"role":"user","content":"Answer in up to 3 words: which ocean contains Bouvet Island?"}]}'
```

`/v1/completions` and `/v1/embeddings` work the same way, as does
`"stream": true` (pass `"stream_options": {"include_usage": true}` if you want
token counts recorded for streamed responses).

The optional `x-tenant-id` and `agent-session-id` headers show up in the access
logs, traces and metrics — `x-tenant-id` is mapped onto the `tenant.id`
attribute via `OTEL_AIGW_REQUEST_HEADER_ATTRIBUTES` in `docker-compose.yaml`,
which is what the "Tokens by tenant" dashboard panel groups on.

### Access logs

Envoy's JSON access logs are written on every run, with no settings required —
aigw captures its subprocess output under its state directory inside the
container:

```bash
docker cp aigw:/home/nonroot/.local/state/aigw/envoy-runs/0/stdout.log - | tar xO
```

Set `AIGW_DEBUG=true` in `.env` (and `docker compose up -d aigw`) to also tee
that output to the container console, which is the easier read:

```bash
docker compose logs aigw | grep gen_ai.usage
```

Note that aigw rewrites the captured file from the top on each run, so a restart
leaves stale lines after the current run's output.

Each line carries `gen_ai.request.model`,
`gen_ai.usage.input_tokens` / `output_tokens`, `tenant.id`, `session.id`,
`response_code`, `duration` and the resolved `upstream_host`. MCP requests get
their own line format with `mcp.method.name` and `mcp.tool.name`.

### MCP

```bash
npx @modelcontextprotocol/inspector --cli http://localhost:1975/mcp --method tools/list
```

Tools from every configured MCP backend are aggregated behind `/mcp` and
namespaced `<backend>__<tool>` (the shipped example yields `kiwi__search-flight`
and `kiwi__feedback-to-devs`).

## Web UI

`agent-router-ui/` is a small React + Vite console, styled after LiteLLM's admin UI: a
streaming **Playground**, a **Models** page with per-model usage and a
test-connection action, an **MCP Tools** browser, a **Usage** view over the
gateway's Prometheus metrics, and **Settings** (theme, endpoints, defaults). It runs in this stack as the `ui` service
(`ghcr.io/nishantapatil3/agent-router-ui`), where nginx serves the bundle and
reverse-proxies `/api/gateway` and `/api/admin` to `aigw` — the browser never
calls the gateway directly, since aigw sends no CORS headers. Set `UI_VERSION`
to pin the image tag and `UI_PORT` to move it off <http://localhost:8080>.

For UI development, run the Vite dev server against the same stack instead — it
proxies the same paths:

```bash
cd agent-router-ui && npm install && npm run dev   # http://localhost:5173
```

See [agent-router-ui/README.md](agent-router-ui/README.md) for details.

## Configuration

**`config/aigw.yaml`** is the whole gateway config, mounted read-only at
`/etc/aigw/aigw.yaml`. aigw runs `envsubst` over the entire file, so
`${LITELLM_HOST}`, `${LITELLM_PORT}` and `${LITELLM_API_KEY}` resolve from the
environment at startup. Restart to pick up edits:

```bash
docker compose up -d aigw   # recreates with current .env
docker compose restart aigw # config-file edits only
```

### Pointing at a different LiteLLM

`LITELLM_HOST` / `LITELLM_PORT` take a **host and port only** — the `/v1` path
comes from the incoming request, so a base URL of
`https://llm-proxy.prod.outshift.ai/v1` means `LITELLM_HOST=llm-proxy.prod.outshift.ai`
and `LITELLM_PORT=443`.

HTTPS is the default and is handled by the `BackendTLSPolicy` named
`litellm-tls` in `config/aigw.yaml`, which validates against the system CA
bundle using `${LITELLM_HOST}` as the verification hostname. For a **plain HTTP**
LiteLLM (say one on the Docker host), comment that resource out and set:

```
LITELLM_HOST=host.docker.internal
LITELLM_PORT=4000
```

`host.docker.internal` resolves to the Docker host via the `extra_hosts` entry
in `docker-compose.yaml`.

### Declared models and `/v1/models`

aigw serves the OpenAI-compatible `/v1/models` endpoint itself, populated **only**
from rules that match `x-ai-eg-model` with `type: Exact` — a regex match
advertises nothing. The first rule in `config/aigw.yaml` therefore lists the
three Claude models explicitly (with `modelsOwnedBy` / `modelsCreatedAt`) so
clients like `agent-router-ui/` can discover them. The catch-all rule below it still
routes any other model, those just do not appear in `/v1/models`.

Add or remove entries in that rule as your LiteLLM's model list changes, then
`docker compose restart aigw`. Note that editing a bind-mounted config file is
not a change Compose detects, so `up -d` alone will not reload it — restart the
container.

### Routing to more than one backend

The catch-all `AIGatewayRoute` rule hands every other model to LiteLLM, since
LiteLLM already does per-model routing. To split traffic at the gateway instead,
add a more specific rule **above** the catch-all (first match wins) matching
`x-ai-eg-model`, plus a matching `Backend` / `AIServiceBackend` /
`BackendSecurityPolicy` trio. There is a commented example in the file, and
upstream ships per-provider samples under `examples/basic/`.

### MCP backends

MCP servers are declared as `MCPRoute` `backendRefs` in `config/aigw.yaml`, each
with its own `Backend` (and a `BackendTLSPolicy` when HTTPS). Note that the
`--mcp-config` / `--mcp-json` CLI flags are **ignored** whenever an explicit
config file is passed to `aigw run`, so the JSON form of MCP config does not
apply to this stack. Per-backend `toolSelector` regexes and `securityPolicy`
credentials are supported; see the commented options in the file.

### Pinning the version

`AIGW_VERSION` in `.env` selects the image tag (default `latest`). Pin it to a
published tag such as `v1.2.0-dev.2026-09-10-18-51` for reproducible deploys.

## Observability

Prometheus scrapes `aigw:1064/metrics` every 15s. The gateway exports two
`gen_ai` metrics, both histograms, labelled by model, operation, provider and
(when the header is sent) `tenant_id`:

- `gen_ai_client_token_usage` — token counts, split by `gen_ai_token_type`
  (`input` / `output`)
- `gen_ai_server_request_duration_seconds` — request latency

Grafana auto-provisions the Prometheus datasource and an **Agent Router**
dashboard (`observability/grafana/dashboards/aigw.json`) built on exactly those
series: request rate and token throughput, latency quantiles, and a per-tenant
token breakdown.

Note that metrics only appear after the first request, and they reset when the
`aigw` container restarts (Prometheus keeps the history).

## Notes

- Single `aigw` replica. For HA, run several and put a load balancer in front.
- `.env` holds your LiteLLM key and is gitignored; `.env.example` is the template.
