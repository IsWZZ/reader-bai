// 插件 UI 的自定义协议地址；scheme 必须与主进程 view-protocol.ts 保持一致。
export const PLUGIN_VIEW_SCHEME = 'reader-bai-plugin'

export const pluginViewUrl = (pluginId: string, entry: string): string => {
  const path = entry
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${PLUGIN_VIEW_SCHEME}://${pluginId}/${path}`
}
