// User settings, persisted in localStorage and shared across pages via
// useSyncExternalStore (same pattern as the request log in store.ts).

export type Theme = 'light' | 'dark' | 'system'

export type Settings = {
  theme: Theme
  /** Base path/URL for /v1/* and /mcp. Default is the Vite dev-server proxy. */
  gatewayBase: string
  /** Base path/URL for /health and /metrics. */
  adminBase: string
  defaultModel: string
  temperature: number
  maxTokens: number
  tenantId: string
  sessionId: string
  /** Usage page poll interval, in seconds. 0 disables auto-refresh. */
  usageRefreshSeconds: number
  /** How many requests the Logs page keeps. */
  logLimit: number
}

export const DEFAULTS: Settings = {
  theme: 'light',
  gatewayBase: '/api/gateway',
  adminBase: '/api/admin',
  defaultModel: '',
  temperature: 0.7,
  maxTokens: 512,
  tenantId: 'tenant-1',
  sessionId: 'session-webui',
  usageRefreshSeconds: 5,
  logLimit: 200,
}

/** Upstreams the dev server proxies to, baked in by vite.config.ts. */
export const PROXY_TARGETS = {
  gateway: __AIGW_URL__,
  admin: __AIGW_ADMIN_URL__,
}

// Legacy prefix, kept so an existing browser does not lose its state.
const KEY = 'aigw-webui.settings.v1'
const listeners = new Set<() => void>()

let current: Settings = load()

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<Settings>
    // Merge so settings added in a later version pick up their defaults.
    return { ...DEFAULTS, ...parsed }
  } catch {
    return DEFAULTS
  }
}

export function getSettings(): Settings {
  return current
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Private mode: keep it in memory for this session.
  }
  if (patch.theme) applyTheme(patch.theme)
  for (const fn of listeners) fn()
}

export function resetSettings() {
  updateSettings(DEFAULTS)
}

/**
 * Light is the default, so the stylesheet's bare :root holds the light tokens
 * and only an explicit "dark" (or "system" on a dark OS) swaps them.
 */
export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

/** Strips a trailing slash so callers can always append "/v1/...". */
export function normalizeBase(base: string): string {
  const trimmed = base.trim()
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}
