// 插件 UI 静态资源协议。
// 只服务已启用且兼容的插件目录内的普通文件；入口页运行在 sandbox iframe 中，
// 不能访问 Node、平台 preload 或主窗口 DOM。

import { protocol } from 'electron'
import { readFile } from 'fs/promises'
import type { PluginHost } from './host'
import { PLUGIN_VIEW_SCHEME, pluginContentType, pluginViewCsp } from './view-assets'

const MAX_URL_LENGTH = 4096

/** 在 app ready 之前调用，声明自定义协议的能力 */
export const registerPluginViewScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PLUGIN_VIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ])
}

const notFound = (): Response => new Response('Not found', { status: 404 })

/** app ready 之后注册处理器；每次请求都重新校验插件启用状态和路径归属 */
export const registerPluginViewProtocol = (host: Pick<PluginHost, 'resolveAsset'>): void => {
  protocol.handle(PLUGIN_VIEW_SCHEME, async (request) => {
    if (request.method !== 'GET' || request.url.length > MAX_URL_LENGTH) return notFound()

    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return notFound()
    }

    let assetPath: string
    try {
      assetPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
    } catch {
      return notFound()
    }

    const asset = await host.resolveAsset(url.hostname, assetPath)
    if (!asset) return notFound()

    let data: Buffer
    try {
      data = await readFile(asset.filePath)
    } catch {
      return notFound()
    }

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': pluginContentType(asset.filePath),
        'Content-Security-Policy': pluginViewCsp(asset.permissions),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*'
      }
    })
  })
}
