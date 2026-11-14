# src/main/CLAUDE.md

主进程指引。仓库级规则见 [根 CLAUDE.md](../../CLAUDE.md)，安全模型见 [docs/security.md](../../docs/security.md)；这里只补充主进程内部约定。

## 职责与装配

- `index.ts` 只做启动装配：创建 store、run manager、插件宿主、工具注册表，注册 IPC，创建窗口，退出时停止插件宿主。业务逻辑不要写进这里。
- 领域逻辑按域拆到 `src/main/<domain>.ts`：`library.ts`、`annotations.ts`、`settings.ts`、`settings-store.ts`、`ai.ts`、`ai-run.ts`、`pdf-text.ts`、`platform-tools.ts`、`tool-registry.ts`。
- IPC handler 统一放 `src/main/ipc/<domain>.ts`，导出 `register<Domain>Ipc(...)`，由 `index.ts` 装配。
- 窗口与 Electron 加固在 `window.ts`：保持 `sandbox`、`contextIsolation`，关闭 `nodeIntegration` / `webviewTag`；导航、新窗口、权限请求默认拒绝。
- 长任务（PDF 解析、AI 请求、插件）不要阻塞主线程；需要隔离时用 Worker 或 `utilityProcess`。

## IPC 与持久化

- 主进程把渲染进程传来的所有参数当作不可信输入：校验类型、非空、长度、枚举和数值范围；错误信息不要回显 Key、绝对路径或论文正文。
- 新增 IPC 时同步：main handler → preload 方法（约定见 [src/preload/CLAUDE.md](../preload/CLAUDE.md)）→ `src/preload/index.d.ts` → 应用数据相关的 `src/renderer/src/types.ts`；补成功、非法输入和失败路径测试。
- 通道命名 `<domain>:<action>`。现有通道：
  - `library:*`：list / createSpace / renameSpace / deleteSpace / renamePaper / movePaper / removePaper
  - `dialog:importPaper`、`dialog:chooseDirectory`
  - `paper:read`
  - `annotations:list/add/remove`
  - `settings:get/update`
  - `ai:chat`、`ai:abort`、`ai:chunk`
  - `runs:start/finish/cancel`
  - `tools:list/execute`
  - `plugins:list/runtime/setEnabled`，以及主进程推送的 `plugins:runtime-changed`
- 文件访问只允许书库中已登记的路径；导入只接受系统对话框的结果；`library.directory` 只接受绝对路径或空字符串（默认 `userData/papers`）。
- 数据文件（`userData` 下）：
  - `library.json`：`{ spaces, papers }`；读取时走 `normalizeLibrary` 兼容旧格式；移除论文/空间不删除 PDF。
  - `annotations.json`：以论文路径为键；`add` / `remove` / `list` 都先校验论文库归属；读盘时逐字段清洗，坏条目跳过。
  - `settings.json`：`{ theme, ai: { profiles, activeId }, library: { directory } }`；旧单配置读取时迁移为 `id: 'default'`，不回写。
- 导入 PDF 时复制到论文库目录，同名自动加 ` (2)` 等后缀；`path` 指向副本，`sourcePath` 记录原文件用于去重；已在目录内的文件不重复复制。
- `titleSource`（`file` | `metadata` | `user`）防止元数据回填覆盖用户重命名。
- 发送数据到渲染进程前剥离 Vue 代理；需要跨进程的结构只保留普通对象、数组和原始值。

## 安全边界

- API Key 只在主进程解密和使用。`settings:get` 只返回 `hasApiKey` 和 `keyStorage`，绝不返回明文或密文。
- `settings:update` 接受部分补丁；未带 `apiKey` 的配置保留原有 Key，新增配置必须带 Key。
- Base URL 只允许 HTTPS；仅 `localhost` / `127.0.0.1` / `[::1]` 可用 HTTP。保存和发起请求时都校验。
- 已有 Key 的配置更改 origin 时，`settings:update` 先弹主进程原生确认；路径变化不触发确认。
- 系统安全存储不可用时，`settings:get` 返回 `keyStorage: 'plaintext'`，由设置页提示用户。
- 不通过日志输出密钥、令牌、选区正文和论文内容。
- 插件宿主不是 OS 沙箱：`utilityProcess` 只隔离崩溃和进程状态，manifest 权限只约束平台工具调用。不要把它描述成已沙箱；进一步限制留待后续阶段。

## AI 网关

