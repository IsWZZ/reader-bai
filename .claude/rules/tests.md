---
paths:
  - "tests/**"
---

# 测试代码要求

测试分三层：`tests/unit`（纯逻辑、store、主进程模块）、`tests/component`（Vue 组件）、`tests/e2e`（Playwright + Electron 真实流程）。单元/组件用 `.test.ts`，E2E 用 `.spec.ts`。详细背景见 [docs/testing.md](../../docs/testing.md)。

## 覆盖要求

- 每个功能改动或 bug 修复都必须带测试；bug 修复先写能复现问题的回归测试，确认修复前它确实失败。
- 至少覆盖成功路径、非法/边界输入、失败或降级路径；涉及持久化的要验证重启后回填。
- 新增或修改 IPC 时，成功路径和至少一条参数校验/失败路径都要覆盖。
- 不允许为了通过而删除、放宽既有断言或加 `.only`/无理由的 `skip`；先找原因。

## 单元 / 组件测试

- 不启动 Electron、不访问网络或真实用户目录；`window.api` 用 `vi.fn` / `vi.mock` 模拟。
- Pinia store 每个用例 `setActivePinia(createPinia())` 隔离；复用 `tests/setup.ts`，不要往里加单个用例专属逻辑。
- 断言行为而不是实现细节；组件优先用可见文本、`getByRole`、`aria-label` 查询。
- reka-ui 弹窗会 Teleport 到 `body`：先 `flushPromises()`，再用 `DOMWrapper` 查 `document.body`，`wrapper.find*` 看不到。

## E2E

- 始终用 `createUserDataDir()` + `launchReader()` 启动，测试结束 `removeUserDataDir()`；禁止读写真实 `Application Support` 目录。
- 测试数据现场生成：`seedLibrary()` 播种论文库，`writeSamplePdf()` 生成 PDF；不依赖仓库外的文件或网络状态。
- 原生对话框用 `stubOpenDialog()` / `stubOpenDirectoryDialog()` / `stubMessageBox()` 替换，不要尝试点击系统弹窗。
- 只跑构建产物：用 `npm run test:e2e`（会先 build），不要在没有重新构建时直接 `npx playwright test`。
- 等待用 `waitFor` / `expect.poll` / `flushPromises`，不用固定 `setTimeout` 或依赖执行顺序；用例之间不共享可写状态。
- 持久化断言先 `expect.poll` 读取 `userData/Userdata` 下的 JSON，再重启应用验证恢复。

## 完成标准

- 提交前跑 `npm run lint`、`npm run typecheck`、`npm test`；涉及发布或跨进程流程跑 `npm run test:all`。
- 汇报时说明新增/修改了哪些测试；测试没跑或失败就如实说明，不能当作完成。
