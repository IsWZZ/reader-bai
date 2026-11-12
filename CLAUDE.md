# CLAUDE.md

在本仓库中工作时给 Claude Code 的指引。详细规则在 `docs/`，这里只保留核心。

## 项目概览

`reader-bai` 是面向学术论文的 Electron 桌面阅读器：导入 PDF、按空间组织、阅读并保存高亮/下划线。渲染进程用 Vue 3 + TypeScript（`<script setup>`）、Tailwind CSS v4、shadcn-vue，PDF 由 pdfjs-dist 渲染。

长期定位是学术论文工作台，按四层组织：**A 平台核心**（书库、阅读、标注、基础翻译/AI，轻量内置）、**B 内置模块**（知识库、云端查找入口、写作、推荐入口、社区客户端，随包发布、可关闭）、**C 第三方插件**（检索源、模型提供商、导出格式等，需要 manifest/权限/沙箱）、**D 云端服务**（账号、同步、推荐、社区后端）。本地优先，云能力可选。定层、扩展点和路线见 [docs/architecture.md](docs/architecture.md)。

## 常用命令

```bash
npm run dev         # 开发
npm run build       # 类型检查 + 构建（另有 build:win / build:mac / build:linux / build:unpack）
npm run lint        # ESLint；lint:fix / format 用于修复与格式化
npm run typecheck   # node + web + test + e2e 四组检查
npm test            # Vitest 单元/组件测试（watch / coverage 见 package.json）
npm run test:e2e    # 构建后跑 Playwright
npm run test:all    # 发布前：lint + typecheck + unit + E2E
```

## 架构

### 三个进程

1. **Main**（`src/main/index.ts`）—— 只做启动装配；窗口在 `window.ts`，各领域持久化在 `library.ts` / `annotations.ts` / `settings-store.ts`，IPC 注册在 `ipc/*`。在 `userData` 下写 `library.json`、`annotations.json`、`settings.json`，读论文/写标注前先校验书库。
2. **Preload**（`src/preload/index.ts`、`index.d.ts`）—— 暴露 `window.api`，声明 `Api` 与共享类型。
3. **Renderer**（`src/renderer/src/`）—— Vue 应用，不碰 Node 或文件系统；`window.api` 要当作可能为 `undefined`。

### 平台与功能边界

- 新增能力先按四层定层；产品核心体验不做成第三方插件，只有 C 层需要插件宿主。
- Main 只做平台能力；业务按域放平台服务，不堆进 `src/main/index.ts`。
- 新功能做成独立组件 + store，通过 props/事件与外壳通信，不塞进 `Home.vue` 或 `PdfViewer.vue`。
- 功能之间不互相 import store；用共享服务、事件或平台 API。
- 新增 IPC 按 `<domain>:<action>` 命名；preload 只暴露最小接口，校验放主进程。
- 敏感信息只在主进程；长任务（索引、下载、AI 请求）走主进程/Worker；渲染进程不直接请求外部服务。
- 未配置/未启用的能力要优雅降级。

### 关键位置

- `views/Home.vue` 外壳；`LibraryPanel.vue` 书库；`PdfViewer.vue` 渲染/选词/标注（改动前读 [docs/pdf-viewer.md](docs/pdf-viewer.md)）。
- `AssistantPanel.vue` + `store/assistant.ts` 翻译与 AI 对话；`SettingsDialog.vue` + `store/settings.ts` 主题、多 AI 配置与论文库存储位置。
- `components/ui/**` 为 shadcn-vue 生成代码；`lib/pdf.ts` 管 worker 与元数据；`types.ts` 是渲染侧类型副本。
- 测试：`tests/unit|component`（Vitest，mock `window.api`）、`tests/e2e`（Playwright，独立 `--user-data-dir`）；约定见 [docs/testing.md](docs/testing.md)。

### IPC 与数据

