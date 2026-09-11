import { useEffect, useMemo, useRef, useState } from 'react'
import { listModels, streamChat, type ChatMessage, type Model, type Usage } from './api'
import { startEntry, updateEntry } from './store'
import { getSettings } from './settings'
import { Empty, PageHeader, Pill, shortModel } from './ui'

type Turn = ChatMessage & {
  usage?: Usage
  ms?: number
  ttfbMs?: number
  error?: string
}

export function Playground() {
  // Seeded once from Settings; the controls below own the values after that.
  const defaults = getSettings()
  const [models, setModels] = useState<Model[]>([])
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [model, setModel] = useState(defaults.defaultModel)
  const [systemPrompt, setSystemPrompt] = useState('')
  const [temperature, setTemperature] = useState(defaults.temperature)
  const [maxTokens, setMaxTokens] = useState(defaults.maxTokens)
  const [tenantId, setTenantId] = useState(defaults.tenantId)
  const [sessionId, setSessionId] = useState(defaults.sessionId)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listModels()
      .then((m) => {
        setModels(m)
        setModel((cur) => cur || m[0]?.id || '')
      })
      .catch((e: Error) => setModelsError(e.message))
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [turns])

  const totals = useMemo(() => {
    let input = 0
    let output = 0
    for (const t of turns) {
      input += t.usage?.prompt_tokens ?? 0
      output += t.usage?.completion_tokens ?? 0
    }
    return { input, output }
  }, [turns])

  async function send() {
    const prompt = input.trim()
    if (!prompt || !model || busy) return

    const messages: ChatMessage[] = [
      ...(systemPrompt.trim() ? [{ role: 'system' as const, content: systemPrompt.trim() }] : []),
      ...turns.filter((t) => !t.error).map(({ role, content }) => ({ role, content })),
      { role: 'user' as const, content: prompt },
    ]

    setInput('')
    setTurns((prev) => [...prev, { role: 'user', content: prompt }, { role: 'assistant', content: '' }])
    setBusy(true)

    const controller = new AbortController()
    abortRef.current = controller
    const started = performance.now()
    let ttfb: number | undefined
    let text = ''
    let usage: Usage | undefined

    // Every playground request lands in the shared log, which is what the Logs
    // page reads.
    const entryId = startEntry({ model, tenantId, sessionId, messages, temperature, maxTokens })

    // The streamed assistant turn is always last, so updates patch it in place.
    const patchLast = (fn: (t: Turn) => Turn) =>
      setTurns((prev) => prev.map((t, i) => (i === prev.length - 1 ? fn(t) : t)))

    try {
      await streamChat(
        {
          model,
          messages,
          temperature,
          maxTokens,
          attribution: { tenantId, sessionId },
          signal: controller.signal,
        },
        {
          onDelta: (delta) => {
            if (ttfb === undefined) {
              ttfb = Math.round(performance.now() - started)
              patchLast((t) => ({ ...t, ttfbMs: ttfb }))
            }
            text += delta
            patchLast((t) => ({ ...t, content: t.content + delta }))
          },
          onUsage: (u) => {
            usage = u
            patchLast((t) => ({ ...t, usage: u }))
          },
        },
      )
      const ms = Math.round(performance.now() - started)
      patchLast((t) => ({ ...t, ms }))
      updateEntry(entryId, {
        status: 'success',
        ms,
        ttfbMs: ttfb,
        usage,
        response: {
          model,
          usage,
          choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        },
      })
    } catch (e) {
      const stopped = controller.signal.aborted
      const msg = stopped ? 'stopped' : (e as Error).message
      const ms = Math.round(performance.now() - started)
      patchLast((t) => ({ ...t, error: msg, ms }))
      updateEntry(entryId, {
        status: stopped ? 'stopped' : 'error',
        ms,
        ttfbMs: ttfb,
        usage,
        error: msg,
        // Partial text is worth keeping — it is what the model produced before
        // the stream broke.
        response: text ? { partial: text } : undefined,
      })
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  return (
    <div className="page playground">
      <PageHeader
        title="Playground"
        subtitle="Send chat completions through the gateway and watch them stream."
      />

      <div className="playground-grid">
        <aside className="side-panel">
          <label>
            Model
            {models.length > 0 ? (
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {shortModel(m.id)}
                  </option>
                ))}
              </select>
            ) : (
              <input value={model} placeholder="model id" onChange={(e) => setModel(e.target.value)} />
            )}
          </label>
          {models.length > 0 && (
            <p className="muted small">
              {models.length} from <code>/v1/models</code>
              {models[0]?.owned_by ? ` · ${models[0].owned_by}` : ''}
            </p>
          )}
          {modelsError && (
            <p className="muted small warn">
              Could not read <code>/v1/models</code> ({modelsError}). Type a model id — undeclared
              models still route through the catch-all rule.
            </p>
          )}
          {!modelsError && models.length === 0 && (
            <p className="muted small">
              The gateway advertises no models. Add Exact <code>x-ai-eg-model</code> matches to the
              AIGatewayRoute, or type an id.
            </p>
          )}

          <label>
            System prompt
            <textarea
              rows={3}
              value={systemPrompt}
              placeholder="(optional)"
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </label>

          <div className="field-row">
            <label>
              Temperature
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
              />
            </label>
            <label>
              Max tokens
              <input
                type="number"
                min={1}
                step={64}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
              />
            </label>
          </div>

          <fieldset>
            <legend>Attribution</legend>
            <label>
              x-tenant-id
              <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
            </label>
            <label>
              agent-session-id
              <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
            </label>
            <p className="muted small">
              Sent as headers; <code>x-tenant-id</code> becomes the <code>tenant_id</code> metric
              label.
            </p>
          </fieldset>

          <div className="side-foot">
            <span className="muted small">
              <b>{totals.input}</b> in · <b>{totals.output}</b> out
            </span>
            <button className="btn ghost sm" onClick={() => setTurns([])} disabled={busy || !turns.length}>
              Clear chat
            </button>
          </div>
        </aside>

        <section className="thread">
          <div className="thread-log" ref={logRef}>
            {turns.length === 0 && (
              <Empty>
                <p>
                  Requests go to <code>/v1/chat/completions</code> through the gateway.
                </p>
                <p className="muted small">
                  The browser sends <code>Authorization: Bearer unused</code> — aigw swaps in the real
                  upstream key, so no provider credential is ever here.
                </p>
              </Empty>
            )}
            {turns.map((t, i) => (
              <article key={i} className={`msg ${t.role}`}>
                <header>
                  <span className="msg-role">{t.role}</span>
                  {t.error && <Pill tone={t.error === 'stopped' ? 'warn' : 'error'}>{t.error}</Pill>}
                </header>
                <div className="msg-body">
                  {t.content || (busy && i === turns.length - 1 ? <span className="caret" /> : null)}
                </div>
                {(t.usage || t.ms !== undefined) && (
                  <footer>
                    {t.usage?.prompt_tokens !== undefined && (
                      <span>
                        {(t.usage.total_tokens ?? 0).toLocaleString()} tokens
                        <em>
                          {t.usage.prompt_tokens}+{t.usage.completion_tokens ?? 0}
                        </em>
                      </span>
                    )}
                    {t.ttfbMs !== undefined && <span>{t.ttfbMs} ms to first token</span>}
                    {t.ms !== undefined && <span>{t.ms} ms total</span>}
                  </footer>
                )}
              </article>
            ))}
          </div>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
          >
            <textarea
              rows={2}
              value={input}
              placeholder="Message… (Enter to send, Shift+Enter for newline)"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            {busy ? (
              <button type="button" className="btn danger" onClick={() => abortRef.current?.abort()}>
                Stop
              </button>
            ) : (
              <button type="submit" className="btn" disabled={!input.trim() || !model}>
                Send
              </button>
            )}
          </form>
        </section>
      </div>
    </div>
  )
}
