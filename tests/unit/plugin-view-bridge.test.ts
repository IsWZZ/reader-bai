// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createPluginViewBridge } from '../../src/main/plugins/view-bridge'
import type { PluginHost, ResolvedPluginView } from '../../src/main/plugins/host'
import type { PluginPermission } from '../../src/main/plugins/manifest'
import { createToolRegistry, type ToolRegistry } from '../../src/main/tool-registry'

const createHost = (
  permissions: string[] = ['documents:read'],
  found = true
): Pick<PluginHost, 'resolveView'> => ({
  resolveView: async (): Promise<ResolvedPluginView | null> =>
    found
      ? {
          view: {
            id: 'search.arxiv.panel',
            title: 'arXiv 面板',
            location: 'sidebar',
            entry: 'ui/index.html'
          },
          permissions: permissions as PluginPermission[]
        }
      : null
})

const createTools = (): { registry: ToolRegistry; execute: ReturnType<typeof vi.fn> } => {
  const registry = createToolRegistry()
  const execute = vi.fn(async () => ({ content: 'ok' }))
  registry.register({
    name: 'library.list',
    title: '列出论文',
    description: '列出论文库',
    inputSchema: { type: 'object', properties: {} },
    risk: 'read',
    exposeToAi: true,
    requiredPermissions: ['documents:read'],
    execute
  })
  return { registry, execute }
}

describe('createPluginViewBridge', () => {
  it('lists tools through the platform registry', async () => {
    const { registry } = createTools()
    const bridge = createPluginViewBridge({ host: createHost(), tools: registry })

    const tools = (await bridge.request(
      'reader-bai.arxiv-source',
      'search.arxiv.panel',
      'tools.list',
      undefined
    )) as {
      name: string
    }[]

    expect(tools.map((tool) => tool.name)).toContain('library.list')
  })

  it('executes tools with the plugin permission and source', async () => {
    const { registry, execute } = createTools()
    const bridge = createPluginViewBridge({ host: createHost(), tools: registry })

    await expect(
      bridge.request('reader-bai.arxiv-source', 'search.arxiv.panel', 'tools.execute', {
        name: 'library.list',
        input: {}
      })
    ).resolves.toEqual({ content: 'ok' })

    expect(execute).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        pluginId: 'reader-bai.arxiv-source'
      })
    )
  })

  it('rejects tools whose manifest permission is missing', async () => {
    const { registry, execute } = createTools()
    const bridge = createPluginViewBridge({ host: createHost([]), tools: registry })

    await expect(
      bridge.request('reader-bai.arxiv-source', 'search.arxiv.panel', 'tools.execute', {
        name: 'library.list',
        input: {}
      })
    ).rejects.toThrow('插件缺少权限：documents:read')
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects unknown views, methods, and oversized input', async () => {
    const { registry } = createTools()

    await expect(
      createPluginViewBridge({ host: createHost([], false), tools: registry }).request(
        'reader-bai.arxiv-source',
        'search.arxiv.panel',
        'tools.list',
        undefined
      )
    ).rejects.toThrow('插件视图不存在或未启用')

    const bridge = createPluginViewBridge({ host: createHost(), tools: registry })
    await expect(
      bridge.request('reader-bai.arxiv-source', 'search.arxiv.panel', 'fs.read', {})
    ).rejects.toThrow('不支持的插件视图请求')

    await expect(
      bridge.request('reader-bai.arxiv-source', 'search.arxiv.panel', 'tools.execute', {
        name: 'library.list',
        input: 'x'.repeat(100_001)
      })
    ).rejects.toThrow('工具参数过大')
  })
})
