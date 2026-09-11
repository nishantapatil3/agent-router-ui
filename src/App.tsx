import { useEffect, useState, type ReactNode } from 'react'
import { Playground } from './Playground'
import { Models } from './Models'
import { SettingsPage } from './SettingsPage'
import { Usage } from './Usage'
import { Tools } from './Tools'
import { fetchHealth } from './api'

type Page = 'playground' | 'models' | 'usage' | 'tools' | 'settings'

type NavItem = { id: Page; label: string; icon: ReactNode }

/** Simple 16px line icons — consistent stroke weight, unlike mixed unicode glyphs. */
function Icon({ d, circle }: { d?: string; circle?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor"
         strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {circle && <circle cx="8" cy="8" r="6" />}
      {d && <path d={d} />}
    </svg>
  )
}

/** Sidebar grouped the way LiteLLM's admin UI groups its nav. */
const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'AI Gateway',
    items: [
      // chat bubble
      { id: 'playground', label: 'Playground', icon: <Icon d="M2 4.5A1.5 1.5 0 0 1 3.5 3h9A1.5 1.5 0 0 1 14 4.5v5A1.5 1.5 0 0 1 12.5 11H6l-3 2.5V11h-.5A.5.5 0 0 1 2 10.5v-6Z" /> },
      // stacked layers
      { id: 'models', label: 'Models', icon: <Icon d="M8 2 2 5l6 3 6-3-6-3ZM2 11l6 3 6-3M2 8l6 3 6-3" /> },
      // wrench
      { id: 'tools', label: 'MCP Tools', icon: <Icon d="M10.6 2.6a3 3 0 0 0-4 4L2.8 10.4a1.4 1.4 0 0 0 2 2l3.8-3.8a3 3 0 0 0 4-4l-1.7 1.7-1.4-1.4 1.7-1.7Z" /> },
    ],
  },
  {
    section: 'Observability',
    items: [
      // bar chart
      { id: 'usage', label: 'Usage', icon: <Icon d="M2.5 13.5h11M4.5 13.5V8M8 13.5V3.5M11.5 13.5v-4" /> },
    ],
  },
  {
    section: 'Preferences',
    items: [
      // gear
      {
        id: 'settings',
        label: 'Settings',
        icon: <Icon circle d="M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8M8 1.2v1.6M8 13.2v1.6M14.8 8h-1.6M2.8 8H1.2" />,
      },
    ],
  },
]

const PAGES = NAV.flatMap((g) => g.items)

function pageFromHash(): Page {
  const hash = window.location.hash.replace('#', '')
  return PAGES.some((p) => p.id === hash) ? (hash as Page) : 'playground'
}

export function App() {
  // The page lives in the URL hash so a view is linkable and survives reload.
  const [page, setPage] = useState<Page>(pageFromHash)
  const [healthy, setHealthy] = useState<boolean | null>(null)
  const [navOpen, setNavOpen] = useState(false)

  useEffect(() => {
    const onHash = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    let live = true
    const check = async () => {
      const ok = await fetchHealth()
      if (live) setHealthy(ok)
    }
    void check()
    const id = setInterval(check, 10_000)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [])

  return (
    <div className="shell">
      <header className="topbar">
        <button className="hamburger" onClick={() => setNavOpen((o) => !o)} title="Toggle navigation">
          ☰
        </button>
        <span className="brand">
          <span className="brand-mark">AR</span>
          Agent Router
        </span>
        <span className={`status ${healthy === null ? 'unknown' : healthy ? 'up' : 'down'}`}>
          <i />
          {healthy === null ? 'checking…' : healthy ? 'gateway healthy' : 'gateway unreachable'}
        </span>
        <nav className="topbar-links">
          <a href="http://localhost:3000" target="_blank" rel="noreferrer">
            Grafana
          </a>
          <a href="http://localhost:9090" target="_blank" rel="noreferrer">
            Prometheus
          </a>
          <a
            href="https://github.com/theagentrouter/agent-router"
            target="_blank"
            rel="noreferrer"
          >
            Docs
          </a>
        </nav>
      </header>

      <div className="body">
        <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
          {NAV.map((group) => (
            <div className="nav-group" key={group.section}>
              <span className="nav-section">{group.section}</span>
              {group.items.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className={`nav-item ${item.id === page ? 'active' : ''}`}
                  onClick={() => setNavOpen(false)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </a>
              ))}
            </div>
          ))}
        </aside>

        <main className="content">
          {page === 'playground' && <Playground />}
          {page === 'models' && <Models />}
          {page === 'usage' && <Usage />}
          {page === 'tools' && <Tools />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  )
}
