const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { SerialPort } = require('serialport')

const ESPRESSIF_VID = 0x303a
const BAUD = 115200
const SCAN_MS = 2000

/** @type {BrowserWindow | null} */
let mainWindow = null
/** @type {import('serialport').SerialPort | null} */
let port = null
/** @type {ReturnType<typeof setInterval> | null} */
let scanTimer = null
let rxBuffer = ''
let intentionalClose = false
let autoConnectEnabled = true

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
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
  const text = line.replace(/\r$/, '').trimEnd()
  if (!text) return

  if (text.startsWith('ASR:')) {
    send('serial:asr', { text: text.slice(4) })
    return
  }
  if (text === 'WAKE') {
    send('serial:wake', {})
    return
  }
  if (text.startsWith('VER:')) {
    send('serial:version', { version: text.slice(4) })
    return
  }
  if (text.startsWith('ERR:')) {
    send('serial:error', { message: text.slice(4).trim() })
    return
  }
  send('serial:log', { line: text })
}

function onData(chunk) {
  rxBuffer += chunk.toString('utf8')
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

async function openPort(portPath) {
  if (port?.isOpen && port.path === portPath) {
    return { ok: true, path: portPath }
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
      send('serial:status', {
        connected: false,
        path: null,
        error: err.message,
      })
    })
    next.on('close', () => {
      if (port === next) port = null
      if (!intentionalClose) {
        send('serial:status', { connected: false, path: null, error: null })
      }
    })

    next.open((err) => {
      if (err) {
        send('serial:status', {
          connected: false,
          path: null,
          error: err.message,
        })
        resolve({ ok: false, error: err.message })
        return
      }
      port = next
      send('serial:status', {
        connected: true,
        path: portPath,
        error: null,
      })
      resolve({ ok: true, path: portPath })
    })
  })
}

async function autoConnect() {
  if (!autoConnectEnabled) return
  if (port?.isOpen) return

  try {
    const ports = await listPorts()
    const preferred = ports.find((p) => p.isVoreo) || null
    send('serial:ports', { ports })
    if (preferred) {
      await openPort(preferred.path)
    }
  } catch (err) {
    send('serial:status', {
      connected: false,
      path: null,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function startScan() {
  if (scanTimer) return
  scanTimer = setInterval(() => {
    void autoConnect()
  }, SCAN_MS)
  void autoConnect()
}

function stopScan() {
  if (scanTimer) {
    clearInterval(scanTimer)
    scanTimer = null
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 880,
    minHeight: 640,
    title: 'Voreo Console',
    backgroundColor: '#e8eef5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
  if (!app.isPackaged) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  createWindow()
  startScan()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopScan()
  intentionalClose = true
  detachPort()
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('serial:list', async () => listPorts())

ipcMain.handle('serial:connect', async (_event, portPath) => {
  if (!portPath) return { ok: false, error: 'No port' }
  autoConnectEnabled = true
  return openPort(portPath)
})

ipcMain.handle('serial:disconnect', async () => {
  autoConnectEnabled = false
  intentionalClose = true
  detachPort()
  intentionalClose = false
  send('serial:status', { connected: false, path: null, error: null })
  return { ok: true }
})

ipcMain.handle('serial:send', async (_event, text) => {
  if (!port?.isOpen) {
    return { ok: false, error: 'Not connected' }
  }
  const payload = String(text ?? '').replace(/\r?\n/g, ' ').trim()
  if (!payload) return { ok: false, error: 'Empty' }

  return new Promise((resolve) => {
    port.write(`${payload}\n`, 'utf8', (err) => {
      if (err) {
        resolve({ ok: false, error: err.message })
        return
      }
      port.drain(() => resolve({ ok: true }))
    })
  })
})

ipcMain.handle('serial:status', async () => ({
  connected: Boolean(port?.isOpen),
  path: port?.path || null,
}))
