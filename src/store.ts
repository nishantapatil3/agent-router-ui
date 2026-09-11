// Client-side request log.
//
// The gateway writes its access logs to the aigw container's stdout, which a
// browser cannot read, and it exposes no log API. So the UI records the requests
// it makes itself. That covers everything sent from this app (and nothing else,
// which the Logs page says plainly).

import type { ChatMessage, Usage } from './api'
import { getSettings } from './settings'

export type LogEntry = {
  id: string
  /** epoch ms */
  at: number
  model: string
  status: 'success' | 'error' | 'stopped' | 'streaming'
  /** wall-clock duration in ms, absent while still streaming */
  ms?: number
  /** ms until the first content delta arrived */
  ttfbMs?: number
  tenantId: string
  sessionId: string
  usage?: Usage
  request: unknown
  response?: unknown
  error?: string
}

// Legacy prefix, kept so an existing browser does not lose its state.
const KEY = 'aigw-webui.requests.v1'

let entries: LogEntry[] = load()
const listeners = new Set<() => void>()

function load(): LogEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as LogEntry[]) : []
  } catch {
    return []
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    // Quota exceeded or private mode: keep the in-memory log and move on.
  }
}

function emit() {
  persist()
  for (const fn of listeners) fn()
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Snapshot for useSyncExternalStore — must be referentially stable. */
export function getEntries(): LogEntry[] {
  return entries
}

export function startEntry(init: {
  model: string
  tenantId: string
  sessionId: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}): string {
  const id = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const entry: LogEntry = {
    id,
    at: Date.now(),
    model: init.model,
    status: 'streaming',
    tenantId: init.tenantId,
    sessionId: init.sessionId,
    request: {
      model: init.model,
      messages: init.messages,
      stream: true,
      ...(init.temperature !== undefined ? { temperature: init.temperature } : {}),
      ...(init.maxTokens ? { max_tokens: init.maxTokens } : {}),
    },
  }
  entries = [entry, ...entries].slice(0, getSettings().logLimit)
  emit()
  return id
}

export function updateEntry(id: string, patch: Partial<LogEntry>) {
  entries = entries.map((e) => (e.id === id ? { ...e, ...patch } : e))
  emit()
}

export function clearEntries() {
  entries = []
  emit()
}
