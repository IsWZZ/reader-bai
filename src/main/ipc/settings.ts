import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { findBaseUrlChanges, type AiBaseUrlChange, type SettingsPatch } from '../settings'
import type { SettingsStore } from '../settings-store'

/** 已有 Key 的配置换了服务地址时，必须由用户在原生对话框里确认 */
const confirmBaseUrlChanges = async (
  event: IpcMainInvokeEvent,
  changes: AiBaseUrlChange[]
): Promise<boolean> => {
  const options = {
    type: 'warning' as const,
    buttons: ['取消', '继续保存'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: '确认更改 AI 服务地址',
    message: '已有 API Key 的配置将改为向新地址发送请求',
    detail: `API Key 会被发送到：\n${changes
      .map((change) => `${change.from || '未填写'} → ${change.to || '未填写'}`)
      .join('\n')}\n\n只有确认这是你要使用的服务时才继续。`
  }
  const window =
    BrowserWindow.fromWebContents(event.sender) ??
    BrowserWindow.getFocusedWindow() ??
    BrowserWindow.getAllWindows()[0]
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return result.response === 1
}

/** 应用设置的 IPC */
export const registerSettingsIpc = (settings: SettingsStore): void => {
  ipcMain.handle('settings:get', async () => settings.toPublic(await settings.read()))

  // 更新应用设置，未提供的字段保持不变
  ipcMain.handle('settings:update', async (event, patch: SettingsPatch) => {
    const stored = await settings.read()
    const changes = findBaseUrlChanges(stored, patch)
    if (changes.length > 0 && !(await confirmBaseUrlChanges(event, changes))) {
      throw new Error('已取消保存：AI 服务地址未更改')
    }
    return settings.update(patch)
  })
}
