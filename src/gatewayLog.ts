// Live feed of the gateway's Envoy access log, streamed from the dev server
// (see vite-plugin-aigw-logs.ts). This is real gateway-wide traffic — every
// client, not just this browser.

export type GatewayEntry = {
  id: string
  at: number
  kind: 'llm' | 'mcp'
  status: number
  /** 0 means the connection ended without a response code, e.g. a client abort. */
  model?: string
  responseModel?: string
  inputTokens?: number
  outputTokens?: number
  durationMs?: number
  tenantId?: string
  sessionId?: string
  path?: string
  method?: string
  upstreamHost?: string
  userAgent?: string
  mcpMethod?: string
  mcpTool?: string
  raw: Record<string, unknown>
}

export type FeedState = {
  entries: GatewayEntry[]
  status: 'connecting' | 'live' | 'error'
  error?: string
}

const LIMIT = 500
let state: FeedState = { entries: [], status: 'connecting' }
const listeners = new Set<() => void>()
let source: EventSource | null = null
let refs = 0

function emit(next: Partial<FeedState>) {
  state = { ...state, ...next }
  for (const fn of listeners) fn()
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' && v !== '-' ? v : undefined
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** Envoy writes unset fields as null or "-"; normalise them away. */
export function toEntry(raw: Record<string, unknown>, index: number): GatewayEntry {
  const start = str(raw['start_time'])
  const at = start ? Date.parse(start) : Date.now()
  const isMcp = 'mcp.method.name' in raw
  return {
    id: str(raw['x-request-id']) ?? `${at}-${index}`,
    at: Number.isFinite(at) ? at : Date.now(),
    kind: isMcp ? 'mcp' : 'llm',
    status: num(raw['response_code']) ?? 0,
    model: str(raw['gen_ai.request.model']),
    responseModel: str(raw['gen_ai.response.model']),
    inputTokens: num(raw['gen_ai.usage.input_tokens']),
    outputTokens: num(raw['gen_ai.usage.output_tokens']),
    durationMs: num(raw['duration']),
    tenantId: str(raw['tenant.id']),
    sessionId: str(raw['session.id']) ?? str(raw['mcp.session.id']),
    path: str(raw['request.path']),
    method: str(raw['method']),
    upstreamHost: str(raw['upstream_host']),
    userAgent: str(raw['user-agent']),
    mcpMethod: str(raw['mcp.method.name']),
    mcpTool: str(raw['mcp.tool.name']),
    raw,
  }
}

function connect() {
  if (source) return
  emit({ status: 'connecting', error: undefined })
  const es = new EventSource('/api/logs/stream')
  source = es
  let seq = 0

  es.onmessage = (ev) => {
    try {
      const entry = toEntry(JSON.parse(ev.data), seq++)
      // Newest first, deduped by request id (a reconnect replays the backlog).
      const without = state.entries.filter((e) => e.id !== entry.id)
      emit({ entries: [entry, ...without].sort((a, b) => b.at - a.at).slice(0, LIMIT) })
    } catch {
      /* skip malformed line */
    }
  }
  es.addEventListener('ready', () => emit({ status: 'live' }))
  es.addEventListener('fatal', (ev) => {
    const message = (() => {
      try {
        return (JSON.parse((ev as MessageEvent).data) as { message: string }).message
      } catch {
        return 'log stream unavailable'
      }
    })()
    emit({ status: 'error', error: message })
    es.close()
    source = null
  })
  es.onerror = () => {
    if (state.status !== 'error') {
      emit({ status: 'error', error: 'lost connection to the dev server log stream' })
    }
    es.close()
    source = null
  }
}

export function subscribeGatewayLog(fn: () => void): () => void {
  listeners.add(fn)
  refs++
  connect()
  return () => {
    listeners.delete(fn)
    refs--
    // Keep the tail alive briefly so tab switches do not restart docker logs.
    if (refs <= 0) {
      setTimeout(() => {
        if (refs <= 0 && source) {
          source.close()
          source = null
        }
      }, 30_000)
    }
  }
}

export function getGatewayLog(): FeedState {
  return state
}

export function retryGatewayLog() {
  if (source) {
    source.close()
    source = null
  }
  connect()
}
