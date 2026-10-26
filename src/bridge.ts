import type { DoaEvent, SerialPortInfo, SerialStatus, VoreoApi } from './vite-env'

type HandlerMap = {
  status: Set<(data: SerialStatus) => void>
  ports: Set<(data: { ports: SerialPortInfo[] }) => void>
  asr: Set<(data: { text: string }) => void>
  wake: Set<() => void>
  version: Set<(data: { version: string }) => void>
  error: Set<(data: { message: string }) => void>
  log: Set<(data: { line: string }) => void>
  doa: Set<(data: DoaEvent) => void>
}

function bridgeWsUrl() {
  if (import.meta.env.VITE_BRIDGE_HOST) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${import.meta.env.VITE_BRIDGE_HOST}/ws`
  }
  // Same-origin (Vite proxy in dev / shared host in prod) — avoids system-proxy breaking :5174
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

function createBridge(wsUrl: string): VoreoApi {
  let ws: WebSocket | null = null
  let closed = false
  let reconnectTimer: number | null = null
  let status: SerialStatus = { connected: false, path: null, error: null }
  let ports: SerialPortInfo[] = []
  const pending = new Map<string, { resolve: (v: unknown) => void; timer: number }>()
  const handlers: HandlerMap = {
    status: new Set(),
    ports: new Set(),
    asr: new Set(),
    wake: new Set(),
    version: new Set(),
    error: new Set(),
    log: new Set(),
    doa: new Set(),
  }

  function emitStatus(payload: SerialStatus) {
    for (const cb of handlers.status) cb(payload)
  }
  function emitPorts(payload: { ports: SerialPortInfo[] }) {
    for (const cb of handlers.ports) cb(payload)
  }
  function emitAsr(payload: { text: string }) {
    for (const cb of handlers.asr) cb(payload)
  }
  function emitWake() {
    for (const cb of handlers.wake) cb()
  }
  function emitVersion(payload: { version: string }) {
    for (const cb of handlers.version) cb(payload)
  }
  function emitError(payload: { message: string }) {
    for (const cb of handlers.error) cb(payload)
  }
  function emitLog(payload: { line: string }) {
    for (const cb of handlers.log) cb(payload)
  }
  function emitDoa(payload: DoaEvent) {
    for (const cb of handlers.doa) cb(payload)
  }

  function handleMessage(raw: string) {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    const type = String(msg.type || '')
    if (type === 'status') {
      status = {
        connected: Boolean(msg.connected),
        path: (msg.path as string | null) ?? null,
        error: (msg.error as string | null) ?? null,
      }
      emitStatus(status)
      return
    }
    if (type === 'ports') {
      ports = (msg.ports as SerialPortInfo[]) || []
      emitPorts({ ports })
      return
    }
    if (type === 'asr') {
      emitAsr({ text: String(msg.text ?? '') })
      return
    }
    if (type === 'wake') {
      emitWake()
      return
    }
    if (type === 'version') {
      emitVersion({ version: String(msg.version || '') })
      return
    }
    if (type === 'error') {
      emitError({ message: String(msg.message || '') })
      return
    }
    if (type === 'log') {
      emitLog({ line: String(msg.line || '') })
      return
    }
    if (type === 'doa') {
      emitDoa({
        angle: typeof msg.angle === 'number' ? msg.angle : undefined,
        confidence: typeof msg.confidence === 'number' ? msg.confidence : undefined,
      })
      return
    }
    if (type === 'result') {
      const action = String(msg.action || '')
      const entry = pending.get(action)
      if (entry) {
        window.clearTimeout(entry.timer)
        pending.delete(action)
        entry.resolve(msg)
      }
    }
  }

  function connectSocket() {
    if (closed) return
    if (reconnectTimer != null) {
      window.clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      ws = null
    }

    const next = new WebSocket(wsUrl)
    ws = next

    next.onopen = () => {
      send({ type: 'list' })
    }
    next.onmessage = (ev) => {
      handleMessage(String(ev.data))
    }
    next.onclose = () => {
      if (ws === next) ws = null
      if (closed) return
      reconnectTimer = window.setTimeout(connectSocket, 1000)
    }
  }

  function send(msg: Record<string, unknown>) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  function request(action: string, msg: Record<string, unknown>, timeoutMs = 5000) {
    return new Promise<Record<string, unknown>>((resolve) => {
      const timer = window.setTimeout(() => {
        pending.delete(action)
        resolve({ ok: false, error: 'Timeout' })
      }, timeoutMs)
      pending.set(action, { resolve: resolve as (v: unknown) => void, timer })
      send(msg)
    })
  }

  connectSocket()

  return {
    listPorts: async () => {
      send({ type: 'list' })
      return ports
    },
    connect: async (portPath) => {
      const res = await request('connect', { type: 'connect', path: portPath })
      return { ok: Boolean(res.ok), path: res.path as string | undefined, error: res.error as string | undefined }
    },
    disconnect: async () => {
      const res = await request('disconnect', { type: 'disconnect' })
      return { ok: Boolean(res.ok) }
    },
    sendTts: async (text) => {
      const res = await request('tts', { type: 'tts', text })
      return { ok: Boolean(res.ok), error: res.error as string | undefined }
    },
    getStatus: async () => ({ connected: status.connected, path: status.path }),
    onStatus: (cb) => {
      handlers.status.add(cb)
      return () => handlers.status.delete(cb)
    },
    onPorts: (cb) => {
      handlers.ports.add(cb)
      return () => handlers.ports.delete(cb)
    },
    onAsr: (cb) => {
      handlers.asr.add(cb)
      return () => handlers.asr.delete(cb)
    },
    onWake: (cb) => {
      handlers.wake.add(cb)
      return () => handlers.wake.delete(cb)
    },
    onVersion: (cb) => {
      handlers.version.add(cb)
      return () => handlers.version.delete(cb)
    },
    onError: (cb) => {
      handlers.error.add(cb)
      return () => handlers.error.delete(cb)
    },
    onLog: (cb) => {
      handlers.log.add(cb)
      return () => handlers.log.delete(cb)
    },
    onDoa: (cb) => {
      handlers.doa.add(cb)
      return () => handlers.doa.delete(cb)
    },
  }
}

export function ensureVoreoApi() {
  if (window.voreo) return window.voreo
  window.voreo = createBridge(bridgeWsUrl())
  return window.voreo
}
