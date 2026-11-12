import { ipcMain } from 'electron'
import type { SettingsPatch } from '../settings'
import type { SettingsStore } from '../settings-store'

/** 应用设置的 IPC */
export const registerSettingsIpc = (settings: SettingsStore): void => {
  ipcMain.handle('settings:get', async () => settings.toPublic(await settings.read()))

  // 更新应用设置，未提供的字段保持不变
  ipcMain.handle('settings:update', (_event, patch: SettingsPatch) => settings.update(patch))
}
