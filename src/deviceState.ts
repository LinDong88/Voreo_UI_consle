/** Device RGB / AT+STATE? English names (UsbVcom + RgbIndicator). */
export type DeviceStateName =
  | 'BOOTING'
  | 'STANDBY'
  | 'LISTENING'
  | 'TTS'
  | 'WAKEWORD_LEARNING'
  | 'WAKEWORD_LEARN_OK'
  | 'WAKEWORD_LEARN_FAIL'
  | 'BOOT_FAIL'
  | 'UNKNOWN'

export type DeviceStateMeta = {
  id: DeviceStateName
  /** CSS modifier on .device-state */
  tone: string
  zh: string
  en: string
}

export const DEVICE_STATES: Record<DeviceStateName, DeviceStateMeta> = {
  BOOTING: { id: 'BOOTING', tone: 'booting', zh: '上电等待', en: 'Booting' },
  STANDBY: { id: 'STANDBY', tone: 'standby', zh: '待机就绪', en: 'Standby' },
  LISTENING: { id: 'LISTENING', tone: 'listening', zh: '正在聆听', en: 'Listening' },
  TTS: { id: 'TTS', tone: 'tts', zh: 'TTS 播放中', en: 'Speaking' },
  WAKEWORD_LEARNING: {
    id: 'WAKEWORD_LEARNING',
    tone: 'learn',
    zh: '唤醒词学习中',
    en: 'Learning wake word',
  },
  WAKEWORD_LEARN_OK: {
    id: 'WAKEWORD_LEARN_OK',
    tone: 'learn-ok',
    zh: '唤醒词学习成功',
    en: 'Wake word learned',
  },
  WAKEWORD_LEARN_FAIL: {
    id: 'WAKEWORD_LEARN_FAIL',
    tone: 'learn-fail',
    zh: '唤醒词学习失败',
    en: 'Wake word learn failed',
  },
  BOOT_FAIL: { id: 'BOOT_FAIL', tone: 'boot-fail', zh: '开机失败', en: 'Boot failed' },
  UNKNOWN: { id: 'UNKNOWN', tone: 'unknown', zh: '未知', en: 'Unknown' },
}

export function parseDeviceState(raw: string): DeviceStateName {
  const key = raw.trim().toUpperCase() as DeviceStateName
  return key in DEVICE_STATES ? key : 'UNKNOWN'
}

export function deviceStateMeta(name: DeviceStateName | null): DeviceStateMeta {
  if (!name) return DEVICE_STATES.UNKNOWN
  return DEVICE_STATES[name] ?? DEVICE_STATES.UNKNOWN
}

/** True once past boot — STANDBY / LISTENING / TTS / wake-word learning results. */
export function isModuleReady(state: DeviceStateName | null): boolean {
  if (!state) return false
  return state !== 'BOOTING' && state !== 'BOOT_FAIL' && state !== 'UNKNOWN'
}
