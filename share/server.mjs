// Share server: a public watch page for ads published to EVS. Zero dependencies (Node 20+).
// The EVS API key stays HERE (server side). Visitors only get a short-lived playback token.
//   EVS_KEY=evs_... EVS_API=http://localhost:8080 PORT=8090 node server.mjs
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const API = (process.env.EVS_API ?? 'http://localhost:8080').replace(/\/$/, '')
const KEY = process.env.EVS_KEY ?? ''
const PORT = Number(process.env.PORT ?? 8090)
const HOST = process.env.HOST ?? '127.0.0.1'
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')
if (!KEY) {
  console.error('Set EVS_KEY to an EVS API key with videos:read and playback:mint')
  process.exit(1)
}

const ID = /^[0-9A-Z]{26}$/ // EVS video ids are 26-char ULIDs: unguessable, so the link itself is the secret
const hits = new Map() // naive per-IP rate limit: 30 token mints per minute
const limited = (ip) => {
  const now = Date.now()
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  arr.push(now)
  hits.set(ip, arr)
  return arr.length > 30
}

const evs = (method, p, body) =>
  fetch(`${API}/v1${p}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

const page = (id) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Watch</title><style>
:root{color-scheme:dark}body{margin:0;background:#0b0b0e;color:#eee;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}
main{width:min(100vw,480px);padding:12px;box-sizing:border-box}h1{font-size:16px;font-weight:600;margin:0 0 10px;color:#ffb2b3}
video{width:100%;max-height:80vh;background:#000;border-radius:12px}p{color:#9a9aa5;font-size:13px}
</style></head><body><main><h1 id="t">Loading…</h1><video id="v" controls playsinline></video><p id="m"></p></main>
<script src="/hls.min.js"></script><script>
const id=${JSON.stringify(id)},v=document.getElementById('v'),m=document.getElementById('m'),t=document.getElementById('t');
let hls;async function start(){
  const r=await fetch('/api/session/'+id); const d=await r.json();
  if(!r.ok){t.textContent='Unavailable';m.textContent=d.error||'This video cannot be played.';return}
  t.textContent=d.title||'Video'; v.poster=d.posterUrl||'';
  if(hls)hls.destroy();
  if(v.canPlayType('application/vnd.apple.mpegurl')){v.src=d.manifestUrl;return}
  if(!Hls.isSupported()){m.textContent='This browser cannot play the video.';return}
  hls=new Hls();hls.loadSource(d.manifestUrl);hls.attachMedia(v);
  hls.on(Hls.Events.ERROR,(_e,x)=>{if(x.fatal&&x.response&&(x.response.code===401||x.response.code===403)){const at=v.currentTime;start().then(()=>{v.currentTime=at})}});
}
start();</script></body></html>`

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const ip = req.socket.remoteAddress ?? 'x'
      if (req.method !== 'GET') return json(res, 405, { error: 'GET only' })
      if (url.pathname === '/healthz') return json(res, 200, { ok: true })
      if (url.pathname === '/hls.min.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'public, max-age=86400' })
        return res.end(await readFile(path.join(PUBLIC, 'hls.min.js')))
      }
      let m = /^\/watch\/([^/]+)$/.exec(url.pathname)
      if (m) {
        if (!ID.test(m[1])) return json(res, 404, { error: 'Not found' })
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
        return res.end(page(m[1]))
      }
      m = /^\/api\/session\/([^/]+)$/.exec(url.pathname)
      if (m) {
        if (!ID.test(m[1])) return json(res, 404, { error: 'Not found' })
        if (limited(ip)) return json(res, 429, { error: 'Too many requests, try again in a minute.' })
        const v = await evs('GET', `/videos/${m[1]}`)
        if (!v.ok) return json(res, 404, { error: 'Video not found.' })
        const video = await v.json()
        if (video.status !== 'ready') return json(res, 409, { error: `Not ready yet (${video.status}).` })
        const s = await evs('POST', `/videos/${m[1]}/playback-sessions`, { viewerId: 'guest-' + ip.replace(/[^0-9a-f.:]/gi, '').slice(0, 40) })
        if (!s.ok) return json(res, 502, { error: 'Could not start playback.' })
        const sess = await s.json()
        return json(res, 200, { title: video.title, manifestUrl: sess.manifestUrl, posterUrl: sess.posterUrl, expiresAt: sess.expiresAt })
      }
      json(res, 404, { error: 'Not found' })
    } catch (e) {
      json(res, 500, { error: 'Server error' })
    }
  })
  .listen(PORT, HOST, () => console.log(`share server on http://${HOST}:${PORT}  ->  EVS ${API}`))
