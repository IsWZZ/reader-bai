import { beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  type ToolContext,
  type ToolInfo,
  type ToolInvocation,
  type ToolRegistry,
  type ToolSource
} from '../../src/main/tool-registry'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  showMessageBox: vi.fn(),
  getFocusedWindow: vi.fn(),
  getAllWindows: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: electron.getFocusedWindow,
    getAllWindows: electron.getAllWindows
  },
  dialog: { showMessageBox: electron.showMessageBox },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      electron.handlers.set(channel, handler)
    }
  }
}))

let confirmToolInvocation: typeof import('../../src/main/ipc/tools').confirmToolInvocation
let registerToolsIpc: typeof import('../../src/main/ipc/tools').registerToolsIpc

beforeAll(async () => {
  ;({ confirmToolInvocation, registerToolsIpc } = await import('../../src/main/ipc/tools'))
})

const TOOL: ToolInfo = {
  name: 'library.list',
  title: '列出论文',
  description: '列出书库中的论文',
  inputSchema: { type: 'object' },
  risk: 'read',
  exposeToAi: true,
  requiredPermissions: []
}

interface FakeRegistry {
  registry: ToolRegistry
  execute: Mock<ToolRegistry['execute']>
  list: Mock<ToolRegistry['list']>
}

const createRegistry = (): FakeRegistry => {
  const execute = vi.fn<ToolRegistry['execute']>(async () => ({ content: 'ok' }))
  const list = vi.fn<ToolRegistry['list']>(() => [TOOL])
  return { registry: { execute, list } as unknown as ToolRegistry, execute, list }
}

type ListHandler = () => ToolInfo[]
type ExecuteHandler = (event: unknown, name: unknown, input: unknown) => Promise<unknown>

const listHandler = (): ListHandler => electron.handlers.get('tools:list') as ListHandler
const executeHandler = (): ExecuteHandler =>
  electron.handlers.get('tools:execute') as ExecuteHandler

const invocation = (source: ToolSource, input: unknown, pluginId?: string): ToolInvocation => {
  const context: ToolContext = { source, signal: new AbortController().signal }
  if (pluginId) context.pluginId = pluginId
  return { tool: TOOL, context, input }
}

const dialogOptions = (): Record<string, unknown> => {
  const call = electron.showMessageBox.mock.calls.at(-1) ?? []
  return (call.length > 1 ? call[1] : call[0]) as Record<string, unknown>
}

beforeEach(() => {
  electron.handlers.clear()
  electron.showMessageBox.mockReset()
  electron.getFocusedWindow.mockReset()
  electron.getAllWindows.mockReset()
  electron.getAllWindows.mockReturnValue([])
  electron.getFocusedWindow.mockReturnValue({ id: 1 })
})

describe('tools:list', () => {
  it('returns the tools registered by the platform', () => {
    const { registry, list } = createRegistry()
    registerToolsIpc(registry)

    expect(listHandler()()).toEqual([TOOL])
    expect(list).toHaveBeenCalledOnce()
  })
})

