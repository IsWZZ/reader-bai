import { zh } from './zh'

/** 所有可用的消息键；新增键时只需补在 zh.ts */
export type MessageKey = keyof typeof zh

/** 每个语言包必须覆盖全部消息键，避免运行时缺词 */
export type LocaleMessages = Record<MessageKey, string>

export interface LocaleDefinition {
  /** BCP 47 风格的语言标签，与设置文件中的 language 字段一致 */
  code: string
  /** 语言在自身语言里的名称，例如“中文”“English” */
  label: string
  messages: LocaleMessages
}
