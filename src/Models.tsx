import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchMetrics,
  listModels,
  sumBy,
  testModel,
  type MetricFamily,
  type Model,
  type ModelTest,
} from './api'
import { Card, CopyButton, Empty, JsonBlock, KeyValue, PageHeader, Pill, Stat, shortModel } from './ui'

const TOKENS = 'gen_ai_client_token_usage_sum'
const DURATION_SUM = 'gen_ai_server_request_duration_seconds_sum'
const DURATION_COUNT = 'gen_ai_server_request_duration_seconds_count'

type Row = {
  id: string
  /** false for models seen only in metrics, i.e. routed via the catch-all rule. */
  declared: boolean
  ownedBy?: string
  created?: number
  requests: number
  tokens: number
  avgMs: number | null
}

export function Models() {
  const [models, setModels] = useState<Model[] | null>(null)
  const [metrics, setMetrics] = useState<MetricFamily | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [tests, setTests] = useState<Record<string, ModelTest | 'running'>>({})

  const load = useCallback(async () => {
    try {
      const [m, mx] = await Promise.all([listModels(), fetchMetrics().catch(() => null)])
      setModels(m)
      setMetrics(mx)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo<Row[]>(() => {
    if (!models) return []
    const reqByModel = sumBy(metrics?.get(DURATION_COUNT), 'gen_ai_request_model')
    const tokByModel = sumBy(metrics?.get(TOKENS), 'gen_ai_request_model')
    const durByModel = sumBy(metrics?.get(DURATION_SUM), 'gen_ai_request_model')

    const ids = new Set<string>([...models.map((m) => m.id), ...reqByModel.keys()])
    const declared = new Map(models.map((m) => [m.id, m]))

    return [...ids]
      .map((id) => {
        const requests = reqByModel.get(id) ?? 0
        const seconds = durByModel.get(id) ?? 0
        return {
          id,
          declared: declared.has(id),
          ownedBy: declared.get(id)?.owned_by,
          created: declared.get(id)?.created,
          requests,
          tokens: tokByModel.get(id) ?? 0,
          avgMs: requests ? (seconds / requests) * 1000 : null,
        }
      })
      .sort((a, b) => Number(b.declared) - Number(a.declared) || b.tokens - a.tokens || a.id.localeCompare(b.id))
  }, [models, metrics])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? rows.filter((r) => r.id.toLowerCase().includes(q)) : rows
  }, [rows, query])

  async function runTest(id: string) {
    setTests((t) => ({ ...t, [id]: 'running' }))
    const result = await testModel(id, { tenantId: 'tenant-webui', sessionId: 'model-test' })
    setTests((t) => ({ ...t, [id]: result }))
    // A test is real traffic, so the usage columns move with it.
    void load()
  }

  const selectedRow = filtered.find((r) => r.id === selected) ?? rows.find((r) => r.id === selected)
  if (selectedRow) {
    return (
      <ModelDetail
        row={selectedRow}
        raw={models?.find((m) => m.id === selectedRow.id)}
        test={tests[selectedRow.id]}
        onTest={() => void runTest(selectedRow.id)}
        onBack={() => setSelected(null)}
      />
    )
  }

  const header = (
    <PageHeader
      title="Models"
      subtitle="Models the gateway advertises on /v1/models, joined with live usage."
      actions={
        <button className="btn ghost" onClick={() => void load()}>
          Refresh
        </button>
      }
    />
  )

  if (error) {
    return (
      <div className="page">
        {header}
        <Empty>
          <p className="warn">Could not read /v1/models: {error}</p>
        </Empty>
      </div>
    )
  }

  if (!models) {
    return (
      <div className="page">
        {header}
        <Empty>
          <p className="muted">Loading models…</p>
        </Empty>
      </div>
    )
  }

  return (
    <div className="page">
      {header}

      <div className="toolbar">
        <input
          className="search"
          value={query}
          placeholder="Search model names…"
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="toolbar-count muted small">
          {filtered.length === rows.length
            ? `${rows.length} model${rows.length === 1 ? '' : 's'}`
            : `${filtered.length} of ${rows.length}`}
        </span>
      </div>

      {rows.length === 0 ? (
        <Empty>
          <p>The gateway advertises no models.</p>
          <p className="muted small">
            aigw populates <code>/v1/models</code> only from <code>type: Exact</code>{' '}
            <code>x-ai-eg-model</code> matches in the <code>AIGatewayRoute</code>. Add them to{' '}
            <code>config/aigw.yaml</code> and restart aigw.
          </p>
        </Empty>
      ) : (
        <div className="table-wrap">
          <table className="data models-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Model ID</th>
                <th>Owner</th>
                <th>Source</th>
                <th className="num">Requests</th>
                <th className="num">Tokens</th>
                <th className="num">Avg latency</th>
                <th>Connection</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const t = tests[r.id]
                return (
                  <tr key={r.id} className="row" onClick={() => setSelected(r.id)}>
                    <td className="strong">{shortModel(r.id)}</td>
                    <td className="mono truncate" title={r.id}>
                      {r.id}
                    </td>
                    <td>{r.ownedBy ?? '—'}</td>
                    <td>
                      {r.declared ? (
                        <Pill tone="info">declared</Pill>
                      ) : (
                        <Pill tone="neutral">catch-all</Pill>
                      )}
                    </td>
                    <td className="num mono">{r.requests.toLocaleString()}</td>
                    <td className="num mono">{r.tokens.toLocaleString()}</td>
                    <td className="num mono nowrap">
                      {r.avgMs === null ? '—' : `${r.avgMs.toFixed(0)} ms`}
                    </td>
                    <td>
                      {t === undefined && <span className="muted">not tested</span>}
                      {t === 'running' && <Pill tone="info">testing…</Pill>}
                      {t && t !== 'running' && (
                        <span className="conn">
                          <Pill tone={t.ok ? 'success' : 'error'}>{t.ok ? 'ok' : 'failed'}</Pill>
                          <em>{t.ms} ms</em>
                        </span>
                      )}
                    </td>
                    <td className="nowrap">
                      <button
                        className="btn ghost sm"
                        disabled={t === 'running'}
                        onClick={(e) => {
                          e.stopPropagation()
                          void runTest(r.id)
                        }}
                      >
                        Test
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted small footnote">
        Models are declarative: aigw reads them from <code>config/aigw.yaml</code> at startup, and
        exposes no admin API to add or remove one, so this page is read-only. Rows marked{' '}
        <em>catch-all</em> have served traffic but are not advertised on <code>/v1/models</code> —
        they matched the regex rule rather than an Exact one. <em>Test</em> sends a real one-token
        completion through the gateway.
      </p>
    </div>
  )
}

function ModelDetail({
  row,
  raw,
  test,
  onTest,
  onBack,
}: {
  row: Row
  raw?: Model
  test?: ModelTest | 'running'
  onTest: () => void
  onBack: () => void
}) {
  const [tab, setTab] = useState<'overview' | 'raw'>('overview')

  return (
    <div className="page">
      <button className="back-link" onClick={onBack}>
        ← Back to Models
      </button>

      <div className="detail-head">
        <div>
          <h1>{shortModel(row.id)}</h1>
          <p className="mono detail-id">
            {row.id}
            <CopyButton text={row.id} />
          </p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={onTest} disabled={test === 'running'}>
            {test === 'running' ? 'Testing…' : 'Test connection'}
          </button>
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>
          Overview
        </button>
        <button className={tab === 'raw' ? 'active' : ''} onClick={() => setTab('raw')}>
          Raw JSON
        </button>
      </div>

      {test && test !== 'running' && (
        <div className={`banner ${test.ok ? 'ok' : 'bad'}`}>
          <Pill tone={test.ok ? 'success' : 'error'}>{test.ok ? 'reachable' : 'failed'}</Pill>
          <span>{test.detail}</span>
          <span className="muted small">{test.ms} ms</span>
        </div>
      )}

      {tab === 'overview' ? (
        <>
          <div className="stat-row">
            <Stat label="Requests" value={row.requests.toLocaleString()} />
            <Stat label="Tokens" value={row.tokens.toLocaleString()} />
            <Stat
              label="Avg latency"
              value={row.avgMs === null ? '—' : `${row.avgMs.toFixed(0)} ms`}
            />
          </div>

          <Card title="Model details">
            <KeyValue
              rows={[
                ['Model ID', <span className="mono">{row.id}</span>],
                ['Owned by', row.ownedBy ?? '—'],
                [
                  'Created',
                  row.created ? new Date(row.created * 1000).toLocaleDateString() : '—',
                ],
                [
                  'Source',
                  row.declared ? (
                    <Pill tone="info">declared</Pill>
                  ) : (
                    <Pill tone="neutral">catch-all</Pill>
                  ),
                ],
                ['Backend', <span className="mono">litellm</span>],
              ]}
            />
          </Card>

          <Card title="Routing">
            <p className="muted small" style={{ margin: 0, maxWidth: '82ch' }}>
              {row.declared ? (
                <>
                  Declared by an Exact <code>x-ai-eg-model</code> match in the{' '}
                  <code>AIGatewayRoute</code>, which is what puts it on <code>/v1/models</code>. It
                  routes to the <code>litellm</code> AIServiceBackend, where aigw swaps the client's
                  Authorization header for the key in the <code>BackendSecurityPolicy</code>.
                </>
              ) : (
                <>
                  Not advertised on <code>/v1/models</code> — this model has served traffic through
                  the regex catch-all rule. Add an Exact <code>x-ai-eg-model</code> match in{' '}
                  <code>config/aigw.yaml</code> to have the gateway declare it.
                </>
              )}
            </p>
          </Card>
        </>
      ) : (
        <Card title="/v1/models entry">
          <JsonBlock
            value={raw ?? { note: 'Not advertised on /v1/models; seen in metrics only.' }}
          />
        </Card>
      )}
    </div>
  )
}
