import type { ChatMessage } from '@main/ai'

/** 翻译行为属于模块自身，放在翻译进程里，渲染进程只传选区原文。 */
export const TRANSLATION_SYSTEM_PROMPT =
  '你是学术论文翻译助手。请把用户提供的文本翻译成简体中文，保留术语与公式，只输出译文，不要解释。'

export const buildTranslationMessages = (source: string): ChatMessage[] => [
  { role: 'system', content: TRANSLATION_SYSTEM_PROMPT },
  { role: 'user', content: source }
]
