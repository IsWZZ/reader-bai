# src/renderer/CLAUDE.md

渲染进程指引。仓库级规则见 [根 CLAUDE.md](../../CLAUDE.md)，阅读器细节见 [docs/pdf-viewer.md](../../docs/pdf-viewer.md)；这里只补充 Vue 渲染进程内部约定。

## 基本边界

- 渲染进程不碰 Node、文件系统或 `ipcRenderer`；所有平台能力只通过 `window.api`。
- `window.api` 可能为 `undefined`（测试环境或 preload 未加载），新代码先判空并优雅降级。
- 不直接 `fetch` 外部服务，不持有 API Key；AI、检索和下载统一走主进程。
- 类型：共享 API 类型在 [src/preload/index.d.ts](../preload/index.d.ts)，渲染侧副本在 [types.ts](src/types.ts)；引入应用数据新类型时两处同步。
- 传给主进程的数据先转成普通对象（剥离 Vue 代理），不要直接发送 reactive/ref 对象。

## 目录结构

```text
src/renderer/src/
  App.vue / main.ts / router/
  views/Home.vue               # 外壳：布局、面板编排
  components/                  # ActivityBar、LibraryPanel、PdfViewer、AssistantPanel、
                               # SettingsDialog、PluginSettings、PluginViewFrame、Toolbar
  components/ui/               # shadcn-vue 生成代码
  store/                       # assistant、settings、plugins
  lib/                         # ai、pdf、i18n
  lib/locales/                 # zh.ts 消息源与 en.ts 译文
  types.ts
  assets/css/                  # reset.css 设计 token、index.css、common.css
```

- `Home.vue` 只做外壳和面板编排；`PdfViewer.vue` 只负责阅读/选词/标注。
- 阅读区多标签：`PaperTabs.vue` + [store/reading.ts](src/store/reading.ts) 保留最近打开的论文（上限 `MAX_OPEN_PAPERS`）。每个 `PdfViewer` 必须放在 `TabsContent` 的 `force-mount` 面板里，切换标签时保持挂载；不要改成 `v-if` 条件渲染，否则滚动位置和缩放会丢失。
- 书库检索：输入框在 `Toolbar.vue`，`Home.vue` 持有查询词并传给 `LibraryPanel.vue`，只按已加载的标题/文件名和 `paper.metadata`（作者、期刊、DOI、关键词等）过滤；不要为此新增 IPC 或解析 PDF 全文（全文索引属于 B 层知识库）。
- 论文元数据：导入后由 `LibraryPanel.vue` 调 `window.api.analyzePaper(paperId)`，主进程负责读 PDF、调 AI 和 Crossref；渲染进程不解析全文、不发外部请求。`settings.library.autoAnalyze` 和 AI 配置共同决定是否自动解析，未配置 AI 时静默跳过。解析结果写入 `paper.metadata`，详情由 `PaperMetadataDialog.vue` 展示。AI 没解析出的字段可以在同一弹窗里手动编辑，保存走 `window.api.updatePaperMetadata(paperId, input)`，校验仍在主进程；用户手动改过的字段在重新解析时不会被覆盖。
- 新功能做成独立组件 + store，通过 props/事件与外壳通信；不要塞进 `Home.vue` 或 `PdfViewer.vue`。
- 功能之间不互相 import store；需要共享时用平台 API、事件或独立 lib。
- Pinia 使用 setup store；异步操作自己维护 `loading` / `error`，组件卸载或面板关闭时解除监听和计时器。

## 平台 API

- 使用 `window.api` 上的窄方法，不要拼通用 IPC；新增能力先补主进程和 preload，再改这里。
- 流式 AI：通过 `onAiChunk` 订阅增量并保存返回的取消函数；切换对话或卸载时调用取消函数，避免串流。
- 对话与工具：调 `startAgent({ messages, profileId, mode })` 启动会话，通过 `onAgentEvent` 订阅 `chunk` / `tool-call` / `tool-result` / `tool-error` / `done` / `error`；停止调 `cancelAgent(sessionId)`。
  - 渲染进程不执行 agent loop，也不决定步数、超时和工具白名单，这些都在主进程。
  - 写操作确认由主进程负责，渲染进程不要自己弹确认框。
- 设置：AI 配置只拿到 `hasApiKey`；编辑时 Key 留空表示保留原 Key，不要尝试读取或回填 Key。
- 插件：只使用 `listPlugins` / `getPluginRuntime` / `setPluginEnabled` / `onPluginRuntime`；插件代码不在渲染进程执行。

