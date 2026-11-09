import { ElectronAPI } from '@electron-toolkit/preload'

interface PaperInfo {
  id: string
  title: string
  path: string
}

interface Api {
  importPaper: () => Promise<PaperInfo | null>
  listPapers: () => Promise<PaperInfo[]>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api | undefined
  }
}
