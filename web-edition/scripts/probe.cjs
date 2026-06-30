// Autonomous verification probe — post-login flow: cookie → API URL → fetch → response dump
// Usage: node_modules\.bin\electron scripts\probe.cjs
// Outputs: tmp\probe.log (JSON lines) + tmp\probe-response.json (raw API body)

const { app, session, BrowserWindow, net } = require('electron')
const path = require('path')
const fs = require('fs')

const PARTITION = 'persist:claudicator-web'
const OUT_DIR = path.join(__dirname, '..', 'tmp')
const LOG_FILE = path.join(OUT_DIR, 'probe.log')
const RESPONSE_FILE = path.join(OUT_DIR, 'probe-response.json')

// Point userData at the same directory as the running app so we share the same cookies.
app.setPath('userData', path.join(process.env.APPDATA, 'Claudicator'))

function log(tag, data) {
  const entry = { ts: Date.now(), tag, ...data }
  const line = JSON.stringify(entry)
  console.log(line)
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8')
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(LOG_FILE, '', 'utf8')
  fs.writeFileSync(RESPONSE_FILE, '', 'utf8')

  const ses = session.fromPartition(PARTITION)

  // ── STEP 1: Cookie inventory ─────────────────────────────────────────────
  try {
    await ses.cookies.flushStore()
  } catch (e) {
    log('WARN_FLUSH', { err: String(e) })
  }
  const cookies = await ses.cookies.get({ domain: 'claude.ai' })
  log('STEP1_COOKIES', {
    count: cookies.length,
    names: cookies.map(c => c.name),
  })

  if (cookies.length === 0) {
    log('FAIL', { reason: 'no_cookies', hint: 'Run npm run dev, click login, complete manual login once.' })
    process.exit(1)
  }

  // ── STEP 2: API URL discovery via hidden BrowserWindow ───────────────────
  const apiCalls = []
  const usageRequestHeaders = {}
  ses.webRequest.onCompleted({ urls: ['https://claude.ai/api/*'] }, (details) => {
    apiCalls.push({ url: details.url, status: details.statusCode })
  })
  // Capture the actual request headers the BrowserWindow sends for the usage endpoint
  ses.webRequest.onSendHeaders({ urls: ['https://claude.ai/api/*/usage'] }, (details) => {
    Object.assign(usageRequestHeaders, details.requestHeaders)
    log('STEP2_USAGE_REQUEST_HEADERS', { headers: details.requestHeaders })
  })

  const win = new BrowserWindow({
    show: false,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false },
  })

  log('STEP2_LOADING', { url: 'https://claude.ai/settings/usage' })
  win.loadURL('https://claude.ai/settings/usage')

  // Wait for SPA to fully render and fire API calls (10 s should be ample)
  await new Promise(r => setTimeout(r, 10_000))

  // Unregister listener before destroying window
  try { ses.webRequest.onCompleted({ urls: ['https://claude.ai/api/*'] }, null) } catch { /* ignore */ }
  try { ses.webRequest.onSendHeaders({ urls: ['https://claude.ai/api/*/usage'] }, null) } catch { /* ignore */ }
  if (!win.isDestroyed()) win.destroy()

  log('STEP2_API_CALLS', { count: apiCalls.length, calls: apiCalls })

  if (apiCalls.length === 0) {
    log('FAIL', { reason: 'no_api_calls', hint: 'SPA may need more time, or cookies are rejected, or Cloudflare block.' })
    process.exit(2)
  }

  // ── STEP 3: Fetch each usage candidate, dump body ────────────────────────
  const candidates = apiCalls.filter(c => c.url.includes('usage') && c.status < 400)
  log('STEP3_CANDIDATES', { count: candidates.length, urls: candidates.map(c => c.url) })

  if (candidates.length === 0) {
    log('FAIL', { reason: 'no_usage_candidates', hint: 'Check STEP2_API_CALLS to see what URLs were hit and their status codes.' })
    process.exit(3)
  }

  // net.fetch has header restrictions that cause ERR_INVALID_ARGUMENT.
  // Instead: navigate a BrowserWindow directly to the API URL — cookies are sent
  // automatically, no CORS/header issues, just grab document.body.innerText.
  for (const candidate of candidates) {
    const apiWin = new BrowserWindow({
      show: false,
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false },
    })

    try {
      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout loading api url')), 10_000)
        apiWin.webContents.on('did-finish-load', () => { clearTimeout(t); resolve() })
        apiWin.webContents.on('did-fail-load', (_, code, desc) => { clearTimeout(t); reject(new Error(`${code}: ${desc}`)) })
        apiWin.loadURL(candidate.url)
      })

      const bodyText = await apiWin.webContents.executeJavaScript('document.documentElement.innerText')
      log('STEP3_NAVIGATE_FETCH', {
        url: candidate.url,
        body_size: bodyText.length,
        preview: bodyText.slice(0, 600),
      })

      fs.writeFileSync(RESPONSE_FILE, bodyText, 'utf8')

      try {
        const parsed = JSON.parse(bodyText)
        log('STEP3_PARSE_OK', { top_keys: Object.keys(parsed).slice(0, 20) })
      } catch {
        log('STEP3_PARSE_FAIL', { hint: 'Body is not valid JSON — may be HTML error page.' })
      }
    } catch (e) {
      log('STEP3_NAVIGATE_ERROR', { url: candidate.url, err: String(e) })
    } finally {
      if (!apiWin.isDestroyed()) apiWin.destroy()
    }
  }

  log('SUCCESS', { candidates_fetched: candidates.length })
  process.exit(0)
})

app.on('window-all-closed', () => { /* keep alive until we explicitly exit */ })
