const http = require('http')
const fs = require('fs')
const path = require('path')
const { WebSocketServer } = require('ws')
const { SerialPort } = require('serialport')

const ESPRESSIF_VID = 0x303a
const BAUD = 115200
const SCAN_MS = 2000
const PORT = Number(process.env.PORT || 5174)
const isDev = process.env.NODE_ENV !== 'production'

/** @type {import('serialport').SerialPort | null} */
let port = null
let rxBuffer = ''
let intentionalClose = false
/** When false, periodic auto-connect is paused (user clicked Disconnect). */
let autoConnectEnabled = true
/** @type {Set<import('ws').WebSocket>} */
const clients = new Set()

function broadcast(type, payload = {}) {
  const msg = JSON.stringify({ type, ...payload })
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(msg)
  }
}

function isVoreoCandidate(info) {
  const vid = parseInt(String(info.vendorId || ''), 16)
  const name = `${info.friendlyName || ''} ${info.manufacturer || ''} ${info.path || ''}`.toLowerCase()
  if (vid === ESPRESSIF_VID) return true
  if (name.includes('espressif')) return true
  if (name.includes('usb jtag')) return true
  if (name.includes('serial debug unit')) return true
  if (name.includes('voreo')) return true
  return false
}

async function listPorts() {
  const ports = await SerialPort.list()
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer || '',
    friendlyName: p.friendlyName || p.path,
    vendorId: p.vendorId || '',
    productId: p.productId || '',
    isVoreo: isVoreoCandidate(p),
  }))
}

function detachPort() {
  if (!port) return
  const current = port
  port = null
  try {
    if (current.isOpen) current.close()
  } catch {
    /* ignore */
  }
}

function handleLine(line) {
  const text = line.replace(/^\uFEFF/, '').replace(/\r$/, '').trim()
  if (!text) return

  /* AT URC / replies: +ASR / +WAKE / +VER / +ANGLE / +VOL / +SPD / +WAKEWORD / OK / ERROR */
  const asr = text.match(/^\+ASR\s*[:：]\s*(.*)$/i) || text.match(/^ASR\s*[:：]\s*(.*)$/i)
  if (asr) {
    const payload = asr[1] ?? ''
    console.log('[voreo] ASR:', payload)
    broadcast('asr', { text: payload })
    broadcast('log', { line: text })
    return
  }
  if (/^\+?WAKE$/i.test(text)) {
    console.log('[voreo] WAKE')
    broadcast('wake')
    broadcast('log', { line: text })
    return
  }
  const ver = text.match(/^\+VER\s*[:：]\s*(.*)$/i) || text.match(/^VER\s*[:：]\s*(.*)$/i)
  if (ver) {
    broadcast('version', { version: ver[1] || '' })
    broadcast('log', { line: text })
    return
  }
  if (/^ERROR$/i.test(text) || /^ERR\s*[:：]/i.test(text)) {
    const message = /^ERROR$/i.test(text)
      ? 'ERROR'
      : text.replace(/^ERR\s*[:：]\s*/i, '').trim()
    broadcast('error', { message })
    broadcast('log', { line: text })
    return
  }

  const doa = text.match(/^\+?ANGLE:\s*(-?\d+(?:\.\d+)?)/i)
  if (doa) {
    broadcast('doa', { angle: Number(doa[1]) })
    broadcast('log', { line: text })
    return
  }

  broadcast('log', { line: text })
}

const utf8Decoder = new TextDecoder('utf-8')

function onData(chunk) {
  /* Decode incrementally so multi-byte UTF-8 (e.g. Chinese) is not split across packets */
  rxBuffer += utf8Decoder.decode(chunk, { stream: true })
  let idx
  while ((idx = rxBuffer.search(/[\r\n]/)) !== -1) {
    const line = rxBuffer.slice(0, idx)
    const sep = rxBuffer[idx]
    rxBuffer = rxBuffer.slice(idx + 1)
    if (sep === '\r' && rxBuffer[0] === '\n') {
      rxBuffer = rxBuffer.slice(1)
    }
    handleLine(line)
  }
  if (rxBuffer.length > 8192) {
    rxBuffer = rxBuffer.slice(-4096)
  }
}

