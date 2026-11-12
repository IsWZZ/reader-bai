import { afterEach, vi } from 'vitest'

// jsdom 缺少这些浏览器 API，组件（尤其 reka-ui）在挂载时会用到
class ResizeObserverMock {
  // jsdom 没有布局系统，观察器只需提供空实现
  observe(): void {
    /* noop */
  }
  unobserve(): void {
    /* noop */
  }
  disconnect(): void {
    /* noop */
  }
}

class IntersectionObserverMock {
  observe(): void {
    /* noop */
  }
  unobserve(): void {
    /* noop */
  }
  disconnect(): void {
    /* noop */
  }
  takeRecords(): [] {
    return []
  }
}

if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
}

if (!('IntersectionObserver' in globalThis)) {
  globalThis.IntersectionObserver =
    IntersectionObserverMock as unknown as typeof IntersectionObserver
}

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation(
    (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }) as unknown as MediaQueryList
  )
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn()
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.classList.remove('dark')
  document.documentElement.style.colorScheme = ''
})
