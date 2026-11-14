import { describe, expect, it, vi } from 'vitest'
import {
  createToolRegistry,
  toChatToolDefinition,
  type ToolContext,
  type ToolDefinition
} from '../../src/main/tool-registry'

const context = (source: ToolContext['source'] = 'ai'): ToolContext => ({
  source,
  signal: new AbortController().signal
})

const searchTool = (): ToolDefinition<{ query: string }> => ({
  name: 'library.search',
  title: '搜索论文',
  description: '按标题搜索论文',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query']
  },
  risk: 'read',
  exposeToAi: true,
  validate: (input: unknown) => {
    if (
      !input ||
      typeof input !== 'object' ||
      typeof (input as { query?: unknown }).query !== 'string'
    ) {
      throw new Error('参数不正确')
    }
    return input as { query: string }
  },
  execute: async (input) => ({ content: `found:${input.query}` })
})

describe('tool registry', () => {
  it('registers, lists and reads tools', () => {
    const registry = createToolRegistry()
    registry.register(searchTool())

    expect(registry.list()).toEqual([
      {
        name: 'library.search',
        title: '搜索论文',
        description: '按标题搜索论文',
        inputSchema: searchTool().inputSchema,
        risk: 'read',
        exposeToAi: true
      }
    ])
    expect(registry.get('library.search')?.title).toBe('搜索论文')
    expect(registry.get('missing')).toBeUndefined()
  })

  it('rejects empty and duplicate tool names', () => {
    const registry = createToolRegistry()
    registry.register(searchTool())

    expect(() => registry.register({ ...searchTool(), name: ' ' })).toThrow('工具名称不能为空')
    expect(() => registry.register(searchTool())).toThrow('工具已注册：library.search')
  })

  it('filters tools exposed to AI', () => {
    const registry = createToolRegistry()
    registry.register(searchTool())
    registry.register({ ...searchTool(), name: 'internal.cleanup', exposeToAi: false })

    expect(registry.list({ forAi: true }).map((tool) => tool.name)).toEqual(['library.search'])
    expect(registry.list()).toHaveLength(2)
  })

  it('validates and executes a tool', async () => {
    const execute = vi.fn(async (input: { query: string }) => ({ content: `found:${input.query}` }))
    const onInvoke = vi.fn()
    const registry = createToolRegistry({ onInvoke })
    registry.register({ ...searchTool(), execute })

    await expect(
      registry.execute('library.search', { query: 'attention' }, context())
    ).resolves.toEqual({ content: 'found:attention' })
    expect(execute).toHaveBeenCalledWith(
      { query: 'attention' },
      expect.objectContaining({ source: 'ai' })
    )
    expect(onInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ tool: expect.objectContaining({ name: 'library.search' }) }),
      { content: 'found:attention' },
      undefined
    )
  })

  it('rejects unknown tools and invalid arguments', async () => {
    const onInvoke = vi.fn()
    const registry = createToolRegistry({ onInvoke })
    registry.register(searchTool())

    await expect(registry.execute('missing.tool', {}, context())).rejects.toThrow('工具不存在')
    await expect(registry.execute('library.search', {}, context())).rejects.toThrow('参数不正确')
    expect(onInvoke).toHaveBeenCalledTimes(1)
  })

  it('does not expose private tools to AI', async () => {
    const registry = createToolRegistry()
    registry.register({ ...searchTool(), exposeToAi: false })

    await expect(registry.execute('library.search', { query: 'x' }, context('ai'))).rejects.toThrow(
      '工具未对 AI 开放'
    )
    await expect(
      registry.execute('library.search', { query: 'x' }, context('ui'))
    ).resolves.toEqual({
      content: 'found:x'
    })
  })

  it('honors the authorize hook', async () => {
    const onInvoke = vi.fn()
    const registry = createToolRegistry({ authorize: () => false, onInvoke })
    registry.register(searchTool())

    await expect(registry.execute('library.search', { query: 'x' }, context())).rejects.toThrow(
      '没有权限执行该工具'
    )
    expect(onInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ tool: expect.objectContaining({ name: 'library.search' }) }),
      undefined,
      expect.any(Error)
    )
  })

  it('converts a tool to the chat tool definition', () => {
    const registry = createToolRegistry()
    registry.register(searchTool())

    expect(toChatToolDefinition(registry.list()[0])).toEqual({
      type: 'function',
      function: {
        name: 'library.search',
        description: '按标题搜索论文',
        parameters: searchTool().inputSchema
      }
    })
  })
})
