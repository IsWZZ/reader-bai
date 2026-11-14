# plugin 分支新增能力总结

本文总结 `plugin` 分支相对 `main` 新增的能力，覆盖 AI 工具网关、agent run 边界、C 层插件宿主、设置界面与配套安全加固。

## 总体定位

- **AI 仍是平台核心能力**：模型访问、密钥、工具注册和运行边界留在主进程。
- **agent loop 下放到模块**：第一方循环位于渲染进程的 [agent-loop.ts](../src/renderer/src/lib/agent-loop.ts)，平台只提供模型请求和工具执行接口。
- **C 层插件独立进程运行**：插件在 `utilityProcess` 扩展宿主中执行，拿不到 `window.api`、主进程设置或 API Key。
- **平台能力可被复用**：平台工具同时暴露给第一方 AI 和插件，权限校验、参数校验与写操作确认统一下沉到主进程。

## 1. AI 对话与工具调用

- 主进程 AI 请求支持 OpenAI 兼容的流式输出和 `tool_calls`：
  - 增量文本继续通过 `ai:chunk` 推送。
  - 工具调用按流式分片聚合，最终返回 `{ text, toolCalls, finishReason }`。
  - 支持 `stop` / `tool_calls` / `length` / `aborted` / `error` 结束原因。
- `ai:chat` 扩展为 `(requestId, messages, profileId, toolNames?, runId?)`：
  - 渲染进程只传工具名，真正的 schema 由主进程工具注册表解析，不能伪造工具定义。
  - 只接受已注册且 `exposeToAi` 的工具；数量、名称长度和消息内容都有上限。
- 消息校验覆盖角色、工具调用结构、`tool_call_id`、条数和总字符数；密钥仍只在主进程解密并用于请求。

## 2. 平台工具注册表

新增 [tool-registry.ts](../src/main/tool-registry.ts)，统一管理平台命令、内置模块和插件贡献的工具。

每个工具包含：

- `name` / `title` / `description` / `inputSchema`
- `risk`：`read` / `write` / `destructive`
- `exposeToAi`：是否进入模型工具列表
- `requiredPermissions`：插件调用前必须具备的权限
- `validate` / `execute`

执行边界会按顺序完成：

1. 校验来源是否被允许（AI 或插件只能调用 `exposeToAi` 的工具）。
2. 用工具自己的 `validate` 校验并归一化参数。
3. 执行权限/确认钩子。
4. 调用工具并记录审计钩子。

### 已注册平台工具

| 工具                 | 风险          | 作用                        | 所需权限                               |
| -------------------- | ------------- | --------------------------- | -------------------------------------- |
| `library.list`       | `read`        | 按关键词/空间列出论文       | `documents:read`                       |
| `paper.get`          | `read`        | 查看论文元数据和标注数量    | `documents:read`                       |
| `paper.readPage`     | `read`        | 读取指定页正文文本          | `documents:read`                       |
| `annotations.list`   | `read`        | 列出论文标注，可按页过滤    | `documents:read`                       |
| `annotations.add`    | `write`       | 新增高亮/下划线，执行前确认 | `documents:read` + `annotations:write` |
| `annotations.remove` | `destructive` | 按 id 删除标注，执行前确认  | `documents:read` + `annotations:write` |

配套能力：

- 主进程 PDF 文本提取 [pdf-text.ts](../src/main/pdf-text.ts)：按需加载 pdfjs，限制 PDF 大小和解析时间，页码越界返回可读错误。
- 写操作由 [ipc/tools.ts](../src/main/ipc/tools.ts) 在主进程弹出原生确认框；插件和 AI 都无法绕过。
- `tools:list` / `tools:execute` 对渲染进程开放，名称、参数体积和来源均有校验。

## 3. Agent run 生命周期

新增 [ai-run.ts](../src/main/ai-run.ts) 和 `runs:start/finish/cancel`：

- 每次 agent 运行由平台分配 `runId`，并持有 `AbortSignal`。
- 支持最大步数、输入/输出 token 预算和超时；超限、超时或取消都会中止运行。
- `recordStep` 在每次模型调用前计步，达到上限后拒绝继续请求。
- IPC 侧校验步数上限（1–20）和超时范围（1 秒–10 分钟）。
- `ai:chat` 携带 `runId` 时，会先确认运行仍有效，再计步并发起请求；运行中止时同步中止网络请求。
- 应用退出时停止全部运行。

### 第一方 agent loop

[agent-loop.ts](../src/renderer/src/lib/agent-loop.ts) 实现“模型 → 工具 → 模型”循环：

