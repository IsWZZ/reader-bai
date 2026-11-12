# CLAUDE.md

在本仓库中工作时给 Claude Code 的指引。

## 项目概览

`reader-bai` 是一个面向学术论文的 Electron 桌面 PDF 阅读器。用户把 PDF 导入本地书库，用空间（space）组织它们，阅读并在每篇论文上保存高亮/下划线。渲染进程使用 Vue 3 + TypeScript（`<script setup>`），样式基于 Tailwind CSS v4 和 shadcn-vue 组件，PDF 渲染由 pdfjs-dist 负责。

## 常用命令

### 开发

```bash
npm run dev          # 启动带 HMR 的开发服务器
```

### 构建

```bash
npm run build        # 类型检查并构建生产版本
npm run build:win    # 构建 Windows 版本
npm run build:mac    # 构建 macOS 版本
npm run build:linux  # 构建 Linux 版本
npm run build:unpack # 只构建、不打包
```

### 代码质量

```bash
npm run lint         # 运行 ESLint（带缓存）
npm run lint:fix     # 运行 ESLint 并自动修复
npm run format       # 运行 Prettier 格式化代码
npm run typecheck    # 运行 Node 和 Web 两边的类型检查
npm run typecheck:node  # 检查 main 和 preload 进程
npm run typecheck:web   # 检查渲染进程（Vue）代码
```

### 预览

```bash
npm run start        # 预览生产构建
```

### 测试

```bash
npm test                 # Vitest 单元/组件测试（jsdom）
npm run test:unit:watch  # Vitest 监听模式
npm run test:coverage    # 单元测试 + V8 覆盖率
npm run test:e2e         # 先构建，再用 Playwright 跑真实 Electron 应用
npm run test:all         # lint + typecheck + unit + E2E
```

发布前运行 `npm run test:all`。测试目录结构与约定见 [docs/testing.md](docs/testing.md)。

## 架构

### 三个进程

1. **Main**（`src/main/index.ts`）—— 窗口创建以及所有持久化和文件访问。在 `app.getPath('userData')` 下写入 `library.json`、`annotations.json` 和 `settings.json`。读取论文和写入标注都会先对照书库记录做校验。
2. **Preload**（`src/preload/index.ts`、`index.d.ts`）—— 上下文隔离桥接层。暴露 `window.electron`（electron-toolkit）和 `window.api`；`index.d.ts` 声明 `Api` 接口及共享数据结构。
3. **Renderer**（`src/renderer/src/`）—— Vue 应用。它从不直接接触 Node API 或文件系统，一切都通过 `window.api`（要当作可能为 `undefined` 来处理）。

### 渲染进程结构

- `views/Home.vue` —— 应用外壳。持有 `currentPaper` 以及书库面板的展开/宽度状态，并组合下面的各个面板。路由只有一个 hash 路由（`router/index.ts`）。
- `components/LibraryPanel.vue` —— 空间与论文列表：导入、重命名、删除、在空间之间拖拽移动、用 PDF 元数据回填标题。
- `components/PdfViewer.vue` —— pdf.js 渲染、缩放、文本层、单击/双击选词以及标注覆盖层。改动前先看 [docs/pdf-viewer.md](docs/pdf-viewer.md)。
- `components/ActivityBar.vue`、`components/Toolbar.vue` —— 窗口框架。
- `components/SettingsDialog.vue` —— 从活动栏打开的居中设置对话框（外观与 AI 服务）。
- `store/settings.ts` —— 应用设置的 Pinia store。把主题应用到 `<html class="dark">`，并暴露 `aiConfig`（Base URL / API Key）供其他功能使用。Pinia 在 `main.ts` 中安装，设置会在挂载前加载，以避免主题闪烁。
- `components/ui/**` —— shadcn-vue（reka-ui）组件；视为生成代码，尽量少做本地修改。
- `lib/pdf.ts` —— 共享的 pdf.js worker 初始化与 PDF 元数据标题解析。
- `types.ts` —— 渲染进程侧的书库、标注和设置数据类型副本。
- `tests/unit/**`、`tests/component/**` —— Vitest 单元测试和 Vue Test Utils 测试（`.test.ts`）；共享的 jsdom mock 位于 `tests/setup.ts`。
- `tests/e2e/**` —— Playwright Electron 测试（`.spec.ts`）和辅助函数。每个测试都用独立的 `--user-data-dir` 启动构建产物；绝不要指向真实用户数据。

