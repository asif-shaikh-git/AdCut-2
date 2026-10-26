import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource/noto-sans-devanagari/800.css'
import './styles.css'
import { startAutosave } from './projects'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

void startAutosave()
