import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface ReaderInstance {
  app: ElectronApplication
  page: Page
}

const mainEntry = join(process.cwd(), 'out/main/index.js')

/**
 * 每个测试使用独立的 userData 目录，避免污染真实用户数据和相互串扰。
 * macOS 的 /var 是 /private/var 的符号链接，Electron 返回真实路径，先统一掉。
 * 预先创建 data 目录，测试可以在启动应用前直接播种 library/settings 等文件。
 */
export const createUserDataDir = async (): Promise<string> => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'reader-bai-e2e-')))
  await mkdir(join(dir, 'data'), { recursive: true })
  return dir
}

export const removeUserDataDir = (dir: string): Promise<void> =>
  rm(dir, { recursive: true, force: true })

export async function launchReader(userDataDir: string): Promise<ReaderInstance> {
  // 某些终端会设置 ELECTRON_RUN_AS_NODE=1，这会让 Electron 以 Node 模式启动
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }

  const args = [mainEntry, `--user-data-dir=${userDataDir}`]
  // Linux CI 容器里没有可用的 Chromium sandbox
  if (process.env.CI) args.push('--no-sandbox')

  const app = await electron.launch({ args, env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // 界面语言由设置决定，等待渲染进程加载完设置后再继续
  await page.getByRole('button', { name: /^(设置|Settings)$/ }).waitFor()
  return { app, page }
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}

/**
 * 生成一个最小但结构完整的单页 PDF，用于论文库和阅读器测试。
 * 对象偏移量按实际字节计算，确保 pdf.js 能正常解析。
 * 传入 metadataTitle 时会写入 /Info /Title，用于验证元数据标题回填。
 */
export async function writeSamplePdf(path: string, metadataTitle?: string): Promise<void> {
  const content = 'BT /F1 18 Tf 40 100 Td (Hello reader-bai) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  if (metadataTitle) {
    const escaped = metadataTitle.replace(/[\\()]/g, '\\$&')
    objects.push(`<< /Title (${escaped}) /Producer (reader-bai e2e) >>`)
  }

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`
  }
  const infoReference = metadataTitle ? ' /Info 6 0 R' : ''
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${infoReference} >>\nstartxref\n${xrefOffset}\n%%EOF\n`

  await writeFile(path, Buffer.from(pdf, 'latin1'))
}

export interface SeedSpace {
  id?: string
  name: string
  createdAt?: number
}

export interface SeedPaper {
  id?: string
  title: string
  path: string
  fileName?: string
  spaceId?: string | null
  titleSource?: 'file' | 'metadata' | 'user'
  createdAt?: number
}

/**
 * 直接把论文库写入 userData，省去每个用例重复手写 library.json 的样板代码。
 * 未提供的字段按主进程 normalizePaper 的默认规则补齐。
 */
export async function seedLibrary(
  userDataDir: string,
  state: { spaces?: SeedSpace[]; papers?: SeedPaper[] }
): Promise<void> {
  const spaces = (state.spaces ?? []).map((space, index) => ({
    id: space.id ?? `space-${index + 1}`,
    name: space.name,
    createdAt: space.createdAt ?? Date.now()
  }))
  const papers = (state.papers ?? []).map((paper, index) => ({
    id: paper.id ?? `paper-${index + 1}`,
    title: paper.title,
    path: paper.path,
    fileName: paper.fileName ?? paper.path.replace(/\\/g, '/').split('/').pop() ?? '',
    spaceId: paper.spaceId ?? null,
    titleSource: paper.titleSource ?? 'user',
    createdAt: paper.createdAt ?? Date.now()
  }))
  await writeFile(
    join(userDataDir, 'data', 'library.json'),
    JSON.stringify({ spaces, papers }, null, 2),
    'utf8'
  )
}

/** 选中论文并等待第一页渲染完成。 */
export async function openPaper(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: title, exact: true }).click()
  await expect(page.locator('[data-page="1"] canvas')).toBeVisible()
}

/** 替换主进程的原生打开文件对话框；传入 null 表示用户取消。 */
export async function stubOpenDialog(
  app: ElectronApplication,
  filePath: string | null
): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () =>
      target ? { canceled: false, filePaths: [target] } : { canceled: true, filePaths: [] }
  }, filePath)
}

/** 替换主进程的原生目录选择对话框；传入 null 表示用户取消。 */
export async function stubOpenDirectoryDialog(
  app: ElectronApplication,
  directory: string | null
): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () =>
      target ? { canceled: false, filePaths: [target] } : { canceled: true, filePaths: [] }
  }, directory)
}

/** 替换主进程的工具确认对话框；response 0 表示取消，1 表示允许。 */
export async function stubMessageBox(app: ElectronApplication, response: number): Promise<void> {
  await app.evaluate(({ dialog }, index) => {
    dialog.showMessageBox = (async () => ({
      response: index,
      checkboxChecked: false
    })) as unknown as typeof dialog.showMessageBox
  }, response)
}
