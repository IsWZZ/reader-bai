export const createId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

// Electron 会把主进程抛出的错误包装成 "Error invoking remote method '...': Error: ..."
export const cleanError = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error)) return fallback
  const message = error.message
    .replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '')
    .trim()
  return message || fallback
}
