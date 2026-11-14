// 用户数据的统一根目录。
// Electron/Chromium 会在 userData 根目录写大量缓存和配置，平台自己的文件
// 统一放进 userData/Userdata，方便用户备份、迁移和清理，也避免和 Electron 文件混在一起。

import { join } from 'path'

export const USER_DATA_DIRECTORY = 'Userdata'

// 定义的用户数据路径接口
export interface UserDataPaths {
  /** userData/Userdata */
  dataRoot: string
  libraryFile: string
  annotationsFile: string
  settingsFile: string
  pluginsStateFile: string
  pluginsDirectory: string
  papersDirectory: string
}

export const createUserDataPaths = (userDataRoot: string): UserDataPaths => {
  const dataRoot = join(userDataRoot, USER_DATA_DIRECTORY)
  return {
    dataRoot,
    libraryFile: join(dataRoot, 'library.json'),
    annotationsFile: join(dataRoot, 'annotations.json'),
    settingsFile: join(dataRoot, 'settings.json'),
    pluginsStateFile: join(dataRoot, 'plugins.json'),
    pluginsDirectory: join(dataRoot, 'plugins'),
    papersDirectory: join(dataRoot, 'papers')
  }
}
