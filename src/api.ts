// Thin client for the aigw endpoints the UI needs. All requests go through the
// Vite dev proxy (see vite.config.ts) because the gateway sends no CORS headers.

import { getSettings, normalizeBase } from './settings'

const GATEWAY = () => normalizeBase(getSettings().gatewayBase)
const ADMIN = () => normalizeBase(getSettings().adminBase)

/** Headers aigw maps onto telemetry attributes, surfaced in the UI. */
export type Attribution = {
  tenantId: string
  sessionId: string
}

function attributionHeaders({ tenantId, sessionId }: Attribution): Record<string, string> {
  const h: Record<string, string> = {}
  if (tenantId.trim()) h['x-tenant-id'] = tenantId.trim()
  if (sessionId.trim()) h['agent-session-id'] = sessionId.trim()
  return h
}

// ---------------------------------------------------------------- models

export type Model = {
  id: string
  owned_by?: string
  created?: number
}

export async function listModels(): Promise<Model[]> {
  const res = await fetch(`${GATEWAY()}/v1/models`, {
    headers: { authorization: 'Bearer unused' },
  })
  if (!res.ok) throw new Error(`/v1/models returned ${res.status}`)
  const body = (await res.json()) as { data?: Model[] }
  return body.data ?? []
}

// ---------------------------------------------------------------- chat

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type Usage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export type ChatOptions = {
  model: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  attribution: Attribution
  signal?: AbortSignal
}

export type ChatEvents = {
  onDelta: (text: string) => void
  onUsage: (usage: Usage) => void
}

/**
 * Streams a chat completion, calling onDelta for each content chunk. Resolves
 * once the stream ends. Rejects with the gateway's error body on a non-2xx,
 * which is how upstream failures (503s from aigw) surface in the UI.
 */
export async function streamChat(opts: ChatOptions, events: ChatEvents): Promise<void> {
  const res = await fetch(`${GATEWAY()}/v1/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'content-type': 'application/json',
      // Replaced upstream by the gateway's BackendSecurityPolicy, so the
      // browser never needs the real LiteLLM key.
      authorization: 'Bearer unused',
      ...attributionHeaders(opts.attribution),
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
  })

  if (!res.ok || !res.body) {
    throw new Error(await describeError(res))
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by a blank line.
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        let chunk: any
        try {
          chunk = JSON.parse(data)
        } catch {
          continue // partial or non-JSON keepalive
        }
        const delta = chunk?.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta) events.onDelta(delta)
        if (chunk?.usage) events.onUsage(chunk.usage as Usage)
      }
    }
  }
}

async function describeError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const body = JSON.parse(text)
    const msg = body?.error?.message ?? body?.message
    if (msg) return `${res.status}: ${msg}`
  } catch {
    /* fall through to raw text */
  }
  return `${res.status}: ${text.slice(0, 300) || res.statusText}`
}

export type ModelTest = { ok: boolean; ms: number; detail: string }

/**
 * Sends the smallest possible completion to prove a model actually routes end
 * to end — LiteLLM's "Test Connection" button, done for real. Costs a couple of
 * tokens, so it is only ever triggered explicitly.
 */
export async function testModel(model: string, attribution: Attribution): Promise<ModelTest> {
  const started = performance.now()
  try {
    const res = await fetch(`${GATEWAY()}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer unused',
        ...attributionHeaders(attribution),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    })
    const ms = Math.round(performance.now() - started)
    if (!res.ok) return { ok: false, ms, detail: await describeError(res) }
    const body = (await res.json()) as { usage?: Usage; model?: string }
    const used = body.usage?.total_tokens
    return {
      ok: true,
      detail: `routed to ${body.model ?? model}${used !== undefined ? ` · ${used} tokens` : ''}`,
      ms,
    }
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - started), detail: (e as Error).message }
  }
}

// ---------------------------------------------------------------- health

