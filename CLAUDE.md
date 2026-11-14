# CLAUDE.md

本文件是仓库级指引，只保留跨进程、跨目录都必须遵守的规则。进程特定约定按目录拆分：

- [src/main/CLAUDE.md](src/main/CLAUDE.md)：主进程、IPC、持久化、AI 网关、平台工具、插件宿主。
- [src/preload/CLAUDE.md](src/preload/CLAUDE.md)：最小桥接面、类型同步和事件订阅。
- [src/renderer/CLAUDE.md](src/renderer/CLAUDE.md)：Vue 渲染进程、组件/store、UI、阅读器、AI 面板。
- 详细设计仍以 `docs/` 为准：[架构](docs/architecture.md)、[安全](docs/security.md)、[PDF 阅读器](docs/pdf-viewer.md)、[测试](docs/testing.md)。

从仓库根启动时会加载本文件；进入 `src/main/`、`src/preload/` 或 `src/renderer/` 处理文件时，对应目录的 CLAUDE.md 会按需加载。改动某个进程前先读该目录的指引，不要把另一进程的约定套过来。

## 项目概览

`reader-bai` 是面向学术论文的 Electron 桌面阅读器：导入 PDF、按空间组织、阅读并保存高亮/下划线。渲染进程用 Vue 3 + TypeScript（`<script setup>`）、Tailwind CSS v4、shadcn-vue，PDF 由 pdfjs-dist 渲染。

长期定位是学术论文工作台，按四层组织：

- **A 平台核心**（已有基础能力）：书库、阅读、标注、基础翻译/AI，轻量内置。
- **B 内置模块**（还未开发）：知识库、云端查找入口、写作、推荐入口、社区客户端，随包发布、可关闭。
- **C 第三方插件**（宿主已实现，具体插件还未开发）：检索源、模型提供商、导出格式等，需要 manifest、权限和隔离。
- **D 云端服务**（还未开发）：账号、同步、推荐、社区后端，可选。

当前实现进度：A 层已有 PDF 导入/阅读、空间管理、单页标注、翻译、多 AI 配置、流式对话、平台工具和 agent run；C 层已有 manifest 校验、插件发现、启停、独立 `utilityProcess` 宿主和按权限放行的工具调用。B 层和 D 层全部还未开发；C 层的命令触发、participant 输出协议、安装/签名校验和具体插件类型也还未开发。插件宿主不是 OS 沙箱，只应安装可信插件。

本地优先，云能力可选。定层、扩展点和路线见 [docs/architecture.md](docs/architecture.md)。

## 项目结构

```text
reader-bai/
├─ src/
│  ├─ main/                 # Electron 主进程
│  │  ├─ index.ts           # 启动装配：store、IPC、窗口、插件宿主
│  │  ├─ ipc/               # IPC handler（library/settings/ai/tools/runs/plugins）
│  │  ├─ plugins/           # C 层插件宿主（manifest/发现/协议/utilityProcess）
│  │  ├─ ai.ts / ai-run.ts  # AI 请求与 run 生命周期
│  │  ├─ platform-tools.ts  # 平台工具注册
│  │  └─ ...                # library/annotations/settings/pdf-text/window
│  ├─ preload/              # window.api 桥接与类型声明
│  └─ renderer/             # Vue 3 渲染进程
│     ├─ index.html
│     └─ src/
│        ├─ views/          # Home 外壳
│        ├─ components/     # 书库/阅读器/AI/设置/插件界面，ui/ 为 shadcn-vue
│        ├─ store/          # Pinia：assistant/settings/plugins
│        ├─ lib/            # agent-loop/pdf/ai
│        └─ assets/css/     # Tailwind 与设计 token
├─ tests/                   # unit / component / e2e
├─ docs/                    # 架构、安全、PDF、测试
├─ build/ resources/        # 打包资源
└─ 配置：electron.vite.config.ts / electron-builder.yml / package.json / tsconfig*.json
```

`out/` 是构建产物，不读不改。三个进程的详细约定见各目录的 CLAUDE.md；测试分层见 [docs/testing.md](docs/testing.md)。

## 常用命令

在仓库根执行：

```bash
npm run dev         # 开发
npm run build       # 类型检查 + 构建（另有 build:win / build:mac / build:linux / build:unpack）
npm run lint        # ESLint；lint:fix / format 用于修复与格式化
npm run typecheck   # node + web + test + e2e 四组检查
npm test            # Vitest 单元/组件测试（watch / coverage 见 package.json）
npm run test:e2e    # 构建后跑 Playwright
npm run test:all    # 发布前：lint + typecheck + unit + E2E
```

## 跨进程规则

1. **先按四层定层。** 产品核心体验不做成第三方插件；只有 C 层需要插件宿主。
2. **Main 只做平台能力。** 业务按域放在 `src/main/<domain>.ts`，不堆进 `src/main/index.ts`。
3. **Renderer 不可信。** 不碰 Node 或文件系统；`window.api` 要当作可能为 `undefined`；不直接请求外部服务。
4. **Preload 只暴露最小 `window.api`。** 不暴露 `electronAPI`、Node 或文件系统。
5. **新功能做成独立组件 + store。** 通过 props/事件与外壳通信，不塞进 `Home.vue` 或 `PdfViewer.vue`；功能之间不互相 import store，用共享服务、事件或平台 API。
6. **IPC 统一走主进程校验。** 通道名用 `<domain>:<action>`；主进程校验每个参数；新增 IPC 同步 main handler、preload 方法、`src/preload/index.d.ts`，涉及应用数据时再改 `src/renderer/src/types.ts`；发送前剥离 Vue 代理，并补成功/失败测试。
7. **敏感信息只在主进程。** API Key、令牌、文件路径和网络请求都不能交给渲染进程；渲染进程拿不到明文 Key。
8. **长任务不阻塞 UI。** 索引、下载、AI 请求等走主进程或 Worker；未配置/未启用的能力要优雅降级。
9. **安全默认拒绝。** 外链只放行 `http(s)`，导航、新窗口和权限请求默认拒绝；文件读取只允许书库中已登记的路径。详见 [docs/security.md](docs/security.md)。

## 技术栈与工具偏好

优先使用已有工具的能力，不重复造轮子：

- **UI**：先查 `src/renderer/src/components/ui/**` 并复用现有组件；缺的用 shadcn-vue CLI 按 `components.json` 添加（`npx shadcn-vue@latest add <component>`），不手写重复组件；生成代码少改。
- **状态与工具**：优先 Pinia、Vue Router、`@vueuse/core` 的现成能力；能不加依赖就不加。
- **AI**：渲染进程只通过 `window.api` 调 AI；主进程负责模型访问和 Key。当前没有 AI SDK，引入前先讨论。
- **测试**：Vitest + Vue Test Utils + Playwright，复用 `tests/setup.ts` 和 `tests/e2e/helpers.ts`。

## 代码风格

- Prettier：单引号、不加分号、行宽 100、不加尾随逗号。
- 所有 Vue 组件必须用 TypeScript 和 `<script setup lang="ts">`。
- 新逻辑优先 Composition API。
- 生成物和依赖目录（`out/`、`build/`、`dist/`、`node_modules/`、`test-results/`）不读、不改；需要了解构建产物时看源码或配置。
- 一个文件中倾向于提供特定的一种功能或者相关的几种功能,避免过长的代码文件臃肿的提供无数能力。
