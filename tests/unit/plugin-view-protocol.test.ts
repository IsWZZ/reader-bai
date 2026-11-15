// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { pluginContentType, pluginViewCsp, pluginViewUrl } from '../../src/main/plugins/view-assets'

describe('pluginViewUrl', () => {
  it('builds an encoded URL for a plugin entry', () => {
    expect(pluginViewUrl('reader-bai.arxiv', 'ui/my page.html')).toBe(
      'reader-bai-plugin://reader-bai.arxiv/ui/my%20page.html'
    )
    expect(pluginViewUrl('reader-bai.arxiv', 'ui\\index.html')).toBe(
      'reader-bai-plugin://reader-bai.arxiv/ui/index.html'
    )
  })
})

describe('pluginContentType', () => {
  it('serves known asset types and falls back to binary', () => {
    expect(pluginContentType('/x/ui/index.html')).toContain('text/html')
    expect(pluginContentType('/x/ui/app.js')).toContain('text/javascript')
    expect(pluginContentType('/x/ui/style.css')).toContain('text/css')
    expect(pluginContentType('/x/ui/icon.svg')).toBe('image/svg+xml')
    expect(pluginContentType('/x/ui/data.bin')).toBe('application/octet-stream')
  })
})

describe('pluginViewCsp', () => {
  it('blocks network access without the network permission', () => {
    const csp = pluginViewCsp(['documents:read'])
    expect(csp).toContain("connect-src 'none'")
    expect(csp).toContain('script-src reader-bai-plugin:')
    expect(csp).toContain("frame-src 'none'")
  })

  it('allows https and loopback requests with the network permission', () => {
    const csp = pluginViewCsp(['network'])
    expect(csp).toContain('connect-src https: http://localhost:* http://127.0.0.1:*')
    expect(csp).toContain('img-src reader-bai-plugin: data: https:')
  })
})
