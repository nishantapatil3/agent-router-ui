import { Fragment, useMemo, useState, useSyncExternalStore } from 'react'
import { clearEntries, getEntries, subscribe, type LogEntry } from './store'
import { getGatewayLog, retryGatewayLog, subscribeGatewayLog } from './gatewayLog'
import {
  Card,
  Empty,
  JsonBlock,
  KeyValue,
  PageHeader,
  Pill,
  formatDateTime,
  formatTime,
  shortModel,
  type PillTone,
} from './ui'

type Source = 'gateway' | 'browser'

const LOCAL_TONES: Record<LogEntry['status'], PillTone> = {
  success: 'success',
  error: 'error',
  stopped: 'warn',
  streaming: 'info',
}

export function Logs() {
  const [source, setSource] = useState<Source>('gateway')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div className="page">
      <PageHeader
        title="Request Logs"
        subtitle={
          source === 'gateway'
            ? "Every request the gateway served, read from its Envoy access log."
            : 'Requests this browser sent from the Playground, with full bodies.'
        }
        actions={
          <div className="segmented">
            <button
              className={source === 'gateway' ? 'active' : ''}
              onClick={() => {
                setSource('gateway')
                setExpanded(null)
              }}
            >
              Gateway
            </button>
            <button
              className={source === 'browser' ? 'active' : ''}
              onClick={() => {
                setSource('browser')
                setExpanded(null)
              }}
            >
              This browser
            </button>
          </div>
        }
      />

      {source === 'gateway' ? (
        <GatewayLogs query={query} setQuery={setQuery} expanded={expanded} setExpanded={setExpanded} />
      ) : (
        <BrowserLogs query={query} setQuery={setQuery} expanded={expanded} setExpanded={setExpanded} />
      )}
    </div>
  )
}

type ViewProps = {
  query: string
  setQuery: (q: string) => void
  expanded: string | null
  setExpanded: (id: string | null) => void
}

// ---------------------------------------------------------------- gateway

function statusTone(code: number): PillTone {
  if (code === 0) return 'warn'
  if (code < 400) return 'success'
  if (code < 500) return 'error'
  return 'error'
}

