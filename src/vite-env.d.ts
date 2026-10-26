/// <reference types="vite/client" />

export type SerialPortInfo = {
  path: string
  manufacturer: string
  friendlyName: string
  vendorId: string
  productId: string
  isVoreo: boolean
}

export type SerialStatus = {
  connected: boolean
  path: string | null
  error?: string | null
}

export type DoaEvent = {
  angle?: number
  confidence?: number
}

export type VoreoApi = {
  listPorts: () => Promise<SerialPortInfo[]>
  connect: (portPath: string) => Promise<{ ok: boolean; path?: string; error?: string }>
  disconnect: () => Promise<{ ok: boolean }>
  sendTts: (text: string) => Promise<{ ok: boolean; error?: string }>
  getStatus: () => Promise<{ connected: boolean; path: string | null }>
  onStatus: (cb: (data: SerialStatus) => void) => () => void
  onPorts: (cb: (data: { ports: SerialPortInfo[] }) => void) => () => void
  onAsr: (cb: (data: { text: string }) => void) => () => void
  onWake: (cb: () => void) => () => void
  onVersion: (cb: (data: { version: string }) => void) => () => void
  onError: (cb: (data: { message: string }) => void) => () => void
  onLog: (cb: (data: { line: string }) => void) => () => void
  onDoa?: (cb: (data: DoaEvent) => void) => () => void
}

declare global {
  interface Window {
    voreo?: VoreoApi
  }
}

export {}