### IPC 与持久化

渲染进程用到的 API 位于 `src/preload/index.ts`，与 `ipcMain.handle` 通道一一对应：

- 书库：`library:list`、`library:createSpace`、`library:renameSpace`、`library:deleteSpace`、`library:renamePaper`、`library:movePaper`、`library:removePaper`
- 文件：`dialog:importPaper`、`paper:read`
- 标注：`annotations:list`、`annotations:add`、`annotations:remove`
- 设置：`settings:get`、`settings:update`

数据规则：

- `library.json` 为 `{ spaces, papers }`。`normalizeLibrary` 负责迁移旧的纯数组格式并补全缺失字段；要保持这条路径可用。
- `annotations.json` 以论文路径为键：`{ [paperPath]: PaperAnnotation[] }`。
- `settings.json` 为 `{ theme, ai: { baseUrl, apiKey, apiKeyEncrypted } }`。主题取 `light` | `dark` | `system`；API Key 在可用时用 Electron `safeStorage` 加密，否则以明文保存。`settings:update` 接受部分补丁，未提供的字段保持不变。
- 移除论文或空间都不会删除磁盘上的 PDF；删除空间会把它下面的论文移到未分类。
- `titleSource`（`file` | `metadata` | `user`）用于防止元数据回填覆盖用户的重命名。

新增 IPC 功能时，要同时更新三层：`src/main/index.ts` 中的 handler、`src/preload/index.ts` 中的方法、`src/preload/index.d.ts` 中的类型（如果属于应用数据，还要更新 `src/renderer/src/types.ts`）。面向渲染进程的数据必须可结构化克隆 —— 发送前要剥离 Vue 响应式代理。同时补一个覆盖成功路径和一个校验失败路径的 E2E 测试。

### 测试约定

- 单元/组件测试（`vitest.config.mts`，jsdom）位于 `tests/unit` 和 `tests/component`，会 mock `window.api`，从不启动 Electron。
- E2E（`playwright.config.ts`、`tests/e2e`）针对 `out/` 运行，并且总是先通过 `npm run test:e2e` 构建。它使用临时的 `userData` 目录和生成的 PDF 测试文件。
- 只有图标的按钮需要 `aria-label`；对话框必须暴露标题，Playwright 才能用 `getByRole` 定位。
- reka-ui 的对话框会 Teleport 到 `body`；组件测试中要在 `flushPromises()` 之后查询真实 DOM。
- 覆盖率只统计单元测试；PDF 渲染、IPC 持久化以及主题/AI 往返由 E2E 覆盖。

### 路径别名与样式

- `@renderer/*` 和 `@/*` → `src/renderer/src/*`（Vite 和 `tsconfig.web.json`）。
- Tailwind CSS v4 通过 `@tailwindcss/vite` 接入；主题 token 位于 `assets/css/reset.css`，由 `assets/css/index.css` 导入。项目没有 `tailwind.config` 文件。
- shadcn-vue 配置在 `components.json` 中；UI 组件从 `cn` 包导入 `cn`。

### PDF 阅读器约束

详细规则见 [docs/pdf-viewer.md](docs/pdf-viewer.md)。最关键的几条：

- 保持 pdf.js worker 内联（`?worker&inline`）；基于 URL 的 worker 会破坏打包后的 `file://` 构建。
- 渲染是懒加载且带 generation 守卫的。改动加载、缩放或尺寸调整逻辑时，要保留 generation 检查和渲染任务取消。
- 文本选择和标注都只支持单页。标注矩形以归一化的 `0..1` 页面坐标持久化，绝不用像素。
- 未经查阅阅读器文档，不要把选择监听器从 `document` 移走，也不要改变单击/双击语义。

## 代码风格

- Prettier：单引号、不加分号、行宽 100 字符、不加尾随逗号。
- ESLint 在 @electron-toolkit 配置基础上扩展了 Vue 支持；忽略 `**/out` 和 `**/dist`。
- 所有 Vue 组件都必须使用 TypeScript（`<script lang="ts">`，由 ESLint 强制）。
- 新组件优先使用 Composition API 和 `<script setup lang="ts">`。
