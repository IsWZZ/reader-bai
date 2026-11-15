---
paths:
  - "src/renderer/src/lib/locales/*.ts"
---

# 中英文语言包必须成对同步修改

`src/renderer/src/lib/locales/` 下每个语言包（当前为 `zh.ts` 和 `en.ts`）都是同一份消息键的不同语言版本。

- 只要修改了其中任意一个语言包，必须在**同一次修改**里同步更新其他所有语言包，不允许只改中文或只改英文。
- 新增消息键时，先在 `zh.ts` 添加（唯一消息源，`MessageKey` 由它推导），再补 `en.ts` 的对应译文。
- 删除、重命名消息键，或修改文案含义时，所有语言包一起改，保持键集合完全一致。
- 插值占位符必须逐字一致：`{name}`、`{query}`、`{max}` 等参数名和数量在两种语言里相同，不能漏写或改名。
- 一个语言包里不能残留另一种语言的原文；`en.ts` 必须使用英文译文，`zh.ts` 必须使用中文文案。
- 修改完成后运行 `npm run typecheck` 确认 `en.ts` 的 `satisfies LocaleMessages` 覆盖全部键，并运行 `npm test` 确认界面文案相关测试通过。
