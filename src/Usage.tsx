import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { fetchMetrics, quantileFromBuckets, sumAll, sumBy, type MetricFamily } from './api'
import { BarList, Card, Empty, PageHeader, Stat, shortModel, type BarRow } from './ui'
import { getSettings, subscribeSettings } from './settings'

const TOKENS = 'gen_ai_client_token_usage_sum'
const TOKENS_COUNT = 'gen_ai_client_token_usage_count'
const DURATION_SUM = 'gen_ai_server_request_duration_seconds_sum'
const DURATION_COUNT = 'gen_ai_server_request_duration_seconds_count'
const DURATION_BUCKET = 'gen_ai_server_request_duration_seconds_bucket'

export function Usage() {
  const [metrics, setMetrics] = useState<MetricFamily | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [auto, setAuto] = useState(true)
  const refreshSeconds = useSyncExternalStore(subscribeSettings, getSettings).usageRefreshSeconds

  const load = useCallback(async () => {
    try {
      setMetrics(await fetchMetrics())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
    if (!auto || refreshSeconds <= 0) return
    const id = setInterval(() => void load(), refreshSeconds * 1000)
    return () => clearInterval(id)
  }, [auto, load, refreshSeconds])

  const header = (
    <PageHeader
      title="Usage"
      subtitle="Live counters from the gateway's Prometheus endpoint on :1064/metrics."
      actions={
        <>
          <label className="switch">
            <input
              type="checkbox"
              checked={auto && refreshSeconds > 0}
              disabled={refreshSeconds <= 0}
              onChange={(e) => setAuto(e.target.checked)}
            />
            auto-refresh{refreshSeconds > 0 ? ` (${refreshSeconds}s)` : ' (off in settings)'}
          </label>
          <button className="btn ghost" onClick={() => void load()}>
            Refresh
          </button>
        </>
      }
    />
  )

  if (error) {
    return (
      <div className="page">
        {header}
        <Empty>
          <p className="warn">Could not read /metrics: {error}</p>
          <p className="muted small">Is the aigw container up? Check the status in the top bar.</p>
        </Empty>
      </div>
    )
  }

  if (!metrics) {
    return (
      <div className="page">
        {header}
        <Empty>
          <p className="muted">Loading metrics…</p>
        </Empty>
      </div>
    )
  }

  const requests = sumAll(metrics.get(DURATION_COUNT))

  if (requests === 0) {
    return (
      <div className="page">
        {header}
        <Empty>
          <p>No LLM requests since the gateway started.</p>
          <p className="muted small">
            aigw only exposes its <code>gen_ai</code> series once traffic has flowed. Send something
            from the Playground, then come back.
          </p>
        </Empty>
      </div>
    )
  }

  const tokensByType = sumBy(metrics.get(TOKENS), 'gen_ai_token_type')
  const inputTokens = tokensByType.get('input') ?? 0
  const outputTokens = tokensByType.get('output') ?? 0
  const durationSum = sumAll(metrics.get(DURATION_SUM))
  const avgMs = (durationSum / requests) * 1000
  const p50 = quantileFromBuckets(metrics.get(DURATION_BUCKET), 0.5)
  const p95 = quantileFromBuckets(metrics.get(DURATION_BUCKET), 0.95)

  const byModel = joinBars(
    sumBy(metrics.get(TOKENS), 'gen_ai_request_model'),
    sumBy(metrics.get(DURATION_COUNT), 'gen_ai_request_model'),
    shortModel,
  )
  const byOperation = joinBars(
    sumBy(metrics.get(TOKENS), 'gen_ai_operation_name'),
    sumBy(metrics.get(DURATION_COUNT), 'gen_ai_operation_name'),
  )
  const byTenant = joinBars(
    sumBy(metrics.get(TOKENS), 'tenant_id'),
    sumBy(metrics.get(TOKENS_COUNT), 'tenant_id'),
  )
  const byProvider = joinBars(
    sumBy(metrics.get(TOKENS), 'gen_ai_provider_name'),
    sumBy(metrics.get(DURATION_COUNT), 'gen_ai_provider_name'),
  )

  return (
    <div className="page">
      {header}

      <div className="stat-row">
        <Stat label="Requests" value={requests.toLocaleString()} />
        <Stat
          label="Total tokens"
          value={(inputTokens + outputTokens).toLocaleString()}
          hint={`${inputTokens.toLocaleString()} in · ${outputTokens.toLocaleString()} out`}
        />
        <Stat label="Avg latency" value={`${avgMs.toFixed(0)} ms`} />
        <Stat label="p50 latency" value={p50 === null ? '—' : `${(p50 * 1000).toFixed(0)} ms`} />
        <Stat label="p95 latency" value={p95 === null ? '—' : `${(p95 * 1000).toFixed(0)} ms`} />
      </div>

      <div className="card-grid">
        <Card title="Top models" aside={<span className="muted small">tokens · requests</span>}>
          <BarList rows={byModel} />
        </Card>
        <Card title="By operation" aside={<span className="muted small">tokens · requests</span>}>
          <BarList rows={byOperation} />
        </Card>
        <Card title="By tenant" aside={<span className="muted small">tokens · observations</span>}>
          <BarList
            rows={byTenant}
            empty="No tenant labels yet — send a request with an x-tenant-id header."
          />
        </Card>
        <Card title="By provider" aside={<span className="muted small">tokens · requests</span>}>
          <BarList rows={byProvider} />
        </Card>
      </div>

      <p className="muted small footnote">
        Counters are cumulative since the aigw container started and reset on restart — Prometheus
        keeps the history, and Grafana has rate-based views. Quantiles here are read off the raw
        cumulative histogram buckets, so they cover all time rather than a recent window.
      </p>
    </div>
  )
}

/** Pairs the primary (bar) metric with a secondary count shown beside it. */
function joinBars(
  primary: Map<string, number>,
  secondary: Map<string, number>,
  label: (k: string) => string = (k) => k,
): BarRow[] {
  const keys = new Set([...primary.keys(), ...secondary.keys()])
  return [...keys]
    .map((k) => ({
      label: label(k),
      value: primary.get(k) ?? 0,
      secondary: `${(secondary.get(k) ?? 0).toLocaleString()} req`,
    }))
    .sort((a, b) => b.value - a.value)
}
