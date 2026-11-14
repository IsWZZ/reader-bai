import { BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

/** 只允许把 http(s) 链接交给系统浏览器 */
const isSafeExternalUrl = (raw: string): boolean => {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const openExternalSafely = (raw: string): void => {
  if (!isSafeExternalUrl(raw)) return
  void shell.openExternal(raw)
}

export const createWindow = (): void => {
  const mainWindow = new BrowserWindow({
    //默认的页面宽高
    width: 900,
    height: 670,
    // 控制红绿黄灯
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 渲染进程按不可信处理：沙箱 + 隔离，且不开放 Node
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      devTools: is.dev ? true : false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 应用自身不跳转到外部页面；外链一律交给系统浏览器，非 http(s) 直接丢弃
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    openExternalSafely(url)
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })

  // 摄像头、麦克风、通知、剪贴板等权限默认全部拒绝
  const { session } = mainWindow.webContents
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.setPermissionCheckHandler(() => false)

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file in production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