function openPort(portPath) {
  if (port?.isOpen && port.path === portPath) {
    return Promise.resolve({ ok: true, path: portPath })
  }

  intentionalClose = true
  detachPort()
  intentionalClose = false
  rxBuffer = ''

  return new Promise((resolve) => {
    const next = new SerialPort({
      path: portPath,
      baudRate: BAUD,
      autoOpen: false,
    })

    next.on('data', onData)
    next.on('error', (err) => {
      broadcast('status', { connected: false, path: null, error: err.message })
    })
    next.on('close', () => {
      if (port === next) port = null
      if (!intentionalClose) {
        broadcast('status', { connected: false, path: null, error: null })
      }
    })

    next.open((err) => {
      if (err) {
        broadcast('status', { connected: false, path: null, error: err.message })
        resolve({ ok: false, error: err.message })
        return
      }
      port = next
      broadcast('status', { connected: true, path: portPath, error: null })
      resolve({ ok: true, path: portPath })
    })
  })
}

async function autoConnect() {
  if (!autoConnectEnabled) return
  if (port?.isOpen) return
  try {
    const ports = await listPorts()
    broadcast('ports', { ports })
    const preferred = ports.find((p) => p.isVoreo)
    if (preferred) await openPort(preferred.path)
  } catch (err) {
    broadcast('status', {
      connected: false,
      path: null,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Write one text line to the device (TTS or command: VOL / SPD / ANGLE / WAKEWORD). */
function sendLine(text) {
  if (!port?.isOpen) return Promise.resolve({ ok: false, error: 'Not connected' })
  const payload = String(text ?? '').replace(/\r?\n/g, ' ').trim()
  if (!payload) return Promise.resolve({ ok: false, error: 'Empty' })

  return new Promise((resolve) => {
    port.write(`${payload}\n`, 'utf8', (err) => {
      if (err) {
        resolve({ ok: false, error: err.message })
        return
      }
      port.drain(() => resolve({ ok: true }))
    })
  })
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

const distDir = path.join(__dirname, '..', 'dist')

const server = http.createServer((req, res) => {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, connected: Boolean(port?.isOpen), path: port?.path || null }))
    return
  }

  if (isDev) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Voreo serial bridge running. Open the Vite UI at http://127.0.0.1:5173')
    return
  }

  let urlPath = decodeURIComponent((req.url || '/').split('?')[0])
  if (urlPath === '/') urlPath = '/index.html'
  const filePath = path.normalize(path.join(distDir, urlPath))
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(distDir, 'index.html'), (err2, html) => {
        if (err2) {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(html)
      })
      return
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream' })
    res.end(data)
  })
})

const wss = new WebSocketServer({ server, path: '/ws' })

wss.on('connection', (ws) => {
  clients.add(ws)
  ws.send(
    JSON.stringify({
      type: 'status',
      connected: Boolean(port?.isOpen),
      path: port?.path || null,
      error: null,
    }),
  )
  void listPorts().then((ports) => ws.send(JSON.stringify({ type: 'ports', ports })))

  ws.on('message', async (raw) => {
    let msg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }

    if (msg.type === 'list') {
      const ports = await listPorts()
      ws.send(JSON.stringify({ type: 'ports', ports }))
      return
    }
    if (msg.type === 'connect') {
      autoConnectEnabled = true
      const result = await openPort(msg.path)
      ws.send(JSON.stringify({ type: 'result', action: 'connect', ...result }))
      return
    }
    if (msg.type === 'disconnect') {
      autoConnectEnabled = false
      intentionalClose = true
      detachPort()
      intentionalClose = false
      broadcast('status', { connected: false, path: null, error: null })
      ws.send(JSON.stringify({ type: 'result', action: 'disconnect', ok: true }))
      return
    }
    if (msg.type === 'tts' || msg.type === 'cmd') {
      const result = await sendLine(msg.text)
      ws.send(JSON.stringify({ type: 'result', action: msg.type, ...result }))
    }
  })

  ws.on('close', () => clients.delete(ws))
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[voreo] serial bridge http://127.0.0.1:${PORT}`)
  if (isDev) console.log('[voreo] UI: http://127.0.0.1:5173')
})

setInterval(() => {
  void autoConnect()
}, SCAN_MS)
void autoConnect()

process.on('SIGINT', () => {
  intentionalClose = true
  detachPort()
  process.exit(0)
})
