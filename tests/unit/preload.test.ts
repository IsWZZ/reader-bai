import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    send: electron.send,
    on: electron.on,
    removeListener: electron.removeListener
  }
}))

let api: Api

beforeAll(async () => {
  await import('../../src/preload/index')
  const [name, exposed] = electron.exposeInMainWorld.mock.calls[0] as unknown as [string, Api]
  expect(name).toBe('api')
  api = exposed
})

beforeEach(() => {
  electron.invoke.mockReset()
  electron.invoke.mockResolvedValue(undefined)
  electron.send.mockReset()
  electron.on.mockReset()
  electron.removeListener.mockReset()
})

describe('preload bridge', () => {
  it('exposes only the documented API surface', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'abortChat',
        'addAnnotation',
        'analyzePaper',
        'cancelAgent',
        'chat',
        'chooseDirectory',
        'clearCache',
        'createSpace',
        'deleteSpace',
        'executeTool',
        'getPluginRuntime',
        'getSettings',
        'importPaper',
        'listAnnotations',
        'listPapers',
        'listPlugins',
        'listTools',
        'movePaper',
        'onAgentEvent',
        'onAiChunk',
        'onPluginRuntime',
        'readPaper',
        'removeAnnotations',
        'removePaper',
        'renamePaper',
        'renameSpace',
        'setPluginEnabled',
        'startAgent',
        'uninstallApp',
        'updateSettings'
      ].sort()
    )
    expect(api).not.toHaveProperty('ipcRenderer')
    expect(api).not.toHaveProperty('require')
  })

  it('forwards library and annotation calls to their channels', async () => {
    const annotation = {
      id: 'a1',
      type: 'highlight' as const,
      color: '#ffeb3b',
      page: 1,
      rects: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.02 }],
      text: 'attention',
      createdAt: 1
    }

    await api.importPaper()
    expect(electron.invoke).toHaveBeenLastCalledWith('dialog:importPaper', null)

    await api.importPaper('space-1')
    expect(electron.invoke).toHaveBeenLastCalledWith('dialog:importPaper', 'space-1')

    await api.chooseDirectory()
    expect(electron.invoke).toHaveBeenLastCalledWith('dialog:chooseDirectory')

    await api.listPapers()
    expect(electron.invoke).toHaveBeenLastCalledWith('library:list')

    await api.createSpace('Reading')
    expect(electron.invoke).toHaveBeenLastCalledWith('library:createSpace', 'Reading')

    await api.renameSpace('s1', 'Papers')
    expect(electron.invoke).toHaveBeenLastCalledWith('library:renameSpace', 's1', 'Papers')

    await api.deleteSpace('s1')
    expect(electron.invoke).toHaveBeenLastCalledWith('library:deleteSpace', 's1')

    await api.renamePaper('p1', 'Title', 'user')
    expect(electron.invoke).toHaveBeenLastCalledWith('library:renamePaper', 'p1', 'Title', 'user')

    await api.movePaper('p1', null)
    expect(electron.invoke).toHaveBeenLastCalledWith('library:movePaper', 'p1', null)

    await api.analyzePaper('p1', { useWeb: false })
    expect(electron.invoke).toHaveBeenLastCalledWith('library:analyzePaper', 'p1', {
      useWeb: false
    })

    await api.removePaper('p1')
    expect(electron.invoke).toHaveBeenLastCalledWith('library:removePaper', 'p1')

    await api.readPaper('/papers/a.pdf')
    expect(electron.invoke).toHaveBeenLastCalledWith('paper:read', '/papers/a.pdf')

    await api.listAnnotations('/papers/a.pdf')
    expect(electron.invoke).toHaveBeenLastCalledWith('annotations:list', '/papers/a.pdf')

    await api.addAnnotation('/papers/a.pdf', annotation)
    expect(electron.invoke).toHaveBeenLastCalledWith('annotations:add', '/papers/a.pdf', annotation)

    await api.removeAnnotations('/papers/a.pdf', ['a1'])
    expect(electron.invoke).toHaveBeenLastCalledWith('annotations:remove', '/papers/a.pdf', ['a1'])
  })

  it('forwards settings, AI, agent, tool and plugin calls', async () => {
    electron.invoke.mockResolvedValue('reply')

    await expect(api.chat('r1', [{ role: 'user', content: 'hi' }], 'profile-1')).resolves.toBe(
      'reply'
    )
    expect(electron.invoke).toHaveBeenLastCalledWith(
      'ai:chat',
      'r1',
      [{ role: 'user', content: 'hi' }],
      'profile-1'
    )

    const startRequest = {
      messages: [{ role: 'user' as const, content: 'hi' }],
      profileId: 'profile-1',
      mode: 'agent' as const
    }
    await api.startAgent(startRequest)
    expect(electron.invoke).toHaveBeenLastCalledWith('agent:start', startRequest)

    await api.cancelAgent('session-1')
    expect(electron.invoke).toHaveBeenLastCalledWith('agent:cancel', 'session-1')

    await api.getSettings()
    expect(electron.invoke).toHaveBeenLastCalledWith('settings:get')

    await api.updateSettings({ theme: 'dark' })
    expect(electron.invoke).toHaveBeenLastCalledWith('settings:update', { theme: 'dark' })

    await api.clearCache()
    expect(electron.invoke).toHaveBeenLastCalledWith('cache:clear')

    await api.uninstallApp()
    expect(electron.invoke).toHaveBeenLastCalledWith('app:uninstall')

    api.abortChat('r3')
    expect(electron.send).toHaveBeenCalledWith('ai:abort', 'r3')

    await api.listTools()
    expect(electron.invoke).toHaveBeenLastCalledWith('tools:list')

    await api.executeTool('library.list', { query: 'attention' })
    expect(electron.invoke).toHaveBeenLastCalledWith('tools:execute', 'library.list', {
      query: 'attention'
    })

    await api.listPlugins()
    expect(electron.invoke).toHaveBeenLastCalledWith('plugins:list')

    await api.setPluginEnabled('publisher.plugin', true)
    expect(electron.invoke).toHaveBeenLastCalledWith('plugins:setEnabled', 'publisher.plugin', true)

    await api.getPluginRuntime()
    expect(electron.invoke).toHaveBeenLastCalledWith('plugins:runtime')
  })

  it('subscribes and removes only its own listener', () => {
    const onChunk = vi.fn()
    const offChunk = api.onAiChunk(onChunk)

    expect(electron.on).toHaveBeenCalledWith('ai:chunk', expect.any(Function))
    const [, chunkListener] = electron.on.mock.calls[0] as unknown as [
      string,
      (event: unknown, payload: unknown) => void
    ]
    chunkListener({}, { requestId: 'r1', delta: '你' })
    expect(onChunk).toHaveBeenCalledWith({ requestId: 'r1', delta: '你' })

    offChunk()
    expect(electron.removeListener).toHaveBeenCalledWith('ai:chunk', chunkListener)
  })

  it('subscribes and removes the agent event listener', () => {
    const onEvent = vi.fn()
    const offEvent = api.onAgentEvent(onEvent)

    expect(electron.on).toHaveBeenCalledWith('agent:event', expect.any(Function))
    const [, agentListener] = electron.on.mock.calls[0] as unknown as [
      string,
      (event: unknown, payload: unknown) => void
    ]
    const payload = {
      sessionId: 'session-1',
      event: { type: 'chunk' as const, delta: '你' }
    }
    agentListener({}, payload)
    expect(onEvent).toHaveBeenCalledWith(payload)

    offEvent()
    expect(electron.removeListener).toHaveBeenCalledWith('agent:event', agentListener)
  })

  it('subscribes and removes the plugin runtime listener', () => {
    const onRuntime = vi.fn()
    const offRuntime = api.onPluginRuntime(onRuntime)

    expect(electron.on).toHaveBeenCalledWith('plugins:runtime-changed', expect.any(Function))
    const [, runtimeListener] = electron.on.mock.calls[0] as unknown as [
      string,
      (event: unknown, states: unknown) => void
    ]
    const states = [{ pluginId: 'publisher.plugin', status: 'active' as const }]
    runtimeListener({}, states)
    expect(onRuntime).toHaveBeenCalledWith(states)

    offRuntime()
    expect(electron.removeListener).toHaveBeenCalledWith('plugins:runtime-changed', runtimeListener)
  })
})
