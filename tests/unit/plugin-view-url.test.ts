import { describe, expect, it } from 'vitest'
import { pluginViewUrl } from '@renderer/lib/plugin-view'

describe('renderer pluginViewUrl', () => {
  it('matches the main-process asset URL format', () => {
    expect(pluginViewUrl('reader-bai.arxiv', 'ui/index.html')).toBe(
      'reader-bai-plugin://reader-bai.arxiv/ui/index.html'
    )
    expect(pluginViewUrl('reader-bai.arxiv', 'ui/my page.html')).toBe(
      'reader-bai-plugin://reader-bai.arxiv/ui/my%20page.html'
    )
  })
})