- 默认最多 8 步，硬上限 20 步。
- 只传工具名，schema 由平台解析。
- 工具参数不是合法 JSON 或执行失败时，错误会作为 `tool` 消息回给模型，不会中断整个对话。
- 支持 `assistant-message` / `tool-call` / `tool-result` / `tool-error` 事件。
- 取消、步数上限和最终原因都有明确返回值。

### 对话面板

- 新增「工具」开关，开启后只向模型暴露 `risk === 'read'` 且 `exposeToAi` 的平台工具。
- 工具模式先 `startRun` 建立预算和超时，再按 `runId` 发起每次模型请求。
- 工具调用记录显示在回复气泡下方（`调用工具：...` / 工具失败信息）。
- 停止对话会同时取消平台 run 和当前模型请求。

## 4. C 层第三方插件宿主

### manifest 与发现

插件放在 `userData/plugins/<目录>/manifest.json`，由 [manifest.ts](../src/main/plugins/manifest.ts) 与 [discovery.ts](../src/main/plugins/discovery.ts) 处理。

支持的 manifest 字段：

```json
{
  "id": "publisher.name",
  "name": "插件名称",
  "version": "1.0.0",
  "description": "可选说明",
  "engines": { "readerBai": "^1.0.0" },
  "activationEvents": ["onStartup", "onCommand:publisher.name.command"],
  "contributes": {
    "commands": [{ "id": "publisher.name.command", "title": "命令标题" }]
  },
  "permissions": ["documents:read"],
  "main": "dist/index.js"
}
```

校验规则：

- 插件 id 固定为 `publisher.name`，版本为 semver，入口必须是插件目录内的相对路径且不能越界。
- 未知字段一律拒绝，避免隐藏配置。
- 权限白名单：`documents:read`、`annotations:write`、`network`、`storage`。
- 发现阶段跳过符号链接；单个插件损坏只记录 issue，不影响其他插件和主程序启动。
- 第三方插件默认关闭；启用状态写入 `userData/plugins.json`；版本不兼容时不能启用。

### 扩展宿主进程

- [runtime.ts](../src/main/plugins/runtime.ts) 用 `utilityProcess.fork` 启动独立的 `plugin-host.js`：
  - 插件启停后整体重载宿主，不需要重启应用。
  - 宿主崩溃、启动失败和退出都会反映为运行状态。
  - 应用退出前停止宿主并调用插件 `deactivate`。
- [protocol.ts](../src/main/plugins/protocol.ts) 校验宿主消息：`ready` / `status` / `log` / `api-request` / `stopped`。
  - API 方法限定为 `tools.list` / `tools.execute`。
  - 字段长度、参数体积、待处理请求数量都有上限。
- [host-process.ts](../src/main/plugins/host-process.ts) 负责加载插件入口：
  - 动态 `import` 插件 `main`，支持 CJS 和 ESM。
  - 只激活声明了 `onStartup` 的插件；`onCommand` 目前保持 inactive。
  - 激活/停用有 10 秒超时。
  - 向插件注入 `pluginId`、`permissions`、`log` 和受限的 `tools` API。

### 插件作者 API

[api.ts](../src/main/plugins/api.ts) 暴露最小契约：

```ts
interface PluginContext {
  pluginId: string
  permissions: PluginPermission[]
  log: (level: 'info' | 'warn' | 'error', message: string) => void
  tools: {
    list: () => Promise<ToolInfo[]>
    execute: (name: string, input: unknown) => Promise<ToolResult>
  }
}

interface PluginModule {
  activate: (context: PluginContext) => void | Promise<void>
  deactivate?: () => void | Promise<void>
}
```

- 插件调用工具时，主进程按 manifest 的 `requiredPermissions` 逐项检查。
- 写/删除工具仍会触发主进程原生确认。
- 插件拿不到 API Key、设置文件、`BrowserWindow` 或渲染进程的 `window.api`。

## 5. 插件管理界面

设置页新增「插件」分区（[PluginSettings.vue](../src/renderer/src/components/PluginSettings.vue) + [store/plugins.ts](../src/renderer/src/store/plugins.ts)）：

- 展示插件名称、版本、描述、id、权限、命令和兼容性。
- 开关启用/停用；主进程拒绝时界面恢复原状态。
- 展示扩展宿主运行状态：未启动 / 启动中 / 运行中 / 启动失败。
- 展示无法加载的插件及原因。
- 监听主进程推送的 `plugins:runtime-changed`，状态实时更新。

## 6. 配套安全加固

该分支同时完成了以下加固：