export async function fetchHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${ADMIN()}/health`)
    return res.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- metrics

export type Sample = { labels: Record<string, string>; value: number }
export type MetricFamily = Map<string, Sample[]>

/**
 * Parses the Prometheus text exposition format into series name -> samples.
 * aigw exposes gen_ai_client_token_usage and
 * gen_ai_server_request_duration_seconds, both histograms, so this needs to
 * handle the _sum / _count / _bucket suffixes rather than plain gauges.
 */
export function parsePrometheus(text: string): MetricFamily {
  const out: MetricFamily = new Map()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const brace = line.indexOf('{')
    let name: string
    let labels: Record<string, string> = {}
    let rest: string
    if (brace === -1) {
      const sp = line.indexOf(' ')
      if (sp === -1) continue
      name = line.slice(0, sp)
      rest = line.slice(sp + 1)
    } else {
      name = line.slice(0, brace)
      const close = line.lastIndexOf('}')
      if (close === -1) continue
      labels = parseLabels(line.slice(brace + 1, close))
      rest = line.slice(close + 1)
    }
    const value = Number.parseFloat(rest.trim().split(/\s+/)[0])
    if (!Number.isFinite(value)) continue
    const list = out.get(name)
    if (list) list.push({ labels, value })
    else out.set(name, [{ labels, value }])
  }
  return out
}

function parseLabels(s: string): Record<string, string> {
  const labels: Record<string, string> = {}
  // key="value" pairs, values may contain escaped quotes and commas.
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    labels[m[1]] = m[2].replace(/\\(.)/g, '$1')
  }
  return labels
}

export async function fetchMetrics(): Promise<MetricFamily> {
  const res = await fetch(`${ADMIN()}/metrics`)
  if (!res.ok) throw new Error(`/metrics returned ${res.status}`)
  return parsePrometheus(await res.text())
}

/** Sums samples, grouped by the given label. Missing label -> "(none)". */
export function sumBy(samples: Sample[] | undefined, label: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of samples ?? []) {
    const key = s.labels[label] || '(none)'
    out.set(key, (out.get(key) ?? 0) + s.value)
  }
  return out
}

export function sumAll(samples: Sample[] | undefined): number {
  return (samples ?? []).reduce((acc, s) => acc + s.value, 0)
}

/**
 * Approximates a quantile from cumulative histogram buckets by summing every
 * bucket series at each `le` boundary. Good enough for an at-a-glance panel;
 * Grafana does the real thing over a rate window.
 */
export function quantileFromBuckets(buckets: Sample[] | undefined, q: number): number | null {
  if (!buckets || buckets.length === 0) return null
  const byLe = new Map<number, number>()
  for (const s of buckets) {
    const le = s.labels.le === '+Inf' ? Number.POSITIVE_INFINITY : Number.parseFloat(s.labels.le)
    if (!Number.isFinite(le) && le !== Number.POSITIVE_INFINITY) continue
    byLe.set(le, (byLe.get(le) ?? 0) + s.value)
  }
  const sorted = [...byLe.entries()].sort((a, b) => a[0] - b[0])
  const total = sorted.length ? sorted[sorted.length - 1][1] : 0
  if (!total) return null
  const target = total * q
  for (const [le, count] of sorted) {
    if (count >= target) return Number.isFinite(le) ? le : sorted[sorted.length - 2]?.[0] ?? le
  }
  return null
}

// ---------------------------------------------------------------- MCP

export type McpTool = {
  name: string
  description?: string
  inputSchema?: unknown
}

type JsonRpcResult = { result?: any; error?: { code: number; message: string } }

/**
 * Streamable-HTTP MCP is a POST of JSON-RPC that may answer with either JSON or
 * an SSE frame, so unwrap both. The session id from initialize must be echoed on
 * every later call.
 */
async function mcpCall(method: string, params: unknown, sessionId?: string): Promise<{ body: JsonRpcResult; sessionId: string | null }> {
  const res = await fetch(`${GATEWAY()}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} failed: ${res.status} ${text.slice(0, 200)}`)
  const json = text.startsWith('{') ? text : (text.match(/^data:\s*(\{.*\})$/m)?.[1] ?? '')
  if (!json) throw new Error(`${method}: could not parse response`)
  const body = JSON.parse(json) as JsonRpcResult
  if (body.error) throw new Error(`${method}: ${body.error.message}`)
  return { body, sessionId: res.headers.get('mcp-session-id') }
}

export async function mcpConnect(): Promise<string> {
  const { sessionId } = await mcpCall('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'agent-router-ui', version: '0.1.0' },
  })
  if (!sessionId) throw new Error('initialize returned no mcp-session-id')
  // Servers expect the initialized notification before real calls.
  await fetch(`${GATEWAY()}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  })
  return sessionId
}

export async function mcpListTools(sessionId: string): Promise<McpTool[]> {
  const { body } = await mcpCall('tools/list', {}, sessionId)
  return (body.result?.tools ?? []) as McpTool[]
}

export async function mcpCallTool(sessionId: string, name: string, args: unknown): Promise<unknown> {
  const { body } = await mcpCall('tools/call', { name, arguments: args }, sessionId)
  return body.result
}
