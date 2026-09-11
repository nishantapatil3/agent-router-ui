import { useState, useSyncExternalStore } from 'react'
import {
  DEFAULTS,
  PROXY_TARGETS,
  getSettings,
  normalizeBase,
  resetSettings,
  subscribeSettings,
  updateSettings,
  type Theme,
} from './settings'
import { Card, KeyValue, PageHeader, Pill } from './ui'

const THEMES: { id: Theme; label: string; hint: string }[] = [
  { id: 'light', label: 'Light', hint: 'Default' },
  { id: 'dark', label: 'Dark', hint: '' },
  { id: 'system', label: 'System', hint: 'Follow OS' },
]

export function SettingsPage() {
  const settings = useSyncExternalStore(subscribeSettings, getSettings)
  const [probe, setProbe] = useState<{ ok: boolean; text: string } | null>(null)
  const [probing, setProbing] = useState(false)

  const usingProxy =
    settings.gatewayBase === DEFAULTS.gatewayBase && settings.adminBase === DEFAULTS.adminBase

  async function testEndpoints() {
    setProbing(true)
    setProbe(null)
    const results: string[] = []
    let ok = true
    for (const [name, url] of [
      ['gateway', `${normalizeBase(settings.gatewayBase)}/v1/models`],
      ['admin', `${normalizeBase(settings.adminBase)}/health`],
    ] as const) {
      try {
        const res = await fetch(url)
        results.push(`${name} ${res.status}`)
        if (!res.ok) ok = false
      } catch (e) {
        // A cross-origin failure lands here with an opaque message; say so.
        results.push(`${name} unreachable (${(e as Error).message || 'blocked'})`)
        ok = false
      }
    }
    setProbe({ ok, text: results.join(' · ') })
    setProbing(false)
  }

  return (
    <div className="page settings-page">
      <PageHeader
        title="Settings"
        subtitle="Stored in this browser only — nothing is sent to the gateway."
        actions={
          <button
            className="btn ghost"
            onClick={() => {
              resetSettings()
              setProbe(null)
            }}
          >
            Reset to defaults
          </button>
        }
      />

      <Card title="Appearance">
        <label className="label-only">Theme</label>
        <div className="theme-picker">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-option ${settings.theme === t.id ? 'active' : ''}`}
              onClick={() => updateSettings({ theme: t.id })}
            >
              <span className={`swatch ${t.id}`} aria-hidden>
                <i />
                <i />
              </span>
              <span className="theme-name">{t.label}</span>
              {t.hint && <span className="muted small">{t.hint}</span>}
            </button>
          ))}
        </div>
      </Card>

      <Card
        title="Endpoints"
        aside={
          <button className="btn ghost sm" onClick={() => void testEndpoints()} disabled={probing}>
            {probing ? 'Testing…' : 'Test endpoints'}
          </button>
        }
      >
        <p className="muted small settings-note">
          By default the UI calls the Vite dev server, which proxies to the gateway — the gateway
          itself sends no CORS headers, so the browser cannot call it directly unless something in
          front of it adds them. Change these only if you are pointing at a proxy that does.
        </p>

        <div className="field-row">
          <label>
            Gateway base <span className="muted">(/v1/*, /mcp)</span>
            <input
              value={settings.gatewayBase}
              onChange={(e) => updateSettings({ gatewayBase: e.target.value })}
              spellCheck={false}
            />
          </label>
          <label>
            Admin base <span className="muted">(/health, /metrics)</span>
            <input
              value={settings.adminBase}
              onChange={(e) => updateSettings({ adminBase: e.target.value })}
              spellCheck={false}
            />
          </label>
        </div>

        {probe && (
          <div className={`banner ${probe.ok ? 'ok' : 'bad'}`}>
            <Pill tone={probe.ok ? 'success' : 'error'}>{probe.ok ? 'reachable' : 'failed'}</Pill>
            <span className="mono small">{probe.text}</span>
          </div>
        )}

        <KeyValue
          rows={[
            [
              'Mode',
              usingProxy ? (
                <Pill tone="info">dev-server proxy</Pill>
              ) : (
                <Pill tone="warn">direct / custom</Pill>
              ),
            ],
            ['Proxy → gateway', <span className="mono">{PROXY_TARGETS.gateway}</span>],
            ['Proxy → admin', <span className="mono">{PROXY_TARGETS.admin}</span>],
          ]}
        />
        <p className="muted small settings-note">
          The proxy targets come from <code>AIGW_URL</code> / <code>AIGW_ADMIN_URL</code> when the
          dev server starts, so changing those needs a restart of <code>npm run dev</code>.
        </p>
      </Card>

      <Card title="Playground defaults">
        <p className="muted small settings-note">
          Applied to new sessions; the Playground's own controls still override them per request.
        </p>
        <div className="field-row">
          <label>
            Default model
            <input
              value={settings.defaultModel}
              placeholder="(first model from /v1/models)"
              onChange={(e) => updateSettings({ defaultModel: e.target.value })}
              spellCheck={false}
            />
          </label>
        </div>
        <div className="field-row">
          <label>
            Temperature
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={settings.temperature}
              onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
            />
          </label>
          <label>
            Max tokens
            <input
              type="number"
              min={1}
              step={64}
              value={settings.maxTokens}
              onChange={(e) => updateSettings({ maxTokens: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="field-row">
          <label>
            x-tenant-id
            <input
              value={settings.tenantId}
              onChange={(e) => updateSettings({ tenantId: e.target.value })}
            />
          </label>
          <label>
            agent-session-id
            <input
              value={settings.sessionId}
              onChange={(e) => updateSettings({ sessionId: e.target.value })}
            />
          </label>
        </div>
      </Card>

      <Card title="Data">
        <div className="field-row">
          <label>
            Usage auto-refresh <span className="muted">(seconds, 0 = off)</span>
            <input
              type="number"
              min={0}
              max={300}
              step={1}
              value={settings.usageRefreshSeconds}
              onChange={(e) => updateSettings({ usageRefreshSeconds: Number(e.target.value) })}
            />
          </label>
        </div>
      </Card>
    </div>
  )
}