function GatewayLogs({ query, setQuery, expanded, setExpanded }: ViewProps) {
  const feed = useSyncExternalStore(subscribeGatewayLog, getGatewayLog)
  const [kind, setKind] = useState<'all' | 'llm' | 'mcp'>('all')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return feed.entries.filter((e) => {
      if (kind !== 'all' && e.kind !== kind) return false
      if (!q) return true
      return [e.id, e.model, e.tenantId, e.sessionId, e.path, e.mcpTool, String(e.status)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    })
  }, [feed.entries, kind, query])

  if (feed.status === 'error') {
    return (
      <Empty>
        <p className="warn">Gateway log stream unavailable.</p>
        <p className="muted small">{feed.error}</p>
        <p className="muted small">
          The dev server tails <code>docker compose logs -f aigw</code> for this view. It needs the
          stack running and <code>AIGW_DEBUG=true</code> in <code>.env</code> — Envoy only writes
          access logs to the console in debug mode. Switch to <b>This browser</b> for requests sent
          from the Playground.
        </p>
        <button className="btn ghost sm" onClick={() => retryGatewayLog()}>
          Retry
        </button>
      </Empty>
    )
  }

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          value={query}
          placeholder="Search by request id, model, tenant, session, path or status…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="segmented">
          {([['all', 'All'], ['llm', 'LLM'], ['mcp', 'MCP']] as const).map(([k, label]) => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
              {label}
            </button>
          ))}
        </div>
        <span className="toolbar-count muted small">
          <span className={`feed-dot ${feed.status}`} />
          {feed.status === 'connecting' ? 'connecting…' : 'live'} ·{' '}
          {rows.length === feed.entries.length
            ? `${rows.length} request${rows.length === 1 ? '' : 's'}`
            : `${rows.length} of ${feed.entries.length}`}
        </span>
      </div>

      {feed.entries.length === 0 ? (
        <Empty>
          <p>{feed.status === 'connecting' ? 'Reading the gateway access log…' : 'No requests yet.'}</p>
          <p className="muted small">
            Anything that goes through the gateway shows up here — the Playground, curl, your own
            apps. Only LLM and MCP requests are logged.
          </p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="w-chev" />
                <th>Time</th>
                <th>Status</th>
                <th>Request ID</th>
                <th>Model / Tool</th>
                <th className="num">Tokens</th>
                <th className="num">Latency</th>
                <th>Tenant</th>
                <th>Session</th>
                <th>Client</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const open = expanded === e.id
                const tokens =
                  e.inputTokens !== undefined || e.outputTokens !== undefined
                    ? (e.inputTokens ?? 0) + (e.outputTokens ?? 0)
                    : undefined
                return (
                  <Fragment key={e.id}>
                    <tr className={`row ${open ? 'open' : ''}`} onClick={() => setExpanded(open ? null : e.id)}>
                      <td className="w-chev">
                        <span className={`chev ${open ? 'open' : ''}`}>›</span>
                      </td>
                      <td className="mono nowrap">{formatTime(e.at)}</td>
                      <td>
                        <Pill tone={statusTone(e.status)}>{e.status === 0 ? 'no response' : e.status}</Pill>
                      </td>
                      <td className="mono truncate" title={e.id}>
                        {e.id}
                      </td>
                      <td className="truncate" title={e.model ?? e.mcpTool ?? e.mcpMethod}>
                        {e.kind === 'mcp' ? (
                          <>
                            <Pill tone="neutral">MCP</Pill>{' '}
                            {e.mcpTool ?? e.mcpMethod ?? '—'}
                          </>
                        ) : (
                          shortModel(e.model ?? '—')
                        )}
                      </td>
                      <td className="num mono nowrap">
                        {tokens !== undefined ? (
                          <>
                            {tokens}
                            <em className="sub">
                              {e.inputTokens ?? 0}+{e.outputTokens ?? 0}
                            </em>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num mono nowrap">
                        {e.durationMs !== undefined ? `${e.durationMs} ms` : '—'}
                      </td>
                      <td className="truncate">{e.tenantId ?? '—'}</td>
                      <td className="truncate">{e.sessionId ?? '—'}</td>
                      <td className="truncate" title={e.userAgent}>
                        {clientName(e.userAgent)}
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td colSpan={10}>
                          <div className="detail">
                            <Card title="Request details">
                              <KeyValue
                                rows={[
                                  ['Request ID', <span className="mono">{e.id}</span>],
                                  ['Time', formatDateTime(e.at)],
                                  ['Status', <Pill tone={statusTone(e.status)}>{e.status === 0 ? 'no response' : e.status}</Pill>],
                                  ['Path', <span className="mono">{`${e.method ?? ''} ${e.path ?? '—'}`.trim()}</span>],
                                  ['Requested model', <span className="mono">{e.model ?? '—'}</span>],
                                  ['Response model', <span className="mono">{e.responseModel ?? '—'}</span>],
                                  [
                                    'Tokens',
                                    tokens !== undefined
                                      ? `${tokens} (${e.inputTokens ?? 0} in + ${e.outputTokens ?? 0} out)`
                                      : '—',
                                  ],
                                  ['Latency', e.durationMs !== undefined ? `${e.durationMs} ms` : '—'],
                                  ['Upstream', <span className="mono">{e.upstreamHost ?? '—'}</span>],
                                  ['x-tenant-id', <span className="mono">{e.tenantId ?? '—'}</span>],
                                  ['Session', <span className="mono">{e.sessionId ?? '—'}</span>],
                                  ['Client', <span className="mono">{e.userAgent ?? '—'}</span>],
                                ]}
                              />
                            </Card>
                            <JsonBlock title="Access log entry" value={e.raw} />
                            <p className="muted small" style={{ margin: '12px 0 0' }}>
                              Envoy logs metadata, not bodies. For the request and response payloads
                              of something you sent from the Playground, switch to <b>This browser</b>.
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/** Turns a User-Agent into something readable in a dense column. */
function clientName(ua?: string): string {
  if (!ua) return '—'
  if (ua.startsWith('curl/')) return ua
  if (/Mozilla/.test(ua)) return 'browser'
  return ua.split(/[ /]/)[0]
}

// ---------------------------------------------------------------- browser

function BrowserLogs({ query, setQuery, expanded, setExpanded }: ViewProps) {
  const entries = useSyncExternalStore(subscribe, getEntries)
  const [status, setStatus] = useState<'all' | LogEntry['status']>('all')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (status !== 'all' && e.status !== status) return false
      if (!q) return true
      return (
        e.id.toLowerCase().includes(q) ||
        e.model.toLowerCase().includes(q) ||
        e.tenantId.toLowerCase().includes(q) ||
        e.sessionId.toLowerCase().includes(q)
      )
    })
  }, [entries, query, status])

  return (
    <>
      <div className="toolbar">
        <input
          className="search"
          value={query}
          placeholder="Search by request id, model, tenant or session…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="segmented">
          {([['all', 'All'], ['success', 'Success'], ['error', 'Error'], ['stopped', 'Stopped']] as const).map(
            ([s, label]) => (
              <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
                {label}
              </button>
            ),
          )}
        </div>
        <span className="toolbar-count muted small">
          {rows.length === entries.length
            ? `${rows.length} request${rows.length === 1 ? '' : 's'}`
            : `${rows.length} of ${entries.length}`}
        </span>
        <button
          className="btn ghost sm"
          onClick={() => {
            clearEntries()
            setExpanded(null)
          }}
          disabled={entries.length === 0}
        >
          Clear
        </button>
      </div>

      {entries.length === 0 ? (
        <Empty>
          <p>Nothing sent from this browser yet.</p>
          <p className="muted small">
            This view records requests the Playground makes here, keeping the full request and
            response bodies. For everything the gateway served — including other clients — use the{' '}
            <b>Gateway</b> tab.
          </p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="w-chev" />
                <th>Time</th>
                <th>Status</th>
                <th>Request ID</th>
                <th>Model</th>
                <th className="num">Tokens</th>
                <th className="num">Latency</th>
                <th>Tenant</th>
                <th>Session</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const open = expanded === e.id
                return (
                  <Fragment key={e.id}>
                    <tr className={`row ${open ? 'open' : ''}`} onClick={() => setExpanded(open ? null : e.id)}>
                      <td className="w-chev">
                        <span className={`chev ${open ? 'open' : ''}`}>›</span>
                      </td>
                      <td className="mono nowrap">{formatTime(e.at)}</td>
                      <td>
                        <Pill tone={LOCAL_TONES[e.status]}>{e.status}</Pill>
                      </td>
                      <td className="mono truncate" title={e.id}>
                        {e.id}
                      </td>
                      <td className="truncate" title={e.model}>
                        {shortModel(e.model)}
                      </td>
                      <td className="num mono nowrap">
                        {e.usage?.total_tokens !== undefined ? (
                          <>
                            {e.usage.total_tokens}
                            <em className="sub">
                              {e.usage.prompt_tokens ?? 0}+{e.usage.completion_tokens ?? 0}
                            </em>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num mono nowrap">{e.ms !== undefined ? `${e.ms} ms` : '—'}</td>
                      <td className="truncate">{e.tenantId || '—'}</td>
                      <td className="truncate">{e.sessionId || '—'}</td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td colSpan={9}>
                          <BrowserDetail entry={e} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function BrowserDetail({ entry }: { entry: LogEntry }) {
  return (
    <div className="detail">
      <Card title="Request details">
        <KeyValue
          rows={[
            ['Request ID', <span className="mono">{entry.id}</span>],
            ['Started', formatDateTime(entry.at)],
            ['Model', <span className="mono">{entry.model}</span>],
            ['Status', <Pill tone={LOCAL_TONES[entry.status]}>{entry.status}</Pill>],
            [
              'Tokens',
              entry.usage?.total_tokens !== undefined
                ? `${entry.usage.total_tokens} (${entry.usage.prompt_tokens ?? 0} in + ${
                    entry.usage.completion_tokens ?? 0
                  } out)`
                : '—',
            ],
            ['Total latency', entry.ms !== undefined ? `${entry.ms} ms` : '—'],
            ['Time to first token', entry.ttfbMs !== undefined ? `${entry.ttfbMs} ms` : '—'],
            ['x-tenant-id', <span className="mono">{entry.tenantId || '—'}</span>],
            ['agent-session-id', <span className="mono">{entry.sessionId || '—'}</span>],
          ]}
        />
        {entry.error && <p className="error-line">{entry.error}</p>}
      </Card>

      <div className="detail-panes">
        <JsonBlock title="Request" value={entry.request} />
        <JsonBlock title="Response" value={entry.response ?? { note: 'no response body recorded' }} />
      </div>
    </div>
  )
}
