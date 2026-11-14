// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { missingToolPermissions } from '../../src/main/plugins/api'
import { parseHostMessage } from '../../src/main/plugins/protocol'

describe('plugin host protocol', () => {
  it('accepts lifecycle, status, log and api messages', () => {
    expect(parseHostMessage({ type: 'ready' })).toEqual({ type: 'ready' })
    expect(parseHostMessage({ type: 'stopped' })).toEqual({ type: 'stopped' })
    expect(
      parseHostMessage({
        type: 'status',
        pluginId: 'reader-bai.arxiv-source',
        status: 'error',
        message: '入口无效'
      })
    ).toEqual({
      type: 'status',
      pluginId: 'reader-bai.arxiv-source',
      status: 'error',
      message: '入口无效'
    })
    expect(
      parseHostMessage({
        type: 'log',
        pluginId: 'reader-bai.arxiv-source',
        level: 'warn',
        message: '慢请求'
      })
    ).toMatchObject({ level: 'warn' })
    expect(
      parseHostMessage({
        type: 'api-request',
        requestId: 'request-1',
        pluginId: 'reader-bai.arxiv-source',
        method: 'tools.execute',
        params: { name: 'library.list', input: {} }
      })
    ).toMatchObject({ method: 'tools.execute' })
    expect(
      parseHostMessage({
        type: 'api-request',
        requestId: 'request-2',
        pluginId: 'reader-bai.arxiv-source',
        method: 'tools.list'
      })
    ).toEqual({
      type: 'api-request',
      requestId: 'request-2',
      pluginId: 'reader-bai.arxiv-source',
      method: 'tools.list',
      params: undefined
    })
  })

  it('rejects unknown message types and methods', () => {
    expect(() => parseHostMessage({ type: 'eval' })).toThrow('未知的插件宿主消息')
    expect(() => parseHostMessage('ready')).toThrow('插件宿主消息必须是对象')
    expect(() =>
      parseHostMessage({
        type: 'api-request',
        requestId: 'request-1',
        pluginId: 'reader-bai.arxiv-source',
        method: 'fs.read'
      })
    ).toThrow('不支持的插件 API')
  })

  it('rejects invalid statuses and values', () => {
    expect(() =>
      parseHostMessage({ type: 'status', pluginId: 'reader-bai.arxiv-source', status: 'ready' })
    ).toThrow('插件状态不正确')
    expect(() => parseHostMessage({ type: 'status', pluginId: '', status: 'active' })).toThrow(
      '插件 id必须是非空字符串'
    )
    expect(() =>
      parseHostMessage({
        type: 'log',
        pluginId: 'reader-bai.arxiv-source',
        level: 'debug',
        message: 'x'
      })
    ).toThrow('插件日志级别不正确')
  })

  it('caps log, error and api payload sizes', () => {
    expect(() =>
      parseHostMessage({
        type: 'log',
        pluginId: 'reader-bai.arxiv-source',
        level: 'info',
        message: 'x'.repeat(4001)
      })
    ).toThrow('日志内容过长')

    expect(() =>
      parseHostMessage({
        type: 'status',
        pluginId: 'reader-bai.arxiv-source',
        status: 'error',
        message: 'x'.repeat(1001)
      })
    ).toThrow('状态说明过长')

    expect(() =>
      parseHostMessage({
        type: 'api-request',
        requestId: 'request-1',
        pluginId: 'reader-bai.arxiv-source',
        method: 'tools.execute',
        params: { name: 'library.list', input: 'x'.repeat(100_001) }
      })
    ).toThrow('插件 API 参数过大')
  })

  it('rejects params that cannot be serialized', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    expect(() =>
      parseHostMessage({
        type: 'api-request',
        requestId: 'request-1',
        pluginId: 'reader-bai.arxiv-source',
        method: 'tools.execute',
        params: circular
      })
    ).toThrow('插件 API 参数无法序列化')
  })
})

describe('plugin tool permissions', () => {
  it('reports permissions the plugin has not declared', () => {
    const tool = { requiredPermissions: ['documents:read', 'annotations:write'] }

    expect(missingToolPermissions(tool, ['documents:read'])).toEqual(['annotations:write'])
    expect(missingToolPermissions(tool, ['documents:read', 'annotations:write'])).toEqual([])
    expect(missingToolPermissions({ requiredPermissions: [] }, [])).toEqual([])
  })
})
