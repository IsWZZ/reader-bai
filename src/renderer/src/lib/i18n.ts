import { readonly, ref } from 'vue'
import { en } from './locales/en'
import { zh } from './locales/zh'
import type { LocaleDefinition, MessageKey } from './locales/types'

/**
 * 语言注册表：增加语言时只需要新增一个 locale 文件并在这里追加一项。
 * 语言标签使用 BCP 47 风格（en、zh-Hans、pt-BR 等），设置文件只保存这个字符串。
 */
const LOCALES: LocaleDefinition[] = [
  { code: 'zh', label: '中文', messages: zh },
  { code: 'en', label: 'English', messages: en }
]

const definitions = new Map(
  LOCALES.map((definition) => [definition.code.toLowerCase(), definition])
)

export const DEFAULT_LOCALE = 'zh'

const localeRef = ref(DEFAULT_LOCALE)
/** 当前界面语言；t() 读取它会自动建立响应式依赖 */
export const locale = readonly(localeRef)

/** 供设置页渲染语言选项；标签使用各语言自己的写法 */
export const availableLocales = LOCALES.map(({ code, label }) => ({ code, label }))

/**
 * 把任意输入归一到已注册的语言：
 * - 精确匹配（en、zh-Hans）；
 * - 退到基础语言（en-US → en）；
 * - 无法识别时回到默认语言。
 */
export const normalizeLocale = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!raw) return DEFAULT_LOCALE
  const exact = definitions.get(raw)
  if (exact) return exact.code
  const base = raw.split('-')[0]
  return definitions.get(base)?.code ?? DEFAULT_LOCALE
}

const interpolate = (template: string, params?: Record<string, string | number>): string => {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  )
}

/** 读取当前语言的消息；缺失时回退到中文，再回退到键名 */
export const t = (key: MessageKey, params?: Record<string, string | number>): string => {
  const current = definitions.get(localeRef.value)
  const template = current?.messages[key] ?? zh[key] ?? key
  return interpolate(template, params)
}

/**
 * 切换界面语言并同步 <html lang>。
 * 只改变显示，不写设置；持久化由 settings store 负责。
 */
export const setLocale = (value: unknown): string => {
  const next = normalizeLocale(value)
  localeRef.value = next
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next
  }
  return next
}
