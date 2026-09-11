import { useEffect, useState } from 'react'
import { mcpCallTool, mcpConnect, mcpListTools, type McpTool } from './api'
import { Card, CopyButton, Empty, JsonBlock, PageHeader, Pill } from './ui'

export function Tools() {
  const [tools, setTools] = useState<McpTool[]>([])
  const [session, setSession] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [args, setArgs] = useState('{}')
  const [result, setResult] = useState<unknown>(null)
  const [resultError, setResultError] = useState<string | null>(null)
  const [calling, setCalling] = useState(false)
  const [ms, setMs] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const sid = await mcpConnect()
        const list = await mcpListTools(sid)
        if (!live) return
        setSession(sid)
        setTools(list)
      } catch (e) {
        if (live) setError((e as Error).message)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const tool = tools.find((t) => t.name === selected) ?? null

  async function call() {
    if (!session || !tool) return
    setCalling(true)
    setResult(null)
    setResultError(null)
    setMs(null)
    const started = performance.now()
    try {
      const parsed = JSON.parse(args || '{}')
      setResult(await mcpCallTool(session, tool.name, parsed))
    } catch (e) {
      setResultError((e as Error).message)
    } finally {
      setMs(Math.round(performance.now() - started))
      setCalling(false)
    }
  }

  const header = (
    <PageHeader
      title="MCP Tools"
      subtitle="Tools aggregated by the gateway's MCP endpoint at /mcp."
      actions={
        session ? (
          <span className="muted small">
            session <span className="mono">{session.slice(0, 12)}…</span>
            <CopyButton text={session} label="copy id" />
          </span>
        ) : undefined
      }
    />
  )

  if (error) {
    return (
      <div className="page">
        {header}
        <Empty>
          <p className="warn">Could not reach the MCP gateway: {error}</p>
          <p className="muted small">
            MCP backends are declared as <code>MCPRoute</code> backendRefs in{' '}
            <code>config/aigw.yaml</code>. Restart aigw after editing it.
          </p>
        </Empty>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="page">
        {header}
        <Empty>
          <p className="muted">Connecting to /mcp…</p>
        </Empty>
      </div>
    )
  }

  return (
    <div className="page">
      {header}

      <div className="tools-grid">
        <aside className="side-panel">
          <div className="side-head">
            <h2>Tools</h2>
            <Pill tone="info">{tools.length}</Pill>
          </div>
          <p className="muted small">
            Namespaced <code>&lt;backend&gt;__&lt;tool&gt;</code>, one prefix per configured MCP
            server.
          </p>
          <ul className="tool-list">
            {tools.map((t) => (
              <li key={t.name}>
                <button
                  className={`tool-item ${t.name === selected ? 'active' : ''}`}
                  onClick={() => {
                    setSelected(t.name)
                    setArgs(seedArgs(t))
                    setResult(null)
                    setResultError(null)
                    setMs(null)
                  }}
                >
                  <span className="tool-name">{t.name}</span>
                  {t.description && <span className="tool-desc">{t.description}</span>}
                </button>
              </li>
            ))}
            {tools.length === 0 && <li className="muted small">No tools exposed.</li>}
          </ul>
        </aside>

        <section className="tool-detail">
          {!tool && (
            <Empty>
              <p>Pick a tool to inspect its schema and call it.</p>
            </Empty>
          )}
          {tool && (
            <>
              <Card
                title={tool.name}
                aside={
                  <div className="row-actions">
                    <button className="btn ghost sm" onClick={() => setArgs(seedArgs(tool))}>
                      Reset args
                    </button>
                    <button className="btn sm" onClick={() => void call()} disabled={calling}>
                      {calling ? 'Calling…' : 'Call tool'}
                    </button>
                  </div>
                }
              >
                {tool.description && <Description text={tool.description} />}
                <label>
                  Arguments (JSON)
                  <textarea
                    className="mono"
                    rows={8}
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    spellCheck={false}
                  />
                </label>
              </Card>

              {(result !== null || resultError) && (
                <Card
                  title="Result"
                  aside={
                    <span className="muted small">
                      {resultError ? <Pill tone="error">failed</Pill> : <Pill tone="success">ok</Pill>}
                      {ms !== null && ` ${ms} ms`}
                    </span>
                  }
                >
                  {resultError ? (
                    <p className="error-line">{resultError}</p>
                  ) : (
                    <JsonBlock value={result} />
                  )}
                </Card>
              )}

              <Card title="Input schema">
                <JsonBlock value={tool.inputSchema ?? {}} />
              </Card>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/** Tool descriptions can run to several hundred words of prompt guidance, which
 * would bury the call form, so clamp them until asked. */
function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 260
  return (
    <div className={`tool-blurb ${long && !open ? 'clamped' : ''}`}>
      <p>{text}</p>
      {long && (
        <button className="icon-btn" onClick={() => setOpen((o) => !o)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

/** Pre-fills the argument editor from the tool's required schema keys, so a call
 * does not start from a blank object. */
function seedArgs(tool: McpTool): string {
  const schema = tool.inputSchema as
    | { properties?: Record<string, { type?: string }>; required?: string[] }
    | undefined
  const required = schema?.required ?? []
  if (!schema?.properties || required.length === 0) return '{}'
  const seed: Record<string, unknown> = {}
  for (const key of required) {
    switch (schema.properties[key]?.type) {
      case 'number':
      case 'integer':
        seed[key] = 0
        break
      case 'boolean':
        seed[key] = false
        break
      case 'array':
        seed[key] = []
        break
      case 'object':
        seed[key] = {}
        break
      default:
        seed[key] = ''
    }
  }
  return JSON.stringify(seed, null, 2)
}
