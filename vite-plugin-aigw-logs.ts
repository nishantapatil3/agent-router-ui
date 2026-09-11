import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import type { Plugin } from 'vite'

/**
 * Streams the gateway's Envoy access log to the browser over SSE.
 *
 * The browser cannot read container logs, and aigw exposes no log API, so the
 * dev server (a Node process on the host) tails `docker compose logs -f aigw`
 * and forwards the JSON access-log lines. That is what makes the Logs page show
 * real gateway traffic rather than only what this UI sent.
 *
 * Requires `AIGW_DEBUG=true` in the stack's .env — Envoy only writes access logs
 * to the console in debug mode.
 */
export function aigwLogs(opts: { composeDir: string; service?: string; tail?: number }): Plugin {
  const service = opts.service ?? 'aigw'
  const tail = opts.tail ?? 300

  return {
    name: 'aigw-logs',
    configureServer(server) {
      server.middlewares.use('/api/logs/stream', (_req, res) => {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })

        const fail = (message: string) => {
          res.write(`event: fatal\ndata: ${JSON.stringify({ message })}\n\n`)
          res.end()
        }

        // Fail loudly and specifically rather than hanging on a silent spawn error.
        const probe = spawnSync('docker', ['compose', 'ps', '--format', '{{.Name}}'], {
          cwd: opts.composeDir,
          encoding: 'utf8',
        })
        if (probe.error) {
          fail(`docker CLI not available to the dev server: ${probe.error.message}`)
          return
        }
        if (probe.status !== 0) {
          fail(`docker compose failed in ${opts.composeDir}: ${(probe.stderr || '').trim()}`)
          return
        }
        if (!probe.stdout.includes(service)) {
          fail(`the "${service}" container is not running — start it with docker compose up -d`)
          return
        }

        let child: ChildProcess
        try {
          child = spawn(
            'docker',
            ['compose', 'logs', '--no-log-prefix', '--no-color', '--tail', String(tail), '-f', service],
            { cwd: opts.composeDir },
          )
        } catch (e) {
          fail(`could not tail logs: ${(e as Error).message}`)
          return
        }

        let buffer = ''
        let sent = 0
        const onChunk = (chunk: Buffer) => {
          buffer += chunk.toString('utf8')
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            // Envoy's access logs are the JSON lines; everything else is noise.
            if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue
            let parsed: Record<string, unknown>
            try {
              parsed = JSON.parse(trimmed)
            } catch {
              continue
            }
            if (!('gen_ai.request.model' in parsed) && !('mcp.method.name' in parsed)) continue
            res.write(`data: ${JSON.stringify(parsed)}\n\n`)
            sent++
          }
        }

        child.stdout?.on('data', onChunk)
        child.stderr?.on('data', onChunk)
        child.on('error', (e) => fail(`log tail failed: ${e.message}`))
        child.on('close', () => {
          res.write(`event: fatal\ndata: ${JSON.stringify({ message: 'log stream ended' })}\n\n`)
          res.end()
        })

        // Tell the client the backlog is done so it can stop showing a spinner.
        setTimeout(() => res.write(`event: ready\ndata: ${JSON.stringify({ backlog: sent })}\n\n`), 900)

        const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000)
        const stop = () => {
          clearInterval(keepAlive)
          child.kill()
        }
        res.on('close', stop)
        res.on('error', stop)
      })
    },
  }
}