- `ai.ts` 刻意不依赖 Electron，方便单元测试；负责 OpenAI 兼容的 SSE 流式解析和 `tool_calls` 聚合。
- `ai:chat` 接收 `requestId`、`messages`、`profileId`、可选 `toolNames` 和 `runId`：
  - `messages` 先经 `normalizeChatMessages` 校验角色、结构、条数和总长度。
  - `toolNames` 只能引用工具注册表中已注册且 `exposeToAi` 的工具，schema 由主进程解析。
  - `runId` 存在时先取 run、检查是否已中止，并调用 `recordStep` 计步。
  - Key 只在本 handler 内解密并传给 `streamChat`，不进入聊天参数。
- 流式增量通过 `ai:chunk` 推送，发送前检查 `event.sender.isDestroyed()`。
- 每个请求用独立 `AbortController`；`ai:abort` 和 run 的 abort signal 都要能中止网络请求。

## 平台工具与运行边界

- `tool-registry.ts` 统一注册平台工具：
  - 字段：`name`、`title`、`description`、`inputSchema`、`risk`（`read` / `write` / `destructive`）、`exposeToAi`、`requiredPermissions`、`validate`、`execute`。
  - 执行顺序：来源检查 → `validate` 归一化参数 → `authorize` / 确认 → `execute`。
  - 写操作确认由 `ipc/tools.ts` 的 `confirmToolInvocation` 在主进程弹出，插件和 AI 无法绕过。
- `platform-tools.ts` 当前注册：
  - `library.list`、`paper.get`、`paper.readPage`、`annotations.list`（只读）
  - `annotations.add`（写）、`annotations.remove`（破坏性）
  - 权限：读工具要 `documents:read`；标注写入要 `documents:read` + `annotations:write`。
- `pdf-text.ts` 按需加载 pdfjs，限制 PDF 大小（100 MB）和解析时间（20 秒）；页码从 1 开始，越界返回可读错误；单页文本会截断后再返回。
- `ai-run.ts` 持有 run 生命周期：`runId`、`AbortSignal`、步数、token 用量、超时和取消原因。`runs:*` IPC 只接受合法的步数上限（1–20）和超时（1 秒–10 分钟）。

## 插件宿主

- `plugins/manifest.ts`：manifest 校验。id 固定 `publisher.name`，版本 semver，`engines.readerBai` 限制宿主版本，`activationEvents` 支持 `onStartup` / `onCommand:<id>`，`contributes.commands`，权限白名单为 `documents:read` / `annotations:write` / `network` / `storage`；未知字段一律拒绝。
- `plugins/discovery.ts`：扫描 `userData/plugins` 的真实子目录，跳过符号链接；单个插件损坏只记录 issue，不影响其他插件和主程序启动。
- `plugins/host.ts`：管理启用状态，默认关闭，写入 `userData/plugins.json`；版本不兼容的插件不能启用；`runtimePlugins()` 只返回已启用、兼容且声明了 `main` 的入口。
- `plugins/runtime.ts`：用 `utilityProcess.fork` 启动 `out/main/plugin-host.js`；插件启停后整体重载宿主；崩溃、启动失败和退出都反映为运行状态；按 manifest 权限放行工具调用，写操作仍走主进程确认。
- `plugins/host-process.ts`：独立宿主入口，动态 import 插件 `main`；只激活声明了 `onStartup` 的插件（`onCommand` 暂未接入）；激活/停用有 10 秒超时；向插件注入 `pluginId`、`permissions`、`log` 和受限的 `tools` API。
- `plugins/protocol.ts`：校验宿主消息（`ready` / `status` / `log` / `api-request` / `stopped`），API 方法限定为 `tools.list` / `tools.execute`，字段和参数体积有上限。
- `plugins/api.ts`：插件作者契约；插件拿不到 `window.api`、设置文件、`BrowserWindow` 或 API Key。
- 构建入口在 `electron.vite.config.ts` 的 main rollup input 中，必须保留 `plugin-host` 独立产物。

## 测试

- 纯逻辑模块（`ai.ts`、`ai-run.ts`、`tool-registry.ts`、`platform-tools.ts`、`plugins/*`、`pdf-text.ts`、`settings.ts`、`library.ts`、`annotations.ts`）优先用 Vitest 直接测，尽量不启动 Electron。
- 需要 Electron API 时在测试里 mock 或通过 E2E 的 `app.evaluate` 打桩（例如 `safeStorage`、`dialog.showMessageBox`、`dialog.showOpenDialog`）。
- E2E 使用临时 `--user-data-dir`；写操作确认、非法输入、路径归属和 Key 不出现在返回值中都要覆盖。
- 测试分层和命令见 [docs/testing.md](../../docs/testing.md)。
