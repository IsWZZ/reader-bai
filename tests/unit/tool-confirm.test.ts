import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolContext, ToolInfo, ToolInvocation } from '../../src/main/tool-registry'

const electron = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  getFocusedWindow: vi.fn(),
  getAllWindows: vi.fn()
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: electron.getFocusedWindow,
    getAllWindows: electron.getAllWindows
  },
  dialog: { showMessageBox: electron.showMessageBox }
}))

import { confirmToolInvocation } from '../../src/main/ipc/tools'

const TOOL: ToolInfo = {
  name: 'library.list',
  title: '列出论文',
  description: '列出书库中的论文',
  inputSchema: { type: 'object' },
  risk: 'read',
  exposeToAi: true,
  requiredPermissions: []
}

const invocation = (input: unknown, pluginId?: string): ToolInvocation => {
  const context: ToolContext = { signal: new AbortController().signal }
  if (pluginId) context.pluginId = pluginId
  return { tool: TOOL, context, input }
}

const dialogOptions = (): Record<string, unknown> => {
  const call = electron.showMessageBox.mock.calls.at(-1) ?? []
  return (call.length > 1 ? call[1] : call[0]) as Record<string, unknown>
}

beforeEach(() => {
  electron.showMessageBox.mockReset()
  electron.getFocusedWindow.mockReset()
  electron.getAllWindows.mockReset()
  electron.getAllWindows.mockReturnValue([])
  electron.getFocusedWindow.mockReturnValue({ id: 1 })
})

describe('confirmToolInvocation', () => {
  it('allows the invocation only when the user confirms', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 1 })
    await expect(confirmToolInvocation(invocation({ query: 'x' }))).resolves.toBe(true)

    electron.showMessageBox.mockResolvedValue({ response: 0 })
    await expect(confirmToolInvocation(invocation({ query: 'x' }))).resolves.toBe(false)
  })

  it('describes the tool and parameters', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 0 })

    await confirmToolInvocation(invocation({ query: 'transformer' }, 'publisher.plugin'))

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
      message: '插件 publisher.plugin 请求执行：列出论文'
    })
    expect(options.detail).toBe('工具：library.list\n参数：{"query":"transformer"}')
  })

  it('identifies an unknown plugin id', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 0 })

    await confirmToolInvocation(invocation({ query: 'x' }))

    expect(dialogOptions().message).toBe('插件 未知 请求执行：列出论文')
  })

  it('summarizes missing, unserializable, and oversized parameters', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 0 })
    const circular: Record<string, unknown> = {}
    circular.self = circular

    await confirmToolInvocation(invocation(undefined))
    expect(dialogOptions().detail).toContain('参数：（无参数）')

    await confirmToolInvocation(invocation(circular))
    expect(dialogOptions().detail).toContain('参数：（无法展示参数）')

    await confirmToolInvocation(invocation('x'.repeat(600)))
    const detail = String(dialogOptions().detail)
    expect(detail).toContain(`参数："${'x'.repeat(499)}…`)
    expect(detail.length).toBe('工具：library.list\n参数：'.length + 501)
  })

  it('falls back to a dialog without a parent window', async () => {
    electron.getFocusedWindow.mockReturnValue(undefined)
    electron.showMessageBox.mockResolvedValue({ response: 0 })

    await confirmToolInvocation(invocation({ query: 'x' }))

    expect(electron.showMessageBox.mock.calls[0]).toHaveLength(1)
  })
})
