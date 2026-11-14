/** 只依赖 Electron session 的缓存清理接口，方便单元测试直接传入假实现 */
export interface CacheSession {
  clearCache: () => Promise<void>
  clearCodeCaches: (options: { urls?: string[] }) => Promise<void>
  clearHostResolverCache: () => Promise<void>
}

/**
 * 清理 Chromium 的 HTTP 缓存、代码缓存和 DNS 缓存。
 * 不碰 Cookie、Local Storage、书库或设置文件，避免把用户数据当成缓存删掉。
 */
export const clearElectronCaches = async (session: CacheSession): Promise<void> => {
  await Promise.all([
    session.clearCache(),
    session.clearCodeCaches({}),
    session.clearHostResolverCache()
  ])
}