## AI 面板与 agent loop

- `AssistantPanel.vue` + [store/assistant.ts](src/store/assistant.ts) 负责翻译和对话；翻译和对话是两条独立请求，不要混用状态。
- 选词翻译只在面板打开时发起：`Home.vue` 用 `setAutoTranslate` 同步面板状态，关闭时 `handleSelection` 只记住最新选区，打开后再翻译；切换论文要清空待翻译选区。
- 第一方 agent loop 在独立的 `agent-host` utilityProcess（[src/main/agent/](../../src/main/agent/)），渲染进程只发会话事件：
  - 只传消息、`profileId` 和 `mode`；步数、超时、工具白名单和 Key 都由主进程决定。
  - `chat` 模式只有 1 步，`agent` 模式最多 6 步，且只开放 `risk === 'read'` 且 `exposeToAi` 的工具。
  - 工具错误作为 `tool` 消息回给模型，不中断整个对话。
  - 记录 `tool-call` / `tool-error` 供面板展示，不要伪造工具结果。
- 用户停止对话时调 `cancelAgent(sessionId)`；会话 id 返回前就停止时，要在拿到 id 后补一次取消。
- 模型、Base URL、Key 都来自设置；没有完整配置时提示用户，不要发起请求。

## UI 与样式

- 所有组件使用 Vue 3 + TypeScript + `<script setup lang="ts">`；新逻辑优先 Composition API。
- 样式用 Tailwind v4 工具类和 [reset.css](src/assets/css/reset.css) 的设计 token：
  - 不新增自定义 CSS 或大段内联样式。
  - 动态类名写完整字符串，保证 Tailwind 能扫描到。
  - 条件类名用 `cn` 合并。
- 先复用 `components/ui/**`；缺组件时用 shadcn-vue CLI 按 `components.json` 添加（`npx shadcn-vue@latest add <component>`），生成代码少改。
- 业务图标用 `lucide-vue-next`；`components/ui/**` 里的 `@lucide/vue` 保持不动。
- 纯图标按钮必须有 `aria-label`；表单控件保留可访问名称，组件和 E2E 测试依赖 role/label 定位。
- 状态和工具优先用 Pinia、Vue Router、`@vueuse/core` 的现成能力；能不加依赖就不加。

## PDF 阅读器

改动 `PdfViewer.vue` 或 `lib/pdf.ts` 前先读 [docs/pdf-viewer.md](../../docs/pdf-viewer.md)。

- worker 保持内联（`?worker&inline`）。
- 渲染保留 generation 守卫和任务取消，避免旧页面覆盖新页面。
- 选择和标注仅支持单页；标注坐标使用相对页面的归一化 `0..1`。
- 不移动 `document` 上的选择监听，也不改单击/双击语义。
- `lib/pdf.ts` 管 worker 和元数据；不要在组件里重复初始化 pdfjs。

## 设置与插件界面

