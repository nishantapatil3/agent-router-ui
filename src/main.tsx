import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { applyTheme, getSettings } from './settings'
import './styles.css'

// Set the theme attribute before the first render so there is no flash.
applyTheme(getSettings().theme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