- **API Key 不出渲染进程**：`settings:get` 只返回 `hasApiKey`；编辑时 Key 输入框留空，留空表示保留原 Key。
- **Base URL 策略**：默认只允许 HTTPS，仅本机回环地址可用 HTTP；保存和请求时都校验。
- **更换主机需确认**：已有 Key 的配置修改 origin 时，主进程先弹原生确认框，取消则拒绝保存。
- **加密降级可见**：系统安全存储不可用时返回 `keyStorage: 'plaintext'`，设置页明确提示。
- **渲染进程加固**：`sandbox: true`、关闭 Node/webview、拦截导航与新窗口、外链只放行 `http(s)`、权限请求默认拒绝。
- **最小 preload**：只暴露 `window.api`，移除 `electronAPI` 和调试日志。
- **标注防护**：新增/删除/读取都校验论文库归属；id、颜色、页码、文本长度、归一化坐标逐字段校验；坏数据读盘时跳过。
- **插件边界**：插件在独立 `utilityProcess` 中运行，工具调用按 manifest 权限放行，写操作由主进程确认。

## 7. IPC 与构建变更

新增或扩展的 IPC：

- `ai:chat` 增加 `toolNames` / `runId`。
- `runs:start`、`runs:finish`、`runs:cancel`。
- `tools:list`、`tools:execute`。
- `plugins:list`、`plugins:runtime`、`plugins:setEnabled`。
- 主进程推送 `plugins:runtime-changed`。

构建侧：

- [electron.vite.config.ts](../electron.vite.config.ts) 的 main 入口增加 `plugin-host`，产出独立的 `out/main/plugin-host.js`。

## 8. 测试与文档

- 新增单元/组件测试覆盖：agent loop、run 生命周期、AI 请求解析、PDF 文本提取、平台工具、工具注册表、manifest 校验、插件发现、宿主协议、插件宿主、插件设置界面、设置与标注安全校验。
- 新增 E2E：`tools.spec.ts`、`runs.spec.ts`、`plugins.spec.ts`、`plugin-runtime.spec.ts`，并扩展 assistant/settings/pdf-viewer/library-management。
- 当前验证状态：lint、四组 typecheck、231 个单元测试、50 个 E2E 全部通过。
- [docs/architecture.md](architecture.md)、[docs/security.md](security.md)、[CLAUDE.md](../CLAUDE.md) 已同步新边界。

## 9. 当前边界与后续

- **插件宿主不是 OS 沙箱**：宿主进程仍有完整 Node 权限，manifest 权限只约束平台工具调用。当前决定是继续使用独立 `utilityProcess` 作为隔离边界，进一步限制放到后续阶段；在此之前只应安装可信插件。
- **命令触发未接入**：`onCommand` 已在协议中保留，但宿主目前只激活 `onStartup`。
- **participant 输出协议未接入**：插件还不能向聊天 UI 输出结构化消息、工具卡片或进度。
- **安装流程未完成**：目前通过把插件目录放入 `userData/plugins` 安装，还没有市场、签名、哈希校验或权限安装确认。
- **第一方 agent loop 仍在渲染进程**：它是模块化的第一方实现，还没有作为插件加载；后续可用于验证“loop 在插件、能力在平台”。
- **B 层内置模块尚未落地**：当前新增的是平台能力、C 层宿主和第一方 agent 循环。

## 10. 关键文件

| 能力               | 位置                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| AI 流式与工具调用  | [src/main/ai.ts](../src/main/ai.ts)                                                                                   |
| 工具注册表         | [src/main/tool-registry.ts](../src/main/tool-registry.ts)                                                             |
| 平台工具           | [src/main/platform-tools.ts](../src/main/platform-tools.ts)                                                           |
| PDF 文本提取       | [src/main/pdf-text.ts](../src/main/pdf-text.ts)                                                                       |
| run 生命周期       | [src/main/ai-run.ts](../src/main/ai-run.ts)                                                                           |
| 工具/运行 IPC      | [src/main/ipc/tools.ts](../src/main/ipc/tools.ts)、[src/main/ipc/runs.ts](../src/main/ipc/runs.ts)                    |
| 第一方 agent loop  | [src/renderer/src/lib/agent-loop.ts](../src/renderer/src/lib/agent-loop.ts)                                           |
| 插件 manifest/发现 | [src/main/plugins/manifest.ts](../src/main/plugins/manifest.ts)、[discovery.ts](../src/main/plugins/discovery.ts)     |
| 插件宿主           | [src/main/plugins/runtime.ts](../src/main/plugins/runtime.ts)、[host-process.ts](../src/main/plugins/host-process.ts) |
| 插件协议与 API     | [src/main/plugins/protocol.ts](../src/main/plugins/protocol.ts)、[api.ts](../src/main/plugins/api.ts)                 |
| 插件设置界面       | [src/renderer/src/components/PluginSettings.vue](../src/renderer/src/components/PluginSettings.vue)                   |
