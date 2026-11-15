<div align="center">

# READER-BAI

**面向学术论文的本地优先桌面阅读与研究工作台**

[![CI](https://github.com/IsWZZ/reader-bai/actions/workflows/ci.yml/badge.svg)](https://github.com/IsWZZ/reader-bai/actions/workflows/ci.yml)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vue.js&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

导入 PDF，按空间组织，阅读并保存高亮与下划线；选中段落即可翻译，随时唤起流式 AI 对话。

离线优先 —— 阅读、管理与标注不依赖网络，云端能力全部可选。

[中文](README.md) | [English](README.en.md)

</div>

---

## 功能

| 模块        | 说明                                                           |
| ----------- | -------------------------------------------------------------- |
| 📚 本地书库 | 导入 PDF、按空间组织、检索与元数据管理                         |
| 📖 PDF 阅读 | 基于 pdf.js 的懒渲染、缩放、跨页文本选择                       |
| 🖍 标注      | 高亮与下划线，随论文持久化保存                                 |
| 🌐 选区翻译 | 单击选词、双击选句，自动送入右侧辅助面板                       |
| 🤖 AI 助手  | 多模型配置、流式对话、导入时的元数据解析（AI + Crossref 补全） |
| 🧩 插件系统 | manifest 校验、权限声明、独立进程宿主、sandbox iframe 插件视图 |

> 当前处于 A 层（平台核心）与 C 层（第三方插件宿主）已有基础能力的阶段；B 层内置模块与 D 层云端服务尚未开发，详见下方[产品方向](#产品方向)。

## 技术栈

| 类别       | 选型                                               |
| ---------- | -------------------------------------------------- |
| 桌面运行时 | Electron 44                                        |
| 界面       | Vue 3（`<script setup lang="ts">`）+ TypeScript    |
| 构建       | electron-vite                                      |
| 样式       | Tailwind CSS v4 + shadcn-vue                       |
| PDF        | pdfjs-dist                                         |
| 状态       | Pinia + Vue Router                                 |
| 测试       | Vitest、Vue Test Utils、Playwright（Electron E2E） |

## 快速开始

需要 Node.js 22+、npm，以及 macOS / Windows / Linux 之一。

```bash
git clone git@github.com:IsWZZ/reader-bai.git
cd reader-bai
npm install
npm run dev
```

`npm install` 会通过 `postinstall` 下载 Electron 二进制并重建原生依赖，首次安装耗时较长。

## 常用命令

| 命令                | 说明                                                |
| ------------------- | --------------------------------------------------- |
| `npm run dev`       | 启动开发模式                                        |
| `npm run build`     | 类型检查 + 构建                                     |
| `npm run build:mac` | 打包 macOS 版本（另有 `build:win` / `build:linux`） |
| `npm run lint`      | ESLint 检查（`lint:fix` 自动修复）                  |
| `npm run format`    | Prettier 格式化                                     |
| `npm run typecheck` | node / web / test / e2e 四组类型检查                |
| `npm test`          | 运行单元与组件测试                                  |
| `npm run test:e2e`  | 构建后用 Playwright 跑 Electron E2E                 |
| `npm run test:all`  | 发布前全量校验：lint + typecheck + unit + E2E       |

## 项目结构

```text
reader-bai/
├─ src/
│  ├─ main/            # Electron 主进程：IPC、持久化、AI 网关、插件宿主
│  ├─ preload/         # 最小 window.api 桥接与类型声明
│  └─ renderer/        # Vue 3 渲染进程：书库、阅读器、AI 面板、设置
├─ tests/              # unit / component / e2e
├─ docs/               # 架构、安全、PDF、插件视图、测试规范
├─ build/ resources/   # 打包资源
└─ out/                # 构建产物（不提交）
```

三个进程各自有独立的约定文件：[主进程](src/main/CLAUDE.md)、[预加载](src/preload/CLAUDE.md)、[渲染进程](src/renderer/CLAUDE.md)。

## 产品方向

`reader-bai` 的长期目标是学术论文工作台，按四层组织：

| 层                | 内容                                         | 状态     |
| ----------------- | -------------------------------------------- | -------- |
| **A. 平台核心**   | 书库、阅读、标注、基础翻译 / AI 对话         | 已有基础 |
| **B. 内置模块**   | 知识库、云端查找入口、写作、推荐、社区客户端 | 计划中   |
| **C. 第三方插件** | 检索源、模型提供商、导出格式等可替换实现     | 宿主已有 |
| **D. 云端服务**   | 账号、同步、推荐、社区与检索代理后端         | 计划中   |

定层规则、扩展点与路线阶段见 [docs/architecture.md](docs/architecture.md)。

## 安全

- API Key、令牌、文件路径与网络请求只存在于主进程，渲染进程拿不到明文密钥。
- 渲染进程不接触 Node 与文件系统，`window.api` 视为可能为 `undefined`。
- 文件读取仅限书库中已登记的路径；外链只放行 `http(s)`，导航与新窗口默认拒绝。
- 插件逻辑运行在独立 `utilityProcess` 中，插件 UI 运行在未授予 `allow-same-origin` 的 sandbox iframe 内。

完整边界与加固清单见 [docs/security.md](docs/security.md)。

## 文档

- [架构与产品方向](docs/architecture.md)
- [安全设计](docs/security.md)
- [PDF 阅读器](docs/pdf-viewer.md)
- [插件视图](docs/plugin-views.md)
- [测试规范](docs/testing.md)
- [仓库开发约定](CLAUDE.md)

## 贡献

提交前请运行 `npm run test:all`。新增功能应同时补充对应层级的测试（单元 / 组件 / E2E），主进程新增 IPC 需同步 preload 方法与 `index.d.ts` 类型声明。