- `SettingsDialog.vue` + [store/settings.ts](src/store/settings.ts)：基础设置（外观、语言、导入解析开关）、存储、AI 配置、插件和卸载分区；默认打开「基础设置」，调用方可用 `initialSection` 指定分区。
- `Home.vue` 持有设置弹窗的打开状态和分区；`ActivityBar.vue` 只发出 `openSettings`。没有可用 AI 配置时，点击活动栏的辅助面板按钮或论文库的「AI 解析」会让 Home 直接打开 AI 分区，不打开无法工作的面板，也不发起解析。
- 「存储」分区上方管理论文库目录，下方通过 `window.api.clearCache()` 清理 Electron 的 HTTP、代码和 DNS 缓存；只展示成功/失败状态，不要在渲染进程推断文件系统缓存。
- 「卸载」是独立分区（不放在存储里）：分区内只保留标题和操作按钮，删除范围只在点击后的 AlertDialog 确认框里提示。确认框用 shadcn-vue 的 `AlertDialog`（取消在前、默认焦点在取消），文案必须明确说明本地论文副本、标注、设置、API Key 和插件会被删除，导入前的原始 PDF 保留。只有用户确认后才调用 `window.api.uninstallApp()`；成功后主进程退出，取消则关闭弹窗、按钮恢复可用。
- AI 配置表单先选接口类型（`openai` / `anthropic`），再填 Base URL、模型和 Key；保存时必须把 `provider` 一起回传，否则主进程沿用该 id 原有的协议。
- 每份 AI 配置都有 `enabled` 状态，可在设置页禁用/启用；编辑时保留原状态。禁用配置不能设为当前模型，`activeAiProfile`、`enabledAiProfiles`、`isAiConfigured` 和助手面板的模型下拉都只考虑启用配置。主进程仍会在 `ai-request` 边界拒绝禁用配置。
- Base URL 校验与主进程一致：默认 HTTPS，仅 `localhost` / `127.0.0.1` / `[::1]` 可用 HTTP；新增配置必须有 Key。
- `settings.keyStorage === 'plaintext'` 时明确提示 Key 会以明文落盘。
- `PluginViewFrame.vue` + [lib/plugin-view.ts](src/lib/plugin-view.ts)：已启用且兼容插件的 `contributes.views` 由 `Home.vue` 放进活动栏，`location=main` 替换主内容区，`location=sidebar` 替换左侧书库面板。
  - 插件 HTML 只通过 `reader-bai-plugin://` 加载到 `sandbox="allow-scripts"` 的 iframe，不能使用 `allow-same-origin`，不要用 `v-html` 把插件内容渲染进应用 DOM。
  - iframe 只通过 postMessage 请求 `tools.list` / `tools.execute`；渲染进程校验 `event.source`、消息类型和字段后调用 `window.api.pluginViewRequest`，再把结果回传。不要给插件暴露 `window.api`。
  - 主窗口 CSP 只额外放行 `frame-src reader-bai-plugin:`；新增协议或资源类型时同步 CSP。
- `PluginSettings.vue` + [store/plugins.ts](src/store/plugins.ts)：
  - 展示插件名称、版本、权限、命令、兼容性和宿主运行状态。
  - 启用开关失败时恢复原状态，保持界面与主进程一致。
  - 监听 `onPluginRuntime` 并在卸载时取消订阅。
  - 插件不兼容或宿主不可用时只展示错误，不影响设置页其他功能。

## 国际化

- 所有用户可见文本走 [lib/i18n.ts](src/lib/i18n.ts) 的 `t(key, params)`；不要在组件、store 或 lib 里硬编码中文/英文界面文案。
- 消息键的唯一来源是 [locales/zh.ts](src/lib/locales/zh.ts)，`MessageKey` 由它推导；每个语言包用 `satisfies LocaleMessages` 保证键齐全。
- 当前支持 `zh`、`en`，注册表在 `i18n.ts` 的 `LOCALES`。默认语言是 `zh`；`normalizeLocale` 先精确匹配，再退到基础语言（`en-US` → `en`），最后回退默认语言。
- 切换语言通过 `settingsStore.setLanguage(code)`：`setLocale` 立即生效并同步 `<html lang>`，持久化失败时回滚；不要只调 `setLocale` 而不写设置。
- 当前语言状态的 ref 挂在 `globalThis` 的 symbol 键下，而不是模块作用域：Vite HMR 重新实例化模块时，设置 store 的旧闭包和热更新后的组件必须读写同一个 ref，否则会出现「活动栏已切换、设置弹窗仍是旧语言」的不一致。新增语言相关状态时沿用这一共享方式。
- 增加新语言：新增 `locales/<code>.ts`（实现全部 `MessageKey`）→ 在 `LOCALES` 追加 `{ code, label, messages }`。主进程不需要改，`language` 只做 BCP 47 格式校验。
- 插值使用 `{name}` 占位符，参数放第二个对象；缺失参数会保留占位符，便于发现漏传。
- 系统提示词、日志和主进程返回的错误信息不属于界面文案，保持现状；AI 系统提示不要跟随界面语言，避免改变翻译/工具行为。

## 测试

- 组件测试用 Vitest + Vue Test Utils，在 `beforeEach` 里 mock `window.api`，不要启动 Electron。
- 测试优先按用户可见行为断言：role、`aria-label`、文本、输入值和禁用状态。
- agent loop 的纯逻辑在 `tests/unit/agent-loop.test.ts` 覆盖，协议校验在 `tests/unit/agent-protocol.test.ts`，组件测试只验证面板接线。
- 用户流程用 Playwright E2E，复用 `tests/e2e/helpers.ts` 的临时 `--user-data-dir` 和对话框打桩；见 [docs/testing.md](../../docs/testing.md)。
