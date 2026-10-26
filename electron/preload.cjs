const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('voreo', {
  listPorts: () => ipcRenderer.invoke('serial:list'),
  connect: (portPath) => ipcRenderer.invoke('serial:connect', portPath),
  disconnect: () => ipcRenderer.invoke('serial:disconnect'),
  sendTts: (text) => ipcRenderer.invoke('serial:send', text),
  getStatus: () => ipcRenderer.invoke('serial:status'),
  onStatus: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('serial:status', handler)
    return () => ipcRenderer.removeListener('serial:status', handler)
  },
  onPorts: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('serial:ports', handler)
    return () => ipcRenderer.removeListener('serial:ports', handler)
  },
  onAsr: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('serial:asr', handler)
    return () => ipcRenderer.removeListener('serial:asr', handler)
  },
  onWake: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('serial:wake', handler)
    return () => ipcRenderer.removeListener('serial:wake', handler)
  },
  onVersion: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('serial:version', handler)
    return () => ipcRenderer.removeListener('serial:version', handler)
  },
  onError: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('serial:error', handler)
    return () => ipcRenderer.removeListener('serial:error', handler)
  },
  onLog: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('serial:log', handler)
    return () => ipcRenderer.removeListener('serial:log', handler)
  },
})
