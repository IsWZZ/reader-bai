// 论文元数据解析：PDF 开头几页 → AI 结构化抽取 → Crossref 校验补全。
// 依赖通过参数注入，方便单元测试；Key 仍只在主进程解密。

import { startRun } from './ai-run'
import type { AiRequester } from './ai-request'
import type { PaperMetadata } from './paper-metadata'
import {
  buildMetadataMessages,
  extractDoiFromText,
  mergePaperMetadata,
  parseMetadataResponse
} from './paper-metadata'
import type { StoredAiProfile } from './settings'
import type { SettingsStore } from './settings-store'

const REQUEST_TIMEOUT_MS = 90_000
const MAX_PAGES_TEXT = 12_000

export interface AnalyzablePaper {
  id: string
  path: string
  /** 用于没有 DOI 时在 Crossref 做标题检索；通常传论文标题或文件名 */
  title?: string
}

export interface PaperAnalyzerDeps {
  settings: Pick<SettingsStore, 'read' | 'decodeApiKey'>
  requester: Pick<AiRequester, 'chat'>
  /** 读取论文开头几页的纯文本 */
  readIntroText: (filePath: string) => Promise<string>
  /** Crossref 查询；失败时返回 null */
  lookup: (input: { doi?: string; title?: string }) => Promise<PaperMetadata | null>
  now?: () => number
}

export interface AnalyzePaperOptions {
  /** 是否使用 Crossref 校验补全，默认开启 */
  useWeb?: boolean
}

export interface PaperAnalyzer {
  analyze: (paper: AnalyzablePaper, options?: AnalyzePaperOptions) => Promise<PaperMetadata>
}

const resolveProfile = async (deps: PaperAnalyzerDeps): Promise<StoredAiProfile> => {
  const stored = await deps.settings.read()
  const active = stored.ai.profiles.find((item) => item.id === stored.ai.activeId)
  // 自动解析会跳过禁用配置；如果还有启用的配置就继续用
  const profile = active?.enabled ? active : stored.ai.profiles.find((item) => item.enabled)
  if (!profile) {
    if (stored.ai.profiles.length === 0) {
      throw new Error('请先在设置中配置 AI 服务，再解析论文信息')
    }
    throw new Error('所有 AI 配置都已禁用，请启用一个后再解析论文信息')
  }
  if (!profile.baseUrl || !profile.model) {
    throw new Error('请先补全 AI 服务的 Base URL、API Key 和模型')
  }
  if (!deps.settings.decodeApiKey(profile)) {
    throw new Error('请先补全 AI 服务的 Base URL、API Key 和模型')
  }
  return profile
}

let requestSequence = 0
const nextRequestId = (paperId: string): string => {
  requestSequence = (requestSequence + 1) % 0xffffff
  return `paper-metadata-${paperId.slice(0, 40)}-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const createPaperAnalyzer = (deps: PaperAnalyzerDeps): PaperAnalyzer => {
  const now = deps.now ?? Date.now
  // 同一篇论文只跑一次，避免重复点击或导入流程重复触发
  const inFlight = new Map<string, Promise<PaperMetadata>>()

  const run = async (
    paper: AnalyzablePaper,
    options: AnalyzePaperOptions
  ): Promise<PaperMetadata> => {
    // 先确认 AI 配置存在：没有配置时不做任何外发请求
    const profile = await resolveProfile(deps)

    let introText: string
    try {
      introText = (await deps.readIntroText(paper.path)).trim().slice(0, MAX_PAGES_TEXT)
    } catch (error) {
      throw new Error('读取论文文本失败，请确认 PDF 文件仍然存在', { cause: error })
    }
    if (!introText) throw new Error('无法从 PDF 中读取文本，可能是扫描版论文')

    const doiFromText = extractDoiFromText(introText)
    let aiMetadata: PaperMetadata | null = null
    let aiError: unknown = null

    const agentRun = startRun({ timeoutMs: REQUEST_TIMEOUT_MS, maxSteps: 1 })
    try {
      const result = await deps.requester.chat({
        requestId: nextRequestId(paper.id),
        profileId: profile.id,
        messages: buildMetadataMessages(introText),
        run: agentRun,
        onDelta: () => undefined
      })
      aiMetadata = parseMetadataResponse(result.text, now())
      if (!aiMetadata) aiError = new Error('AI 返回的内容无法解析为论文信息')
    } catch (error) {
      aiError = error
    } finally {
      agentRun.dispose()
    }

    let crossref: PaperMetadata | null = null
    if (options.useWeb !== false) {
      // DOI 优先用模型结果，模型没给就从原文里兜底提取；标题用于模糊检索
      const doi = aiMetadata?.doi ?? doiFromText
      const title = aiMetadata?.title ?? paper.title
      crossref = await deps.lookup({ doi, title }).catch(() => null)
    }

    const merged = mergePaperMetadata(aiMetadata, crossref, now())
    if (merged) return merged

    if (aiError) {
      throw new Error(`AI 解析失败：${errorMessage(aiError)}`, { cause: aiError })
    }
    throw new Error('未能从论文中提取出有效信息')
  }

  const analyze = (
    paper: AnalyzablePaper,
    options: AnalyzePaperOptions = {}
  ): Promise<PaperMetadata> => {
    const pending = inFlight.get(paper.id)
    if (pending) return pending

    const promise = run(paper, options).finally(() => {
      inFlight.delete(paper.id)
    })
    inFlight.set(paper.id, promise)
    return promise
  }

  return { analyze }
}
