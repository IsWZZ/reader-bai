import { t } from '@renderer/lib/i18n'
import type { AiProfile } from '@renderer/types'

/** 配置没有单独的显示名称：优先模型名，并附上主机名以区分同名模型 */
export const aiProfileLabel = (profile: AiProfile): string => {
  if (!profile.model) return profile.baseUrl || t('common.untitledProfile')
  try {
    const host = new URL(profile.baseUrl).host
    return host ? `${profile.model} · ${host}` : profile.model
  } catch {
    return profile.model
  }
}
