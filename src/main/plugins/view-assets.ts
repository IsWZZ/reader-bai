// 插件 UI 静态资源的纯逻辑：URL、MIME 和 CSP。
// 这里不依赖 electron，便于直接单测；协议注册在 view-protocol.ts。

import { extname } from 'path'
import type { PluginPermission } from './manifest'

export const PLUGIN_VIEW_SCHEME = 'reader-bai-plugin'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
}

export const pluginContentType = (filePath: string): string =>
  CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'

/** 插件 iframe 的 CSP；network 权限决定能否直接访问外部网络 */
export const pluginViewCsp = (permissions: readonly PluginPermission[]): string => {
  const network = permissions.includes('network')
  const directives = [
    `default-src ${PLUGIN_VIEW_SCHEME}:`,
    `script-src ${PLUGIN_VIEW_SCHEME}:`,
    `style-src ${PLUGIN_VIEW_SCHEME}: 'unsafe-inline'`,
    `img-src ${PLUGIN_VIEW_SCHEME}: data:${network ? ' https:' : ''}`,
    `font-src ${PLUGIN_VIEW_SCHEME}: data:`,
    `media-src ${PLUGIN_VIEW_SCHEME}:${network ? ' https:' : ''}`,
    network ? 'connect-src https: http://localhost:* http://127.0.0.1:*' : "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ]
  return directives.join('; ')
}

export const pluginViewUrl = (pluginId: string, entry: string): string => {
  const path = entry
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${PLUGIN_VIEW_SCHEME}://${pluginId}/${path}`
}
