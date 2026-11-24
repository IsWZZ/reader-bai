# 测试规范（Vitest + Vue Test Utils + Playwright）

项目分两层测试：**单元/组件测试**验证渲染进程逻辑，**E2E**用 Playwright 启动真实 Electron 应用验证主进程、IPC 和 UI 的组合行为。

## 命令

```bash
npm test                    # 运行全部单元/组件测试（vitest run）
npm run test:unit:core      # 只跑平台核心的单元/组件测试
npm run test:unit:module    # 只跑 B 层模块的单元/组件测试
npm run test:unit:watch     # 监听模式
npm run test:coverage       # 单元测试 + V8 覆盖率
npm run test:e2e            # 先构建，再用 Playwright 跑全部 E2E
npm run test:e2e:core       # 只跑平台核心的 E2E
npm run test:e2e:module     # 只跑 B 层模块的 E2E
npm run test:all            # lint + typecheck + 全部单元测试 + 全部 E2E
```

提交前至少运行 `npm run test:all`。CI 会把单元和 E2E 拆成“核心”与“模块”两步运行，输出里能直接看出是哪一层失败；`typecheck` 覆盖 `tests/` 和 `src/modules/**/tests/` 的单元、组件与 E2E 类型检查。

## 单元/组件测试

- 配置：`vitest.config.mts`，环境为 `jsdom`，通过 `@vitejs/plugin-vue` 编译 SFC。
- 目录：平台代码的测试放 `tests/unit/*.test.ts`（纯逻辑与 store）和 `tests/component/*.test.ts`（Vue 组件）；B 层模块的测试放 `src/modules/<module>/tests/unit/` 和 `tests/component/`。命名统一用 `.test.ts`。
- 全局初始化在 `tests/setup.ts`：补齐 jsdom 缺失的 `matchMedia`、`ResizeObserver`、`IntersectionObserver`，并在每个测试后清理 `document.body` 和主题类名。
- 测试代码由 `tsconfig.test.json` 单独做 `vue-tsc` 类型检查，通过 `@renderer/*` 引用源码。
- Pinia store 测试用 `setActivePinia(createPinia())` 隔离；IPC 一律 mock `window.api`，不要在单元测试里启动 Electron。
- 组件中的 reka-ui 弹窗会 Teleport 到 `body`：用 `flushPromises()` 后通过 `DOMWrapper` 查询真实 DOM，`wrapper.findAll` 看不到 Teleport 内容。
- 覆盖率只统计单元测试，不包含 E2E 覆盖的代码，因此数字偏低是正常的；不要把全项目覆盖率当作 E2E 的替代指标。

## E2E（Playwright + Electron）

- 配置：`playwright.config.ts`，测试目录为 `tests/e2e/` 和 `src/modules/<module>/tests/e2e/`，文件命名 `*.spec.ts`，串行执行（`workers: 1`）。
- **始终针对构建产物**：`npm run test:e2e` 会先执行 `npm run build`，Playwright 启动 `out/main/index.js`。改完代码后不要直接跑 `npx playwright test`，除非确认 `out/` 是最新的。
- **数据隔离**：`tests/e2e/helpers.ts` 的 `launchReader()` 会为每个测试创建临时 `userData` 目录，并通过 `--user-data-dir` 传入。禁止让测试读写 `~/Library/Application Support/reader-bai` 等真实用户目录。
- 环境变量 `ELECTRON_RUN_AS_NODE` 会让 Electron 以 Node 模式运行，`launchReader()` 会主动剔除；手动启动时也要用 `env -u ELECTRON_RUN_AS_NODE`。
- 测试数据用 `writeSamplePdf()` 现场生成最小 PDF，再用 `userData/Userdata/library.json` 播种论文库；不要依赖仓库外部的 PDF 文件。
- 原生文件选择框无法直接点击：需要测试导入流程时，用 `electronApp.evaluate(({ dialog }) => { ... })` 替换 `dialog.showOpenDialog`，再触发 UI。
- 断言优先使用角色和可见文本（`getByRole`、`getByLabel`、对话框的 `role="dialog"`）；图标按钮必须提供 `aria-label`。
- 主题、AI 配置等持久化断言：先 `expect.poll` 读取 `userData/Userdata` 下的 JSON 文件，再重启应用验证回填，避免只测内存状态。
- CI（`.github/workflows/ci.yml`）在 Linux 上依次执行 lint、typecheck、build，然后分别跑核心/模块单元测试（`test:unit:core` / `test:unit:module`）和核心/模块 E2E（`xvfb-run -a npm run test:e2e:core` / `test:e2e:module`）；`launchReader()` 在 CI 下会自动追加 `--no-sandbox`。

## 新增功能时

1. 纯逻辑和 store 变更：平台代码补 `tests/unit/`，B 层模块补 `src/modules/<module>/tests/unit/`。
2. 组件交互：平台代码补 `tests/component/`，B 层模块补 `src/modules/<module>/tests/component/`。
3. 用户可见流程：在 `tests/e2e/` 或 `src/modules/<module>/tests/e2e/` 增加一条覆盖关键路径的 E2E（打开 → 操作 → 持久化 → 重启恢复）。
4. 主进程新增 IPC：至少用 E2E 覆盖成功路径和一条失败/校验路径。
5. 修改选择、注释或渲染相关代码后，回归 `tests/e2e/library.spec.ts` 中的 PDF 渲染用例；复杂选区算法仍需要手工验收。