describe('tools:execute', () => {
  it('forwards valid calls with an AI context', async () => {
    const { registry, execute } = createRegistry()
    registerToolsIpc(registry)
    const input = { query: 'attention' }

    await expect(executeHandler()({}, 'library.list', input)).resolves.toEqual({ content: 'ok' })

    expect(execute).toHaveBeenCalledOnce()
    const [name, passed, context] = execute.mock.calls[0]
    expect(name).toBe('library.list')
    expect(passed).toBe(input)
    expect(context.source).toBe('ai')
    expect(context.signal).toBeInstanceOf(AbortSignal)
  })

  it('passes undefined input through untouched', async () => {
    const { registry, execute } = createRegistry()
    registerToolsIpc(registry)

    await executeHandler()({}, 'library.list', undefined)

    expect(execute.mock.calls[0][1]).toBeUndefined()
  })

  it('rejects invalid tool names before touching the registry', async () => {
    const { registry, execute } = createRegistry()
    registerToolsIpc(registry)
    const handler = executeHandler()

    await expect(handler({}, 42, null)).rejects.toThrow('工具名称不正确')
    await expect(handler({}, '', null)).rejects.toThrow('工具名称不正确')
    await expect(handler({}, 'x'.repeat(101), null)).rejects.toThrow('工具名称不正确')
    expect(execute).not.toHaveBeenCalled()
  })

  it('accepts tool names at the maximum length', async () => {
    const { registry, execute } = createRegistry()
    registerToolsIpc(registry)

    await executeHandler()({}, 'x'.repeat(100), null)

    expect(execute).toHaveBeenCalledOnce()
  })

  it('rejects input that cannot be serialized', async () => {
    const { registry, execute } = createRegistry()
    registerToolsIpc(registry)
    const circular: Record<string, unknown> = {}
    circular.self = circular

    await expect(executeHandler()({}, 'library.list', circular)).rejects.toThrow(
      '工具参数格式不正确'
    )
    await expect(executeHandler()({}, 'library.list', { count: 1n })).rejects.toThrow(
      '工具参数格式不正确'
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('accepts input at the size limit and rejects one character more', async () => {
    const { registry, execute } = createRegistry()
    registerToolsIpc(registry)
    const handler = executeHandler()

    await handler({}, 'library.list', 'x'.repeat(99_998))
    expect(execute).toHaveBeenCalledOnce()

    await expect(handler({}, 'library.list', 'x'.repeat(99_999))).rejects.toThrow('工具参数过大')
    expect(execute).toHaveBeenCalledOnce()
  })

  it('propagates registry failures', async () => {
    const { registry, execute } = createRegistry()
    execute.mockRejectedValueOnce(new Error('工具不存在：library.list'))
    registerToolsIpc(registry)

    await expect(executeHandler()({}, 'library.list', null)).rejects.toThrow(
      '工具不存在：library.list'
    )
  })
})

describe('confirmToolInvocation', () => {
  it('allows the invocation only when the user confirms', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 1 })
    await expect(confirmToolInvocation(invocation('ai', { query: 'x' }))).resolves.toBe(true)

    electron.showMessageBox.mockResolvedValue({ response: 0 })
    await expect(confirmToolInvocation(invocation('ai', { query: 'x' }))).resolves.toBe(false)
  })

  it('describes the requester, tool, and parameters', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 0 })

    await confirmToolInvocation(invocation('ai', { query: 'transformer' }))

    const [target, options] = electron.showMessageBox.mock.calls[0] as [
      unknown,
      Record<string, unknown>
    ]
    expect(target).toEqual({ id: 1 })
    expect(options).toMatchObject({
      type: 'warning',
      buttons: ['取消', '允许'],
      defaultId: 0,
      cancelId: 0,
      title: '需要确认',
      message: 'AI 请求执行：列出论文'
    })
    expect(options.detail).toBe('工具：library.list\n参数：{"query":"transformer"}')
  })

  it('identifies plugin requests, including an unknown plugin id', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 0 })

    await confirmToolInvocation(invocation('plugin', { query: 'x' }, 'publisher.plugin'))
    expect(dialogOptions().message).toBe('插件 publisher.plugin 请求执行：列出论文')

    await confirmToolInvocation(invocation('plugin', { query: 'x' }))
    expect(dialogOptions().message).toBe('插件 未知 请求执行：列出论文')
  })

  it('summarizes missing, unserializable, and oversized parameters', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 0 })
    const circular: Record<string, unknown> = {}
    circular.self = circular

    await confirmToolInvocation(invocation('ai', undefined))
    expect(dialogOptions().detail).toContain('参数：（无参数）')

    await confirmToolInvocation(invocation('ai', circular))
    expect(dialogOptions().detail).toContain('参数：（无法展示参数）')

    await confirmToolInvocation(invocation('ai', 'x'.repeat(600)))
    const detail = String(dialogOptions().detail)
    expect(detail).toContain(`参数："${'x'.repeat(499)}…`)
    expect(detail.length).toBe('工具：library.list\n参数：'.length + 501)
  })

  it('falls back to a dialog without a parent window', async () => {
    electron.getFocusedWindow.mockReturnValue(undefined)
    electron.showMessageBox.mockResolvedValue({ response: 0 })

    await confirmToolInvocation(invocation('ai', { query: 'x' }))

    expect(electron.showMessageBox.mock.calls[0]).toHaveLength(1)
  })
})