通道：`library:*`（list/createSpace/renameSpace/deleteSpace/renamePaper/movePaper/removePaper）、`dialog:importPaper`、`dialog:chooseDirectory`、`paper:read`、`annotations:list/add/remove`、`settings:get/update`、`ai:chat`（requestId, messages, profileId）、`ai:abort`、`ai:chunk`。

- `settings.json` 为 `{ theme, ai: { profiles: [{ id, baseUrl, apiKey, apiKeyEncrypted, model }], activeId }, library: { directory } }`；旧单配置读取时迁移为 `id: 'default'`（不回写）；`settings:update` 接受部分补丁；`library.directory` 只接受绝对路径，空字符串表示默认的 `userData/papers`。
- `library.json` 为 `{ spaces, papers }`，保持 `normalizeLibrary` 旧格式迁移；`annotations.json` 以论文路径为键；移除论文/空间不删 PDF。
- 导入 PDF 时复制到论文库目录（同名自动加 ` (2)` 等后缀），库中 `path` 指向副本、`sourcePath` 记录原文件用于去重；已在目录内的文件不重复复制；已有论文保持原路径。
- `titleSource`（`file` | `metadata` | `user`）防止元数据回填覆盖用户重命名。
- AI 只在主进程（`src/main/ai.ts`）按 `profileId` 解密 Key 并调 OpenAI 兼容 `/chat/completions`；Key 不经过聊天参数。
- 新增 IPC 要同步 main handler、preload 方法、`index.d.ts`（应用数据还要改 `renderer/types.ts`），发送前剥离 Vue 代理，并补成功/失败 E2E。

### PDF 约束

- worker 保持内联（`?worker&inline`）。
- 渲染保留 generation 守卫和任务取消。
- 选择与标注仅单页；标注坐标用归一化 `0..1`。
- 不移动 `document` 上的选择监听，也不改单击/双击语义（除非先读阅读器文档）。

### 安全

- 渲染进程不可信；所有 IPC 参数在主进程校验，preload 只暴露最小 `window.api`，不暴露 `electronAPI`、Node 或文件系统。
- API Key 只在主进程解密和使用；新增能力不得让明文 Key 进入渲染进程（`settings:get` 当前仍回传明文，是待修复项）。
- 文件读取只允许书库中已登记的路径，导入只走系统对话框；渲染进程不直接请求外部服务。
- 外链与导航默认拒绝，只放行 `http(s)`；权限请求默认拒绝。C 层插件按 manifest 权限和沙箱处理。
- 威胁模型、现有防护、已知风险和新增 IPC 检查清单见 [docs/security.md](docs/security.md)。

## 技术栈与工具偏好

优先使用已有工具的能力，不重复造轮子：

- **UI**：先查 `components/ui/**` 并复用现有组件；缺的用 shadcn-vue CLI 按 `components.json` 自行添加（`npx shadcn-vue@latest add <component>`），不手写重复组件；生成代码少改。
- **样式**：Tailwind v4 工具类 + `assets/css/reset.css` 的设计 token；不新增自定义 CSS/大段内联样式；动态类名写完整；合并用 `cn`。
- **图标**：业务组件用 `lucide-vue-next`；`components/ui/**` 里的 `@lucide/vue` 保持不动；纯图标按钮加 `aria-label`。
- **AI**：渲染进程走 `window.api.chat(...)`，主进程 `src/main/ai.ts`，模型来自设置里的 AI 配置；不直接 `fetch`、不传 Key；当前没有 AI SDK，引入前先讨论。
- **状态与工具**：优先 Pinia、Vue Router、`@vueuse/core` 的现成能力；能不加依赖就不加。
- **测试**：Vitest + Vue Test Utils + Playwright，复用 `tests/setup.ts` 和 `tests/e2e/helpers.ts`。

## 代码风格

- Prettier：单引号、不加分号、行宽 100、不加尾随逗号。
- 所有 Vue 组件必须用 TypeScript 和 `<script setup lang="ts">`。
- 新逻辑优先 Composition API。
