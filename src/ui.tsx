// Shared presentational primitives, in the spirit of LiteLLM's admin UI:
// titled cards, status pills, stat tiles, horizontal "top N" bar lists.

import { useState, type ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Card({
  title,
  aside,
  children,
  className = '',
}: {
  title?: string
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card ${className}`}>
      {(title || aside) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {aside && <div className="card-aside">{aside}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  )
}

export type PillTone = 'success' | 'error' | 'neutral' | 'info' | 'warn'

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  )
}

export type BarRow = { label: string; value: number; secondary?: string }

/** Horizontal bar list, LiteLLM's "Top API Keys" / "Top Models" pattern. */
export function BarList({ rows, empty = 'No data yet.' }: { rows: BarRow[]; empty?: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>
  const max = Math.max(...rows.map((r) => r.value), 1)
  return (
    <ul className="bar-list">
      {rows.map((r) => (
        <li key={r.label}>
          <span className="bar-name" title={r.label}>
            {r.label}
          </span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${Math.max((r.value / max) * 100, 1.5)}%` }} />
          </span>
          <span className="bar-value">
            {r.value.toLocaleString()}
            {r.secondary && <em>{r.secondary}</em>}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="icon-btn"
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        } catch {
          setDone(false)
        }
      }}
    >
      {done ? '✓ copied' : label}
    </button>
  )
}

export function JsonBlock({ value, title }: { value: unknown; title?: string }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <div className="json-block">
      {title && (
        <header>
          <span>{title}</span>
          <CopyButton text={text} />
        </header>
      )}
      <pre>{text}</pre>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>
}

/** Strips the provider prefix so long ids stay readable in dense tables. */
export function shortModel(id: string): string {
  const tail = id.split('/').pop() ?? id
  return tail.replace(/^global\./, '').replace(/^anthropic\./, '')
}

export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour12: false })
}

export function formatDateTime(at: number): string {
  return new Date(at).toLocaleString([], { hour12: false })
}
