import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ensureVoreoApi } from './bridge'
import { DeviceSettings, DeviceSettingsState } from './components/DeviceSettings'
import { DoaPanel } from './components/DoaPanel'
import { LlmPanel } from './components/LlmPanel'
import { WakeWordPanel } from './components/WakeWordPanel'
import { Locale, t } from './i18n'
import {
  askLlm,
  demoReply,
  isLlmConfigured,
  LlmConfig,
  loadLlmConfig,
  saveLlmConfig,
} from './llm'
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

const DEFAULT_WAKE = 'HI ESP'

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
  const [listening, setListening] = useState(false)
  const [ttsText, setTtsText] = useState('')
  const [chat, setChat] = useState<ChatItem[]>([])
  const [logs, setLogs] = useState<LogItem[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const [toastTone, setToastTone] = useState<'ok' | 'fail' | null>(null)
  const [sending, setSending] = useState(false)
  const [llmBusy, setLlmBusy] = useState(false)
  const [angle, setAngle] = useState<number | null>(null)
  const [device, setDevice] = useState<DeviceSettingsState>(loadDeviceSettings)
  const [wakeCurrent, setWakeCurrent] = useState(DEFAULT_WAKE)
  const [wakeDraft, setWakeDraft] = useState('')
  const [llm, setLlm] = useState<LlmConfig>(loadLlmConfig)
  const [sideTab, setSideTab] = useState<'device' | 'ai'>('device')
  const [cmdBusy, setCmdBusy] = useState(false)
  const [doaPolling, setDoaPolling] = useState(false)

  const asrEndRef = useRef<HTMLDivElement | null>(null)
  const wakeTimer = useRef<number | null>(null)
  const llmAbort = useRef<AbortController | null>(null)
  const turnId = useRef(0)
  const localeRef = useRef(locale)
  const llmRef = useRef(llm)
  const connectedRef = useRef(connected)
  const doaPollingRef = useRef(false)
  const doaPollInFlight = useRef(false)
  const atWaiters = useRef<Array<{ resolve: (v: AtOutcome) => void; timer: number }>>([])

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
    if (!connected) setDoaPolling(false)
  }, [connected])

  useEffect(() => {
    doaPollingRef.current = doaPolling
  }, [doaPolling])

  useEffect(() => {
    if (!doaPolling || !api) return

    const tick = () => {
      if (!connectedRef.current || doaPollInFlight.current) return
      if (atWaiters.current.length > 0) return
      doaPollInFlight.current = true
      void api
        .sendCmd('AT+ANGLE?')
        .catch(() => undefined)
        .finally(() => {
          doaPollInFlight.current = false
        })
    }

    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [doaPolling, api])

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

  function pushLog(line: string) {
    setLogs((prev) => [...prev.slice(-100), { id: nowId(), line, at: Date.now() }])
  }

  function flashToast(text: string, tone?: 'ok' | 'fail') {
    setToastTone(tone ?? null)
    setToast(text)
  }

  function waitForAtReply(timeoutMs = 4000): Promise<AtOutcome> {
    return new Promise((resolve) => {
      const entry = {
        resolve,
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

  function resolveAtReply(ok: boolean, error?: string): boolean {
    const entry = atWaiters.current.shift()
    if (!entry) return false
    window.clearTimeout(entry.timer)
    entry.resolve(ok ? { ok: true } : { ok: false, error: error || 'ERROR' })
    return true
  }

  async function playTts(text: string, kind: ChatItem['kind'] = 'tts') {
    if (!api || !connectedRef.current) {
      flashToast(t(localeRef.current, 'notConnected'), 'fail')
      return false
    }
    const payload = text.trim()
    if (!payload) return false
    setSending(true)
    const pending = waitForAtReply(60000)
    const res = await api.sendTts(payload)
    if (!res.ok) {
      cancelLastAtWaiter()
      setSending(false)
      flashToast(res.error || t(localeRef.current, 'sendFailed'), 'fail')
      return false
    }
    pushLog(`AT+TTS=${payload}`)
    const reply = await pending
    setSending(false)
    if (!reply.ok) {
      const msg =
        reply.error === 'timeout'
          ? t(localeRef.current, 'cmdTimeout')
          : t(localeRef.current, 'cmdFail')
      flashToast(msg, 'fail')
      return false
    }
    setChat((prev) => [...prev, { id: nowId(), kind, text: payload, at: Date.now() }])
    flashToast(t(localeRef.current, 'ttsOk'), 'ok')
    return true
  }

  async function syncDeviceState() {
    if (!api) return
    for (const line of ['AT+VER?', 'AT+VOL?', 'AT+SPD?', 'AT+WAKEWORD?']) {
      const pending = waitForAtReply(4000)
      const res = await api.sendCmd(line)
      pushLog(res.ok ? `CMD>${line}` : `CMD ERR ${line}`)
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
        pushLog('LLM> request')
        reply = await askLlm(cfg, asrText, ac.signal)
      } else if (cfg.useDemoReply) {
        reply = demoReply(localeRef.current, asrText)
        kind = 'sys'
        pushLog('LLM> demo')
      } else {
        pushLog('LLM> skipped (demo off)')
        return
      }
      if (myTurn !== turnId.current || ac.signal.aborted) return
      await playTts(reply, kind)
    } catch (err) {
      if (ac.signal.aborted || myTurn !== turnId.current) return
      const msg = err instanceof Error ? err.message : String(err)
      setToast(`${t(localeRef.current, 'llmFailed')}: ${msg}`)
      pushLog(`LLM ERR ${msg}`)
    } finally {
      if (myTurn === turnId.current) setLlmBusy(false)
    }
  }

  function stopOrInterrupt() {
    turnId.current += 1
    llmAbort.current?.abort()
    llmAbort.current = null
    setLlmBusy(false)
    pushLog('CMD> TTS_STOP (placeholder)')
    setToast(t(locale, 'llmStopped'))
    setChat((prev) => [
      ...prev,
      { id: nowId(), kind: 'sys', text: t(locale, 'llmStopped'), at: Date.now() },
    ])
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
          pushLog(`connected ${status.path}`)
          void syncDeviceState()
        } else if (!status.connected) {
          setListening(false)
          pushLog('disconnected')
        }
        if (status.error) {
          setToast(status.error)
          pushLog(`error: ${status.error}`)
        }
      }),
      api.onAsr(({ text }) => {
        const content = String(text ?? '').trim()
        setListening(false)
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
        setListening(true)
        if (wakeTimer.current) window.clearTimeout(wakeTimer.current)
        wakeTimer.current = window.setTimeout(() => setListening(false), 8000)
      }),
      api.onVersion(({ version: ver }) => {
        setVersion(ver)
      }),
      api.onError(({ message }) => {
        // OK/ERROR handled by AT waiters via onLog — avoid duplicate toasts
        if (atWaiters.current.length > 0) return
        if (doaPollingRef.current && message === 'ERROR') return
        flashToast(message === 'ERROR' ? t(localeRef.current, 'cmdError') : message, 'fail')
      }),
      api.onLog(({ line }) => {
        const angleHit = line.match(/^\+?ANGLE:\s*(-?\d+(?:\.\d+)?)/i)
        if (angleHit) setAngle(Number(angleHit[1]))

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

        if (/^OK$/i.test(line)) resolveAtReply(true)
        else if (/^ERROR$/i.test(line)) resolveAtReply(false, 'ERROR')

        // Quiet poll: skip flooding the log with ANGLE replies / OK
        if (doaPollingRef.current && (/^\+?ANGLE:/i.test(line) || /^OK$/i.test(line))) return

        pushLog(line)
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
      if (wakeTimer.current) window.clearTimeout(wakeTimer.current)
    }
  }, [api])

  const statusLabel = useMemo(() => {
    if (llmBusy) return t(locale, 'llmThinking')
    if (listening) return t(locale, 'wakeHint')
    if (connected) return t(locale, 'connected')
    return hasApi ? t(locale, 'scanning') : t(locale, 'disconnected')
  }, [connected, listening, locale, hasApi, llmBusy])

  async function handleConnect() {
    if (!api || !selectedPath) return
    const res = await api.connect(selectedPath)
    if (!res.ok) setToast(res.error || t(locale, 'sendFailed'))
  }

  async function handleDisconnect() {
    if (!api) return
    await api.disconnect()
  }

  async function sendManualTts(raw: string) {
    const ok = await playTts(raw, 'tts')
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

    const pending = waitForAtReply(opts?.timeoutMs ?? 4000)
    const res = await api.sendCmd(line)
    if (!res.ok) {
      cancelLastAtWaiter()
      if (!opts?.quiet) {
        flashToast(res.error || t(locale, 'sendFailed'), 'fail')
        pushLog(`CMD ERR ${line}`)
      }
      return { ok: false, error: res.error || t(locale, 'sendFailed') }
    }

    if (!opts?.quiet) pushLog(`CMD>${line}`)
    const reply = await pending
    if (!opts?.quiet) {
      if (reply.ok) {
        flashToast(opts?.successMsg || t(locale, 'cmdOk'), 'ok')
      } else {
        const msg =
          reply.error === 'timeout' ? t(locale, 'cmdTimeout') : t(locale, 'cmdFail')
        flashToast(msg, 'fail')
        pushLog(`CMD FAIL ${line}`)
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
      pushLog(`CMD>AT+VOL=${next.volume}`)
      if (!vol.ok) {
        flashToast(
          vol.error === 'timeout' ? t(locale, 'cmdTimeout') : t(locale, 'cmdFail'),
          'fail',
        )
        return
      }
      const spd = await sendDeviceCmd(`AT+SPD=${next.speed}`, { quiet: true })
      pushLog(`CMD>AT+SPD=${next.speed}`)
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
      await sendDeviceCmd('AT+ANGLE?', { successMsg: t(locale, 'doaQueryOk') })
    } finally {
      setCmdBusy(false)
    }
  }

  function saveLlm() {
    saveLlmConfig(llm)
    if (isLlmConfigured(llm)) {
      setToast(t(locale, 'llmReady'))
      pushLog('LLM config saved')
    } else if (llm.useDemoReply) {
      setToast(t(locale, 'llmDemo'))
      pushLog('LLM demo mode')
    } else {
      setToast(t(locale, 'llmIdle'))
      pushLog('LLM idle (demo off)')
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
              <h2 className="section-title">{t(locale, 'asrTitle')}</h2>
              <div className={`pill compact`}>
                <span className={`dot ${llmBusy ? 'wake' : listening ? 'wake' : connected ? 'on' : ''}`} />
                {statusLabel}
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
                  disabled={sending || !ttsText.trim()}
                >
                  {t(locale, 'speak')}
                </button>
                <button type="button" className="btn btn-ghost danger" onClick={stopOrInterrupt}>
                  {t(locale, 'stopTts')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setChat([])
                    setLogs([])
                  }}
                >
                  {t(locale, 'clear')}
                </button>
              </div>
            </form>
          </section>

          <DoaPanel
            locale={locale}
            angle={angle}
            onRefresh={() => void refreshAngle()}
            polling={doaPolling}
            onTogglePoll={() => {
              if (!connectedRef.current) {
                flashToast(t(locale, 'notConnected'), 'fail')
                return
              }
              setDoaPolling((v) => !v)
            }}
            busy={cmdBusy}
          />
        </div>

        <aside className="side-col">
          <section className="card status-card card-pad">
            <div className="meta">
              <div>
                {t(locale, 'port')}: <strong>{activePath || selectedPath || '—'}</strong>
              </div>
              <div>
                {t(locale, 'version')}: <strong>{version || '—'}</strong>
              </div>
              <p className="hint">{t(locale, 'autoDetect')}</p>
            </div>

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
                busy={cmdBusy}
              />
              <WakeWordPanel
                locale={locale}
                current={wakeCurrent}
                draft={wakeDraft}
                onDraft={setWakeDraft}
                onAction={(action) => void onWakeAction(action)}
                busy={cmdBusy}
              />
            </div>
          ) : (
            <LlmPanel locale={locale} value={llm} onChange={setLlm} onSave={saveLlm} />
          )}

          <section className="card card-pad log-card">
            <h2 className="section-title">{t(locale, 'logTitle')}</h2>
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
