import { Languages } from 'lucide-vue-next'
import type { MessageKey } from '@renderer/lib/i18n'
import { translationModuleManifest } from '../manifest'
import TranslationPanel from './components/TranslationPanel.vue'

const contribution = translationModuleManifest.contributes.views[0]

/**
 * 翻译模块贡献给外壳的视图描述。
 * 外壳只消费 id / 文案键 / 图标 / 组件，不关心模块内部实现。
 */
export const translationView = {
  id: contribution.id,
  titleKey: contribution.titleKey satisfies MessageKey,
  closeLabelKey: contribution.closeLabelKey satisfies MessageKey,
  panelLabelKey: contribution.panelLabelKey satisfies MessageKey,
  activityLabelKey: contribution.activityLabelKey satisfies MessageKey,
  icon: Languages,
  component: TranslationPanel
}

export { useTranslationStore } from './store/translation'
