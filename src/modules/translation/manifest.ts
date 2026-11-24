/**
 * B 层内置模块的简化 manifest。
 * 它模仿 C 层插件的 contributes 结构，但不进入 manifest 校验、权限或 sandbox；
 * 模块随应用分发，始终可用，暂不提供启停。
 */
export const translationModuleManifest = {
  id: 'reader-bai.translation',
  name: '翻译',
  version: '1.0.0',
  kind: 'builtin',
  contributes: {
    views: [
      {
        id: 'translation',
        location: 'sidebar',
        titleKey: 'translation.title',
        closeLabelKey: 'translation.close',
        panelLabelKey: 'translation.panel',
        activityLabelKey: 'activity.translation'
      }
    ]
  }
} as const
