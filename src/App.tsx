import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ensureVoreoApi } from './bridge'
import { DeviceSettings, DeviceSettingsState } from './components/DeviceSettings'
import { DeviceStateIcon } from './components/DeviceStateIcon'
import { DoaMode, DoaPanel } from './components/DoaPanel'
import { LlmPanel } from './components/LlmPanel'
import { WakeWordPanel } from './components/WakeWordPanel'
import { DeviceStateName, isModuleReady, isStateInitPending, parseDeviceState } from './deviceState'
import { Locale, t } from './i18n'
import {
  askLlm,
  demoReply,
  isLlmConfigured,
  LlmConfig,
  loadLlmConfig,
  saveLlmConfig,
} from './llm'
import { LOG_ANGLE_URC } from './debugFlags'
import { splitForAtLine, utf8ByteLength } from './ttsPacket'
import type { SerialPortInfo } from './vite-env'

type ChatItem = {
  id: string
  kind: 'asr' | 'tts' | 'llm' | 'sys'
  text: string
  at: number
}

type LogItem = {
  id: string
  line: string
  at: number
}

function nowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatTime(ts: number, locale: Locale) {
  return new Date(ts).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

const DEFAULT_WAKE = 'hcLb qdMZ'

type AtOutcome = { ok: true } | { ok: false; error: string }

function clampLevel(n: unknown, fallback: number) {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.min(15, Math.max(0, Math.round(v)))
}

function loadDeviceSettings(): DeviceSettingsState {
  try {
    const raw = localStorage.getItem('voreo-device')
    if (!raw) return { volume: 8, speed: 5 }
    const parsed = JSON.parse(raw) as Partial<DeviceSettingsState> & { wakeSensitivity?: number }
    return {
      volume: clampLevel(parsed.volume, 8),
      speed: clampLevel(parsed.speed ?? parsed.wakeSensitivity, 5),
    }
  } catch {
    return { volume: 8, speed: 5 }
  }
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = localStorage.getItem('voreo-locale')
    return saved === 'en' ? 'en' : 'zh'
  })
  const [ports, setPorts] = useState<SerialPortInfo[]>([])
  const [selectedPath, setSelectedPath] = useState('')
  const [connected, setConnected] = useState(false)
  const [activePath, setActivePath] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [deviceState, setDeviceState] = useState<DeviceStateName | null>(null)
  const [initDots, setInitDots] = useState('')
  const deviceStateRef = useRef<DeviceStateName | null>(null)
  const [ttsText, setTtsText] = useState('')
  const [chat, setChat] = useState<ChatItem[]>([])
  const [logs, setLogs] = useState<LogItem[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [toastTone, setToastTone] = useState<'ok' | 'fail' | null>(null)
  const [sending, setSending] = useState(false)
  const [llmBusy, setLlmBusy] = useState(false)
  const [angle, setAngle] = useState<number | null>(null)
  const [energy, setEnergy] = useState<number | null>(null)
  const [doaMode, setDoaMode] = useState<DoaMode | null>(null)
  const [device, setDevice] = useState<DeviceSettingsState>(loadDeviceSettings)
  const [wakeCurrent, setWakeCurrent] = useState(DEFAULT_WAKE)
  const [wakeDraft, setWakeDraft] = useState('')
  const [llm, setLlm] = useState<LlmConfig>(loadLlmConfig)
  const [sideTab, setSideTab] = useState<'device' | 'ai'>('device')
  const [cmdBusy, setCmdBusy] = useState(false)

  const asrEndRef = useRef<HTMLDivElement | null>(null)
  const llmAbort = useRef<AbortController | null>(null)
  const turnId = useRef(0)
  /** Set by AT+STOP to abort in-flight playTts */
  const ttsAbortRef = useRef(false)
  /** Firmware +TTS:PAUSE / +TTS:RESUME / +TTS:Q paused — 高水位暂停喂入 */
  const ttsPausedRef = useRef(false)
  const ttsResumeWaiters = useRef<Array<() => void>>([])
  /** +TTS:Q:<used>,<free>,<paused> */
  const ttsQRef = useRef<{ used: number; free: number; paused: boolean } | null>(null)
  /** 最近一次 +ERROR:TTS_*，供裸 ERROR 解析 waiter */
  const ttsLastErrorRef = useRef<string | null>(null)
  const localeRef = useRef(locale)
  const llmRef = useRef(llm)
  const connectedRef = useRef(connected)
  const atWaiters = useRef<
    Array<{ resolve: (v: AtOutcome) => void; timer: number; quiet: boolean }>
  >([])

  const api = ensureVoreoApi()
  const hasApi = Boolean(api)

  useEffect(() => {
    localeRef.current = locale
  }, [locale])
  useEffect(() => {
    llmRef.current = llm
  }, [llm])
  useEffect(() => {
    connectedRef.current = connected
    if (!connected) {
      setDeviceState(null)
      deviceStateRef.current = null
      setEnergy(null)
      setDoaMode(null)
      return
    }
    // Open/connect: default initializing until first ready STATE
    if (deviceStateRef.current == null) {
      setDeviceState('BOOTING')
      deviceStateRef.current = 'BOOTING'
    }
  }, [connected])

  useEffect(() => {
    deviceStateRef.current = deviceState
  }, [deviceState])

  /** Init only: poll AT+STATE? every 1s until a non-BOOTING state (query or URC). */
  useEffect(() => {
    if (!connected || !api) return
    if (!isStateInitPending(deviceState)) return

    let cancelled = false
    const tick = async () => {
      if (cancelled || !connectedRef.current || atWaiters.current.length > 0) return
      if (!isStateInitPending(deviceStateRef.current)) return
      const pending = waitForAtReply(4000, true)
      const res = await api.sendCmd('AT+STATE?')
      if (!res.ok) {
        cancelLastAtWaiter()
        return
      }
      await pending
    }
    void tick()
    const id = window.setInterval(() => void tick(), 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [connected, api, deviceState])

  useEffect(() => {
    localStorage.setItem('voreo-locale', locale)
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [locale])

  useEffect(() => {
    asrEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat, llmBusy])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => {
      setToast(null)
      setToastTone(null)
    }, 2400)
    return () => window.clearTimeout(id)
  }, [toast])

  function pushLog(line: string, dir: 'tx' | 'rx' | 'sys' = 'sys') {
    const tag = dir === 'tx' ? 'TX' : dir === 'rx' ? 'RX' : 'SYS'
    setLogs((prev) => [
      ...prev.slice(-100),
      { id: nowId(), line: `${tag}  ${line}`, at: Date.now() },
    ])
  }

  function flashToast(text: string, tone?: 'ok' | 'fail') {
    setToastTone(tone ?? null)
    setToast(text)
  }

  function waitForAtReply(timeoutMs = 4000, quiet = false): Promise<AtOutcome> {
    return new Promise((resolve) => {
      const entry = {
        resolve,
        quiet,
        timer: window.setTimeout(() => {
          const idx = atWaiters.current.indexOf(entry)
          if (idx >= 0) atWaiters.current.splice(idx, 1)
          resolve({ ok: false, error: 'timeout' })
        }, timeoutMs),
      }
      atWaiters.current.push(entry)
    })
  }

  function cancelLastAtWaiter() {
    const entry = atWaiters.current.pop()
    if (!entry) return
    window.clearTimeout(entry.timer)
    entry.resolve({ ok: false, error: 'cancelled' })
  }

  /** @returns 'none' | 'quiet' | 'loud' — quiet waiters (ANGLE poll) skip log */
  function resolveAtReply(ok: boolean, error?: string): 'none' | 'quiet' | 'loud' {
    const entry = atWaiters.current.shift()
    if (!entry) return 'none'
    window.clearTimeout(entry.timer)
    entry.resolve(ok ? { ok: true } : { ok: false, error: error || 'ERROR' })
    return entry.quiet ? 'quiet' : 'loud'
  }

  function notifyTtsResumeWaiters() {
    const list = ttsResumeWaiters.current.splice(0)
    for (const w of list) w()
  }

  function setTtsPaused(paused: boolean) {
    ttsPausedRef.current = paused
    if (ttsQRef.current) ttsQRef.current = { ...ttsQRef.current, paused }
    if (!paused) notifyTtsResumeWaiters()
  }

  /** paused 时每 1s 醒一次；可被 STOP 打断。返回 false = 已 abort */
  async function sleepWhilePausedOrRetry(ms = 1000): Promise<boolean> {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (ttsAbortRef.current) return false
      await new Promise<void>((r) => window.setTimeout(r, Math.min(100, deadline - Date.now())))
    }
    return !ttsAbortRef.current
  }

  /**
   * 打断本机喂入并 AT+STOP 清固件队列。
   * quiet：替换播报时不 toast / 不写对话气泡。
   */
  async function sendAtStop(opts?: { quiet?: boolean }): Promise<AtOutcome> {
    ttsAbortRef.current = true
    setTtsPaused(false)
    ttsQRef.current = null
    while (atWaiters.current.length) cancelLastAtWaiter()

    if (!api || !connectedRef.current) {
      return { ok: false, error: t(localeRef.current, 'notConnected') }
    }

    const pending = waitForAtReply(4000)
    const res = await api.sendCmd('AT+STOP')
    if (!res.ok) {
      cancelLastAtWaiter()
      pushLog('ERR AT+STOP', 'sys')
      return { ok: false, error: res.error || t(localeRef.current, 'sendFailed') }
    }
    pushLog('AT+STOP', 'tx')
    const reply = await pending
    if (!reply.ok && !opts?.quiet) {
      pushLog('FAIL AT+STOP', 'sys')
    }
    return reply
  }

  /**
   * 主机 ≤512B/包喂入；全文不限长。
   * 跟 Q/PAUSE/RESUME；ERROR 分类：TOO_LONG 失败；PAUSE/FULL 等 RESUME 或 1s 重试。
   */
  async function playTts(text: string, kind: ChatItem['kind'] = 'tts') {
    if (!api || !ensureModuleReady()) return false
    const payload = text.replace(/\r?\n/g, ' ').trim()
    if (!payload) return false

    const chunks = splitForAtLine(payload)
    if (chunks.length === 0) return false

    ttsAbortRef.current = false
    ttsLastErrorRef.current = null
    setSending(true)
    setDeviceState('TTS')
    try {
      for (let i = 0; i < chunks.length; i++) {
        if (ttsAbortRef.current) return false
        const chunk = chunks[i]

        for (;;) {
          if (ttsAbortRef.current) return false

          if (ttsPausedRef.current || ttsQRef.current?.paused) {
            pushLog('TTS paused, wait RESUME', 'sys')
            if (!(await sleepWhilePausedOrRetry(1000))) return false
            continue
          }

          const free = ttsQRef.current?.free
          if (typeof free === 'number' && free > 0 && utf8ByteLength(chunk) > free) {
            pushLog(`TTS wait free (${free}B < chunk)`, 'sys')
            if (!(await sleepWhilePausedOrRetry(1000))) return false
            continue
          }

          ttsLastErrorRef.current = null
          const pending = waitForAtReply(15000)
          const res = await api.sendTts(chunk)
          if (!res.ok) {
            cancelLastAtWaiter()
            if (ttsAbortRef.current) return false
            flashToast(res.error || t(localeRef.current, 'sendFailed'), 'fail')
            return false
          }
          pushLog(
            chunks.length > 1
              ? `AT+TTS=[${i + 1}/${chunks.length}] (${utf8ByteLength(chunk)}B)`
              : `AT+TTS (${utf8ByteLength(chunk)}B)`,
            'tx',
          )
          const reply = await pending
          if (ttsAbortRef.current || (!reply.ok && reply.error === 'cancelled')) return false
          if (reply.ok) break

          const err = reply.error || ttsLastErrorRef.current || 'ERROR'
          if (/TTS_TOO_LONG/i.test(err)) {
            flashToast(err, 'fail')
            pushLog(`FAIL ${err}`, 'sys')
            return false
          }
          if (/TTS_PAUSE/i.test(err)) {
            setTtsPaused(true)
            pushLog('TTS_PAUSE, wait RESUME', 'sys')
          } else {
            pushLog(`${err}, retry in 1s`, 'sys')
          }
          if (!(await sleepWhilePausedOrRetry(1000))) return false
        }
      }
      if (ttsAbortRef.current) return false
      setChat((prev) => [...prev, { id: nowId(), kind, text: payload, at: Date.now() }])
      flashToast(t(localeRef.current, 'ttsOk'), 'ok')
      return true
    } finally {
      setSending(false)
    }
  }

  async function syncDeviceState() {
    if (!api) return
    for (const line of [
      'AT+VER?',
      'AT+VOL?',
      'AT+SPD?',
      'AT+WAKEWORD?',
      'AT+DOAMODE?',
      'AT+ENERGY?',
    ]) {
      const pending = waitForAtReply(4000)
      const res = await api.sendCmd(line)
      pushLog(res.ok ? line : `ERR ${line}`, res.ok ? 'tx' : 'sys')
      if (!res.ok) {
        cancelLastAtWaiter()
        continue
      }
      await pending
    }
  }

  async function handleAsrReply(asrText: string) {
    const cfg = llmRef.current
    if (!cfg.autoReply) return

    const myTurn = ++turnId.current
    llmAbort.current?.abort()
    const ac = new AbortController()
    llmAbort.current = ac
    setLlmBusy(true)

    try {
      let reply: string
      let kind: ChatItem['kind'] = 'llm'
      if (isLlmConfigured(cfg)) {
        pushLog('LLM request', 'sys')
        reply = await askLlm(cfg, asrText, ac.signal)
      } else if (cfg.useDemoReply) {
        reply = demoReply(localeRef.current, asrText)
        kind = 'sys'
        pushLog('LLM demo', 'sys')
      } else {
        pushLog('LLM skipped (demo off)', 'sys')
        return
      }
      if (myTurn !== turnId.current || ac.signal.aborted) return
      await playTts(reply, kind)
    } catch (err) {
      if (ac.signal.aborted || myTurn !== turnId.current) return
      const msg = err instanceof Error ? err.message : String(err)
      setToast(`${t(localeRef.current, 'llmFailed')}: ${msg}`)
      pushLog(`LLM ERR ${msg}`, 'sys')
    } finally {
      if (myTurn === turnId.current) setLlmBusy(false)
    }
  }

  async function stopOrInterrupt() {
    turnId.current += 1
    llmAbort.current?.abort()
    llmAbort.current = null
    setLlmBusy(false)
    setSending(false)

    if (!api || !connectedRef.current) {
      flashToast(t(locale, 'notConnected'), 'fail')
      return
    }

    const reply = await sendAtStop()
    if (reply.ok) {
      flashToast(t(locale, 'ttsStopped'), 'ok')
      setChat((prev) => [
        ...prev,
        { id: nowId(), kind: 'sys', text: t(locale, 'ttsStopped'), at: Date.now() },
      ])
    } else {
      const msg =
        reply.error === 'timeout'
          ? t(locale, 'cmdTimeout')
          : reply.error || t(locale, 'cmdFail')
      flashToast(msg, 'fail')
    }
  }

  useEffect(() => {
    if (!api) return

    const unsubs = [
      api.onPorts(({ ports: next }) => {
        setPorts(next)
        setSelectedPath((cur) => {
          if (cur && next.some((p) => p.path === cur)) return cur
          const preferred = next.find((p) => p.isVoreo) || next[0]
          return preferred?.path || ''
        })
      }),
      api.onStatus((status) => {
        setConnected(status.connected)
        setActivePath(status.path)
        if (status.connected && status.path) {
          setSelectedPath(status.path)
          pushLog(`connected ${status.path}`, 'sys')
          void syncDeviceState()
        } else if (!status.connected) {
          pushLog('disconnected', 'sys')
        }
        if (status.error) {
          setToast(status.error)
          pushLog(`error: ${status.error}`, 'sys')
        }
      }),
      api.onAsr(({ text }) => {
        const content = String(text ?? '').trim()
        setChat((prev) => [
          ...prev,
          {
            id: nowId(),
            kind: 'asr',
            text: content || '(empty)',
            at: Date.now(),
          },
        ])
        if (content) void handleAsrReply(content)
      }),
      api.onWake(() => {
        // +WAKE: optimistic; firmware also pushes STATE:LISTENING
        setDeviceState('LISTENING')
        deviceStateRef.current = 'LISTENING'
      }),
      api.onVersion(({ version: ver }) => {
        setVersion(ver)
      }),
      api.onError(({ message }) => {
        // OK/ERROR handled by AT waiters via onLog — avoid duplicate toasts
        if (atWaiters.current.length > 0) return
        flashToast(message === 'ERROR' ? t(localeRef.current, 'cmdError') : message, 'fail')
      }),
      api.onLog(({ line }) => {
        // DOA：更新罗盘；角度日志由 LOG_ANGLE_URC 开关
        const angleHit = line.match(/^\+?ANGLE:\s*(-?\d+(?:\.\d+)?)/i)
        if (angleHit) {
          setAngle(Number(angleHit[1]))
          if (LOG_ANGLE_URC) pushLog(line, 'rx')
          return
        }

        const energyHit = line.match(/^\+ENERGY:\s*(\d+)/i)
        if (energyHit) {
          setEnergy(Math.max(0, Math.min(255, Number(energyHit[1]))))
          pushLog(line, 'rx')
          return
        }

        const doaModeHit = line.match(/^\+DOAMODE:\s*(\d+)/i)
        if (doaModeHit) {
          const m = Number(doaModeHit[1])
          if (m === 0 || m === 1 || m === 2) setDoaMode(m)
          pushLog(line, 'rx')
          return
        }

        const volHit = line.match(/^\+VOL:\s*(\d+)/i)
        if (volHit) {
          setDevice((prev) => ({ ...prev, volume: clampLevel(volHit[1], prev.volume) }))
        }
        const spdHit = line.match(/^\+SPD:\s*(\d+)/i)
        if (spdHit) {
          setDevice((prev) => ({ ...prev, speed: clampLevel(spdHit[1], prev.speed) }))
        }
        const wakeHit = line.match(/^\+WAKEWORD:\s*(.*)$/i)
        if (wakeHit) {
          const word = wakeHit[1].trim()
          if (word) setWakeCurrent(word)
        }

        // Firmware URC / AT+STATE?: STATE:STANDBY / +STATE:LISTENING / …
        const stateHit = line.match(/^\+?STATE:\s*(.*)$/i)
        if (stateHit) {
          const next = parseDeviceState(stateHit[1])
          const prev = deviceStateRef.current
          setDeviceState(next)
          deviceStateRef.current = next
          if (prev !== next) pushLog(line, 'rx')
          return
        }

        // +TTS:Q:<used>,<free>,<paused> — 入队成败 / RESUME 前水位
        const qHit = line.match(/^\+TTS:Q:(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\b/i)
        if (qHit) {
          const used = Number(qHit[1])
          const free = Number(qHit[2])
          const paused = Number(qHit[3]) !== 0
          ttsQRef.current = { used, free, paused }
          setTtsPaused(paused)
          pushLog(line, 'rx')
          return
        }

        if (/^\+TTS:PAUSE\b/i.test(line)) {
          setTtsPaused(true)
          pushLog(line, 'rx')
          return
        }
        if (/^\+TTS:RESUME\b/i.test(line)) {
          setTtsPaused(false)
          pushLog(line, 'rx')
          return
        }

        // +ERROR:TTS_* — 分类缓存，末行裸 ERROR 再 resolve waiter
        const errHit = line.match(/^\+ERROR:(TTS_\w+)\b/i)
        if (errHit) {
          const code = errHit[1].toUpperCase()
          ttsLastErrorRef.current = code
          if (code === 'TTS_PAUSE') setTtsPaused(true)
          pushLog(line, 'rx')
          return
        }

        // Intermediate URCs (+TTS:…, +READY, 其它 +ERROR:…) — final OK/ERROR resolves waiter
        if (/^\+TTS:/i.test(line) || /^\+READY$/i.test(line) || /^\+ERROR:/i.test(line)) {
          pushLog(line, 'rx')
          return
        }

        if (/^OK$/i.test(line)) {
          ttsLastErrorRef.current = null
          const kind = resolveAtReply(true)
          if (kind !== 'loud') return // no waiter, or quiet poll
        } else if (/^ERROR$/i.test(line)) {
          const code = ttsLastErrorRef.current || 'ERROR'
          ttsLastErrorRef.current = null
          const kind = resolveAtReply(false, code)
          if (kind === 'quiet') return
        }

        pushLog(line, 'rx')
      }),
      api.onDoa?.(({ angle: a }) => {
        if (typeof a === 'number') setAngle(a)
      }),
    ]

    void api.listPorts().then((next) => {
      setPorts(next)
      const preferred = next.find((p) => p.isVoreo) || next[0]
      if (preferred) setSelectedPath(preferred.path)
    })
    void api.getStatus().then((s) => {
      setConnected(s.connected)
      setActivePath(s.path)
      if (s.path) setSelectedPath(s.path)
    })

    return () => {
      unsubs.forEach((u) => u?.())
    }
  }, [api])

  const moduleReady = connected && isModuleReady(deviceState)

  const showInitWait = connected && !moduleReady

  useEffect(() => {
    if (!showInitWait) {
      setInitDots('')
      return
    }
    flashToast(t(localeRef.current, 'waitModuleInit'), 'fail')
    setInitDots('')
    const id = window.setInterval(() => {
      setInitDots((prev) => (prev.length >= 3 ? '' : `${prev}.`))
    }, 500)
    return () => window.clearInterval(id)
  }, [showInitWait])

  const statusLabel = useMemo(() => {
    if (connected) return t(locale, 'connected')
    return t(locale, 'disconnected')
  }, [connected, locale])

  function ensureModuleReady(): boolean {
    if (!connectedRef.current) {
      flashToast(t(localeRef.current, 'notConnected'), 'fail')
      return false
    }
    if (!isModuleReady(deviceStateRef.current)) {
      flashToast(t(localeRef.current, 'waitModuleInit'), 'fail')
      return false
    }
    return true
  }

  async function handleConnect() {
    if (!api || !selectedPath) return
    const res = await api.connect(selectedPath)
    if (!res.ok) setToast(res.error || t(locale, 'sendFailed'))
  }

  async function handleDisconnect() {
    if (!api) return
    while (atWaiters.current.length) cancelLastAtWaiter()
    const res = await api.disconnect()
    if (res.ok) {
      setConnected(false)
      setActivePath(null)
      flashToast(t(locale, 'disconnectedOk'), 'ok')
    } else {
      flashToast(t(locale, 'sendFailed'), 'fail')
    }
  }

  /** 文本区发送：先 AT+STOP 清队列，再播新文本（打断替换） */
  async function sendManualTts(raw: string) {
    if (!ensureModuleReady()) return
    const payload = raw.replace(/\r?\n/g, ' ').trim()
    if (!payload) return

    turnId.current += 1
    llmAbort.current?.abort()
    llmAbort.current = null
    setLlmBusy(false)
    setSending(true)

    const stop = await sendAtStop({ quiet: true })
    if (!stop.ok) {
      setSending(false)
      const msg =
        stop.error === 'timeout'
          ? t(localeRef.current, 'cmdTimeout')
          : stop.error || t(localeRef.current, 'cmdFail')
      flashToast(msg, 'fail')
      return
    }

    const ok = await playTts(payload, 'tts')
    if (ok) setTtsText('')
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void sendManualTts(ttsText)
  }

  async function sendDeviceCmd(
    line: string,
    opts?: { quiet?: boolean; successMsg?: string; timeoutMs?: number },
  ): Promise<AtOutcome> {
    if (!api) {
      if (!opts?.quiet) flashToast(t(locale, 'disconnected'), 'fail')
      return { ok: false, error: t(locale, 'disconnected') }
    }
    if (!connectedRef.current) {
      if (!opts?.quiet) flashToast(t(locale, 'notConnected'), 'fail')
      return { ok: false, error: t(locale, 'notConnected') }
    }
    const isStateQuery = /^AT\+STATE\??$/i.test(line.trim())
    if (!isStateQuery && !isModuleReady(deviceStateRef.current)) {
      if (!opts?.quiet) flashToast(t(locale, 'waitModuleInit'), 'fail')
      return { ok: false, error: t(locale, 'waitModuleInit') }
    }

    const pending = waitForAtReply(opts?.timeoutMs ?? 4000, Boolean(opts?.quiet))
    const res = await api.sendCmd(line)
    if (!res.ok) {
      cancelLastAtWaiter()
      if (!opts?.quiet) {
        flashToast(res.error || t(locale, 'sendFailed'), 'fail')
        pushLog(`ERR ${line}`, 'sys')
      }
      return { ok: false, error: res.error || t(locale, 'sendFailed') }
    }

    if (!opts?.quiet) pushLog(line, 'tx')
    const reply = await pending
    if (!opts?.quiet) {
      if (reply.ok) {
        flashToast(opts?.successMsg || t(locale, 'cmdOk'), 'ok')
      } else {
        const msg =
          reply.error === 'timeout' ? t(locale, 'cmdTimeout') : t(locale, 'cmdFail')
        flashToast(msg, 'fail')
        pushLog(`FAIL ${line}`, 'sys')
      }
    }
    return reply
  }

  async function applyDeviceSettings() {
    const next = {
      volume: clampLevel(device.volume, 8),
      speed: clampLevel(device.speed, 5),
    }
    setDevice(next)
    localStorage.setItem('voreo-device', JSON.stringify(next))
    setCmdBusy(true)
    try {
      const vol = await sendDeviceCmd(`AT+VOL=${next.volume}`, { quiet: true })
      pushLog(`AT+VOL=${next.volume}`, 'tx')
      if (!vol.ok) {
        flashToast(
          vol.error === 'timeout' ? t(locale, 'cmdTimeout') : t(locale, 'cmdFail'),
          'fail',
        )
        return
      }
      const spd = await sendDeviceCmd(`AT+SPD=${next.speed}`, { quiet: true })
      pushLog(`AT+SPD=${next.speed}`, 'tx')
      if (!spd.ok) {
        flashToast(
          spd.error === 'timeout' ? t(locale, 'cmdTimeout') : t(locale, 'cmdFail'),
          'fail',
        )
        return
      }
      flashToast(t(locale, 'settingsApplied'), 'ok')
    } finally {
      setCmdBusy(false)
    }
  }

  async function onWakeAction(action: 'query' | 'set' | 'restore') {
    if (action === 'query') {
      setCmdBusy(true)
      try {
        await sendDeviceCmd('AT+WAKEWORD?', { successMsg: t(locale, 'wakeQueryOk') })
      } finally {
        setCmdBusy(false)
      }
      return
    }

    const word =
      action === 'restore' ? DEFAULT_WAKE : (wakeDraft.trim() || wakeCurrent).trim()
    if (!word) {
      flashToast(t(locale, 'wakeWordInput'), 'fail')
      return
    }
    setCmdBusy(true)
    try {
      const res = await sendDeviceCmd(`AT+WAKEWORD=${word}`, {
        successMsg: t(locale, 'wakeWordApplied'),
      })
      if (!res.ok) return
      setWakeCurrent(word)
      if (action === 'restore') setWakeDraft('')
    } finally {
      setCmdBusy(false)
    }
  }

  async function refreshAngle() {
    setCmdBusy(true)
    try {
      const angleReply = await sendDeviceCmd('AT+ANGLE?', { quiet: true })
      const energyReply = await sendDeviceCmd('AT+ENERGY?', { quiet: true })
      if (angleReply.ok || energyReply.ok) flashToast(t(locale, 'doaQueryOk'), 'ok')
      else {
        flashToast(
          angleReply.error === 'timeout' || energyReply.error === 'timeout'
            ? t(locale, 'cmdTimeout')
            : t(locale, 'cmdFail'),
          'fail',
        )
      }
    } finally {
      setCmdBusy(false)
    }
  }

  async function applyDoaMode(mode: DoaMode) {
    setCmdBusy(true)
    try {
      const reply = await sendDeviceCmd(`AT+DOAMODE=${mode}`, {
        successMsg: t(locale, 'doaModeOk'),
      })
      if (reply.ok) setDoaMode(mode)
    } finally {
      setCmdBusy(false)
    }
  }

  function saveLlm() {
    saveLlmConfig(llm)
    if (isLlmConfigured(llm)) {
      setToast(t(locale, 'llmReady'))
      pushLog('LLM config saved', 'sys')
    } else if (llm.useDemoReply) {
      setToast(t(locale, 'llmDemo'))
      pushLog('LLM demo mode', 'sys')
    } else {
      setToast(t(locale, 'llmIdle'))
      pushLog('LLM idle (demo off)', 'sys')
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-block">
          <h1 className="brand">{t(locale, 'brand')}</h1>
          <p className="tagline">{t(locale, 'tagline')}</p>
        </div>
        <div className="top-actions">
          <div className="lang-switch" role="group" aria-label={t(locale, 'lang')}>
            <button
              type="button"
              className={locale === 'zh' ? 'active' : ''}
              onClick={() => setLocale('zh')}
            >
              中文
            </button>
            <button
              type="button"
              className={locale === 'en' ? 'active' : ''}
              onClick={() => setLocale('en')}
            >
              EN
            </button>
          </div>
        </div>
      </header>

      <div className="layout">
        <div className="main-col">
          <section className="card asr-card card-pad">
            <div className="card-head">
              <div className="card-head-left">
                <h2 className="section-title">{t(locale, 'asrTitle')}</h2>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={chat.length === 0}
                  onClick={() => setChat([])}
                >
                  {t(locale, 'clearChat')}
                </button>
              </div>
            </div>
            <div className="asr-stream">
              {chat.length === 0 && !llmBusy ? (
                <p className="asr-empty">{t(locale, 'asrEmpty')}</p>
              ) : (
                <>
                  {chat.map((item) => (
                    <div
                      key={item.id}
                      className={`bubble ${item.kind === 'asr' ? '' : item.kind === 'sys' ? 'sys' : 'tts'}`}
                    >
                      <p className="bubble-text">{item.text}</p>
                      <div className="bubble-meta">
                        {item.kind.toUpperCase()} · {formatTime(item.at, locale)}
                      </div>
                    </div>
                  ))}
                  {llmBusy ? (
                    <div className="bubble tts thinking">
                      <p className="bubble-text">{t(locale, 'llmThinking')}</p>
                    </div>
                  ) : null}
                </>
              )}
              <div ref={asrEndRef} />
            </div>
          </section>

          <section className="card tts-card card-pad">
            <h2 className="section-title">{t(locale, 'ttsTitle')}</h2>
            <form className="tts-form" onSubmit={onSubmit}>
              <textarea
                className="tts-input"
                value={ttsText}
                onChange={(e) => setTtsText(e.target.value)}
                placeholder={t(locale, 'ttsPlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void sendManualTts(ttsText)
                  }
                }}
              />
              <div className="tts-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={sending || !ttsText.trim() || (connected && !moduleReady)}
                >
                  {t(locale, 'speak')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost danger"
                  onClick={() => void stopOrInterrupt()}
                >
                  {t(locale, 'stopTts')}
                </button>
              </div>
            </form>
          </section>

          <DoaPanel
            locale={locale}
            angle={angle}
            energy={energy}
            doaMode={doaMode}
            onDoaModeChange={(mode) => void applyDoaMode(mode)}
            onRefresh={() => void refreshAngle()}
            busy={cmdBusy || (connected && !moduleReady)}
          />
        </div>

        <aside className="side-col">
          <section className="card status-card card-pad">
            <div className="status-top">
              <div className="meta">
                <div>
                  {t(locale, 'port')}: <strong>{activePath || selectedPath || '—'}</strong>
                </div>
                <div>
                  {t(locale, 'version')}: <strong>{version || '—'}</strong>
                </div>
                <p className="hint">{t(locale, 'autoDetect')}</p>
              </div>
              <div className="status-badges">
                <div className="pill compact">
                  <span className={`dot ${connected ? 'on' : ''}`} />
                  {statusLabel}
                </div>
                <DeviceStateIcon
                  locale={locale}
                  state={connected ? deviceState : null}
                  busy={!connected}
                  onRefresh={() => {
                    if (!connected) return
                    void sendDeviceCmd('AT+STATE?', { quiet: true })
                  }}
                />
              </div>
            </div>

            {showInitWait ? (
              <p className="init-banner" role="status">
                {t(locale, 'waitModuleInit')}
                <span className="init-dots" aria-hidden>
                  {initDots}
                </span>
              </p>
            ) : null}

            <div className="port-row">
              <select
                className="port"
                value={selectedPath}
                onChange={(e) => setSelectedPath(e.target.value)}
                aria-label={t(locale, 'selectPort')}
              >
                {ports.length === 0 ? (
                  <option value="">{t(locale, 'noPorts')}</option>
                ) : (
                  ports.map((p) => (
                    <option key={p.path} value={p.path}>
                      {p.isVoreo ? '★ ' : ''}
                      {p.friendlyName || p.path}
                    </option>
                  ))
                )}
              </select>
              {connected ? (
                <button type="button" className="btn btn-ghost" onClick={() => void handleDisconnect()}>
                  {t(locale, 'disconnect')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!selectedPath || !hasApi}
                  onClick={() => void handleConnect()}
                >
                  {t(locale, 'connect')}
                </button>
              )}
            </div>
          </section>

          <div className="side-tabs" role="tablist" aria-label={t(locale, 'brand')}>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'device'}
              className={sideTab === 'device' ? 'active' : ''}
              onClick={() => setSideTab('device')}
            >
              {t(locale, 'sectionDevice')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sideTab === 'ai'}
              className={sideTab === 'ai' ? 'active' : ''}
              onClick={() => setSideTab('ai')}
            >
              {t(locale, 'sectionAi')}
            </button>
          </div>

          {sideTab === 'device' ? (
            <div className="side-stack">
              <DeviceSettings
                locale={locale}
                value={device}
                onChange={setDevice}
                onApply={() => void applyDeviceSettings()}
                busy={cmdBusy || (connected && !moduleReady)}
              />
              <WakeWordPanel
                locale={locale}
                current={wakeCurrent}
                draft={wakeDraft}
                onDraft={setWakeDraft}
                onAction={(action) => void onWakeAction(action)}
                busy={cmdBusy || (connected && !moduleReady)}
              />
            </div>
          ) : (
            <LlmPanel locale={locale} value={llm} onChange={setLlm} onSave={saveLlm} />
          )}

          <section className="card card-pad log-card">
            <div className="card-head">
              <h2 className="section-title">{t(locale, 'logTitle')}</h2>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={logs.length === 0}
                onClick={() => setLogs([])}
              >
                {t(locale, 'clearLog')}
              </button>
            </div>
            <div className="log-list">
              {logs.length === 0 ? (
                <div className="log-line">—</div>
              ) : (
                logs.map((item) => (
                  <div key={item.id} className="log-line">
                    {formatTime(item.at, locale)} {item.line}
                  </div>
                ))
              )}
            </div>
          </section>
        </aside>
      </div>

      {toast ? (
        <div className={`toast${toastTone ? ` ${toastTone}` : ''}`}>{toast}</div>
      ) : null}
    </div>
  )
}
