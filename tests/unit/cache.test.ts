import { describe, expect, it, vi, type Mock } from 'vitest'
import { clearElectronCaches, type CacheSession } from '../../src/main/cache'

interface CacheSessionMock {
  clearCache: Mock<CacheSession['clearCache']>
  clearCodeCaches: Mock<CacheSession['clearCodeCaches']>
  clearHostResolverCache: Mock<CacheSession['clearHostResolverCache']>
}

const createSession = (): CacheSessionMock => ({
  clearCache: vi.fn(async () => {}),
  clearCodeCaches: vi.fn(async () => {}),
  clearHostResolverCache: vi.fn(async () => {})
})

describe('clearElectronCaches', () => {
  it('clears HTTP, code and host resolver caches', async () => {
    const session = createSession()

    await clearElectronCaches(session)

    expect(session.clearCache).toHaveBeenCalledOnce()
    expect(session.clearCodeCaches).toHaveBeenCalledWith({})
    expect(session.clearHostResolverCache).toHaveBeenCalledOnce()
  })

  it('rejects when a cache cannot be cleared', async () => {
    const session = createSession()
    session.clearCache.mockRejectedValueOnce(new Error('cache unavailable'))

    await expect(clearElectronCaches(session)).rejects.toThrow('cache unavailable')
  })
})
