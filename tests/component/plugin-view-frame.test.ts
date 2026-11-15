import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PluginViewFrame from '@renderer/components/PluginViewFrame.vue'
import type { PluginViewInfo } from '@renderer/types'

const pluginViewRequest = vi.fn()

const VIEW: PluginViewInfo = {
  id: 'search.arxiv.panel',
  title: 'arXiv 面板',
  location: 'sidebar',
  entry: 'ui/index.html'
}

const mountFrame = (): VueWrapper =>
  mount(PluginViewFrame, {
    attachTo: document.body,
    props: {
      pluginId: 'reader-bai.arxiv',
      pluginName: 'arXiv',
      view: VIEW
    }
  })

const frameWindow = (wrapper: VueWrapper): Window =>
  (wrapper.get('iframe').element as HTMLIFrameElement).contentWindow as Window

beforeEach(() => {
  pluginViewRequest.mockReset()
  window.api = { pluginViewRequest } as unknown as Api
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('PluginViewFrame', () => {
  it('loads the view through the plugin protocol and sends init on load', async () => {
    const wrapper = mountFrame()
    const frame = wrapper.get('iframe')

    expect(frame.attributes('src')).toBe('reader-bai-plugin://reader-bai.arxiv/ui/index.html')
    expect(frame.attributes('sandbox')).toBe('allow-scripts')

    const post = vi.spyOn(frameWindow(wrapper), 'postMessage')
    await frame.trigger('load')

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reader-bai:init',
        pluginId: 'reader-bai.arxiv',
        viewId: 'search.arxiv.panel'
      }),
      '*'
    )
    wrapper.unmount()
  })

  it('forwards validated tool requests and sends the result back', async () => {
    pluginViewRequest.mockResolvedValue([{ name: 'library.list' }])
    const wrapper = mountFrame()
    const post = vi.spyOn(frameWindow(wrapper), 'postMessage')

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'reader-bai:request', requestId: 'r1', method: 'tools.list' },
        source: frameWindow(wrapper)
      })
    )
    await flushPromises()

    expect(pluginViewRequest).toHaveBeenCalledWith(
      'reader-bai.arxiv',
      'search.arxiv.panel',
      'tools.list',
      undefined
    )
    expect(post).toHaveBeenCalledWith(
      {
        type: 'reader-bai:response',
        requestId: 'r1',
        ok: true,
        result: [{ name: 'library.list' }]
      },
      '*'
    )
    wrapper.unmount()
  })

  it('returns readable errors and ignores messages from other windows', async () => {
    pluginViewRequest.mockRejectedValue(new Error('插件缺少权限：documents:read'))
    const wrapper = mountFrame()
    const post = vi.spyOn(frameWindow(wrapper), 'postMessage')

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'reader-bai:request', requestId: 'r1', method: 'tools.execute' },
        source: frameWindow(wrapper)
      })
    )
    await flushPromises()

    expect(post).toHaveBeenCalledWith(
      {
        type: 'reader-bai:response',
        requestId: 'r1',
        ok: false,
        error: '插件缺少权限：documents:read'
      },
      '*'
    )

    post.mockClear()
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'reader-bai:request', requestId: 'r2', method: 'tools.list' },
        source: window
      })
    )
    await flushPromises()
    expect(post).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('emits close from the header button', async () => {
    const wrapper = mountFrame()

    await wrapper.get('button[aria-label="关闭插件面板"]').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
})
