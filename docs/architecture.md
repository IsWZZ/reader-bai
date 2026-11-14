# 架构与产品方向

本文记录 `reader-bai` 已经确定的产品版图和技术方向。新增功能、重构和代码评审都应以这里的约束为准；它与 [CLAUDE.md](../CLAUDE.md) 互补，CLAUDE.md 描述现状，本文描述目标。

## 产品定位

`reader-bai` 最终不是一个 PDF 阅读器，而是一个**学术论文工作台**。固定的能力版图：

| 能力                     | 状态     | 提供方式                       | 说明                                                                                           |
| ------------------------ | -------- | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| 论文阅读                 | 已有基础 | 平台核心                       | 本地书库、空间、PDF 渲染、文本选择、高亮/下划线                                                |
| 论文翻译与基础 AI 对话   | 已有基础 | 平台核心                       | 选区翻译、流式对话、多模型配置；保持轻量、开箱即用；高级 agent 与领域工具由插件提供            |
| 个人本地论文知识库       | 还未开发 | 内置模块                       | 全文索引、向量检索、引用与笔记管理；依赖重，可关闭、懒加载                                     |
| 基于云端数据库的论文查找 | 还未开发 | 内置模块 + 第三方插件 + 云服务 | 产品入口内置；arXiv、Semantic Scholar、Crossref、CNKI 等作为可安装的检索源插件；检索代理在云端 |
| 论文写作                 | 还未开发 | 内置模块 + 第三方插件          | 编辑器与引用插入内置；文档格式、模板、导出（LaTeX/Word/BibTeX）由插件提供                      |
| 论文推荐                 | 还未开发 | 内置模块 + 云服务              | 客户端入口内置，推荐计算在云端后端                                                             |
| 论文社区                 | 还未开发 | 内置模块 + 云服务              | 客户端模块内置；账号、内容、同步在云端                                                         |

基本原则：**本地优先**。阅读、管理、标注、本地知识库在离线状态下可用；云能力（查找、推荐、社区、账号同步）是可选增强，不可成为启动或阅读的前置条件。

## 能力分层（四层模型）

“插件化”解决的是**代码边界**，不等于所有能力都做成可安装的第三方插件。按下面的四层划分：

| 层                          | 定位                                             | 分发与生命周期                | 可卸载         | 例子                                                                      |
| --------------------------- | ------------------------------------------------ | ----------------------------- | -------------- | ------------------------------------------------------------------------- |
| **A. 平台核心**             | 阅读主路径，轻量、离线可用、开箱即用             | 随安装包发布，始终启用        | 否             | 书库、PDF 阅读、标注、基础翻译/AI 对话、设置、本地书库搜索                |
| **B. 内置模块（内置插件）** | 走统一的贡献接口，可关闭、懒加载，但不面向第三方 | 随安装包发布，可在设置中关闭  | 可关闭，不卸载 | 本地知识库、云端查找入口、写作、推荐入口、社区客户端                      |
| **C. 第三方插件**           | 可替换的实现或生态扩展                           | 插件市场 / 本地安装           | 是             | AI agent、模型提供商、检索源、引用格式、导出格式、翻译引擎、Zotero 等集成 |
| **D. 云端服务**             | 账号、同步、推荐、社区、检索代理等后端能力       | 独立服务，客户端通过 API 访问 | 非插件         | 账号系统、推荐服务、社区后端                                              |

区分 B 和 C 的意义：

- **B 和 A 是同一个信任级别**，不经过插件市场、不需要权限弹窗，也不做沙箱；但 B 仍要按扩展接口组织、可整体关闭、不能绕过平台服务直接写核心数据。
- **C 才需要完整插件宿主**：manifest、权限声明、API 版本、沙箱/异常隔离、安装与卸载流程。
- 不要为了“插件化”把核心产品体验拆成第三方插件；也不要因为能力较重就都塞回核心。先定层，再定接口。

## 分层判断规则

新增能力时依次判断：

1. 是否在离线阅读的关键路径上？→ **A**
2. 是否是必须始终可用的产品差异点？→ **B**（走贡献接口，但不做第三方分发）
3. 是否需要账号或云端数据？→ **D 服务 + B 薄客户端**
4. 是否有多个可替换实现或第三方生态？→ **C**
5. 是否依赖重、需要按需安装、权限敏感？→ **B 或 C**，懒加载

## 核心设计原则

1. **Electron 只是平台。** 主进程负责窗口、生命周期、文件系统、系统集成、安全存储、网络代理和自动更新；业务能力不往 `src/main/index.ts` 里堆。
2. **核心轻量内置。** 书库、阅读、标注、基础翻译与 AI 对话属于 A 层，必须轻量、开箱即用、不要求可卸载。
3. **内置模块与第三方插件分开。** B 层与 A 同信任级，用贡献接口接入、可关闭；C 层才进入插件宿主，具备 manifest、权限和沙箱。
4. **可替换实现插件化。** 有多种实现、第三方愿意贡献、生命周期独立的能力（检索源、模型提供商、导出格式等）放 C 层。
5. **云能力后端化。** 账号、推荐、社区、检索代理属于 D 层，客户端只保留薄接口，并支持离线降级。
6. **单向依赖。** 模块与插件依赖平台 API；平台不 import 任何具体功能。功能之间不直接 import，通过命令、事件或共享服务通信。
7. **数据隔离。** 核心文件（`library.json`、`annotations.json`、`settings.json`）只由平台维护；B/C 的数据放在自己的命名空间，避免污染和互相阻塞迁移。

## 目标分层

| 层                         | 职责                                                    | 落点（现在 / 以后）                                      |
| -------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| Electron 平台              | 窗口、菜单、生命周期、协议、文件、加密、更新、安全策略  | `src/main`（现在）                                       |
| 平台服务                   | 书库、标注、设置、AI 网关、事件总线、命令系统、模块存储 | `src/main` + `src/preload`（逐步抽出）                   |
| 平台核心能力（A）          | 书库、阅读、标注、翻译/AI 对话                          | 现在和以后都在 `src/main` + `src/renderer/src`，保持轻量 |
| 内置模块（B）              | 知识库、云端查找入口、写作、推荐入口、社区客户端        | 未来 `src/modules/*`，随应用分发                         |
| 插件宿主 + 第三方插件（C） | 发现、加载、权限、进程隔离；检索源、格式、提供商等      | 宿主已有 `src/main/plugins`；`plugins/*` 插件生态待开发  |
| 云端服务（D）              | 账号、同步、推荐、社区、检索代理                        | 独立后端仓库/服务，不在本仓库                            |
| 渲染外壳                   | 布局、活动栏、面板槽位、命令面板、通知                  | `src/renderer/src`（收缩为壳）                           |

当前代码是“外壳 + 内置功能”的混合体，这是阶段性状态。阅读和翻译会长期留在 A 层，但需要逐步与外壳解耦、按域组织；B 层复用同一套贡献接口；完整的插件宿主只用于 C 层。

## 需要预留的扩展点

- **命令（commands）**：所有用户动作注册为稳定的 command id，可被快捷键、菜单、命令面板、内置模块或插件调用。
- **视图（views）**：活动栏图标 + 侧栏 / 底部 / 主区域槽位；面板开关和宽度由外壳管理，内容由内置模块或插件提供。
- **数据提供者（providers）**：论文元数据、本地/云端搜索源、推荐源、AI 模型提供商、写作素材与导出格式。
- **设置贡献（settings）**：模块或插件向设置页注册 section，设置 schema 由贡献方声明。
- **事件（events）**：`paper-opened`、`selection-changed`、`annotation-created`、`command-executed` 等，避免功能之间轮询或互相 import。
- **存储（storage）**：按模块/插件 id 命名空间的读写 API，带容量与格式校验。
- **网络（network）**：统一经主进程代理，便于审计、CORS 处理和密钥不出主进程。
- **AI 网关（ai）**：模型配置、上游 Key、供应商适配、流式与 tool-call 归一化都在主进程；模块和插件只拿到带作用域的模型句柄，不直接持有 Key。
- **工具（tools）**：平台命令自动暴露为工具；模块和插件可以贡献自己的工具。统一 JSON Schema、风险等级、来源和权限校验。
- **运行（runs）**：即使 agent loop 在插件里，平台仍为每次运行分配 `runId`，负责取消、步数/token 预算、超时和审计。
- **聊天参与者（chat participants）**：插件向工作台注册聊天 agent，通过统一输出协议渲染 markdown、工具卡片、进度和用量；确认弹窗由平台提供。

## 贡献接口与插件清单

B 层内置模块与 C 层第三方插件使用同一套贡献结构（`contributes`），区别在分发和运行时约束：

|           | B 内置模块           | C 第三方插件                          |
| --------- | -------------------- | ------------------------------------- |
| 分发      | 随安装包             | 插件市场 / 本地安装                   |
| 信任级别  | 与核心相同           | 不可信，默认拒绝                      |
| 权限声明  | 不需要               | manifest 中显式声明                   |
| 沙箱/隔离 | 无（按代码规范约束） | 受限渲染环境，逻辑优先独立进程/Worker |
| 卸载      | 关闭入口             | 可安装/卸载                           |
| 数据访问  | 平台服务             | 平台注入的受限 API                    |

C 层插件 manifest 草案（字段名可以调整，但信息必须完整）：

```json
{
  "id": "reader-bai.arxiv-source",
  "version": "1.0.0",
  "engines": { "readerBai": "^1.0.0" },
  "activationEvents": ["onCommand:search.arxiv"],
  "contributes": {
    "commands": [{ "id": "search.arxiv", "title": "在 arXiv 中查找" }],
    "searchSources": [{ "id": "arxiv", "title": "arXiv" }],
    "settings": [{ "id": "arxiv", "title": "arXiv 检索" }]
  },
  "permissions": ["network", "storage"]
}
```

约束：

- 插件 UI 只拿到宿主注入的 API，不直接使用 `window.api`、Node 或文件系统。
- 插件逻辑优先放在独立进程/Worker 中，崩溃不能拖垮外壳；至少要做到异常隔离和可卸载。
- 外部插件安装需要来源校验与签名/哈希校验，安装前展示所需权限。
- 未安装或未启用的模块/插件，相关入口必须优雅降级（例如当前没有 AI 配置时辅助面板给出配置提示）。

## AI 能力分层与插件化

AI 不整体做成插件，也不全部写死在平台。目标是“平台提供能力，插件提供 agent”：后续可以接入类似 Claude Code 的插件，由插件自己实现 agent loop，平台只负责模型访问、平台能力、权限和运行边界。

### 职责划分

| 职责                                                   | 平台核心（A） | AI 插件（B/C） |
| ------------------------------------------------------ | ------------- | -------------- |
| 上游 Key、认证、供应商适配、SSE 解析、tool-call 归一化 | 是            | 否             |
| 模型列表、能力查询、用户授权、用量统计与限额           | 是            | 只读           |
| agent loop、prompt、规划、工具编排                     | 否            | 是             |
| run 生命周期：`runId`、取消、预算、超时、审计          | 是，管边界    | 只调用         |
| 工具注册表、schema 校验、风险分级、权限与确认          | 是            | 可贡献工具     |
| 论文读取、书库、标注、导航、搜索                       | 是            | 通过 API 调用  |
| 聊天 UI 外壳、工具卡片、确认弹窗                       | 是            | 通过协议输出   |
| 复杂自定义 UI                                          | 提供沙箱槽位  | 是             |

### 原则

1. **平台不运行 agent loop。** 插件自己决定 prompt、步骤和工具组合；平台只提供模型网关、工具、状态、事件和运行边界。不要把 agent loop 写死在主进程，否则插件只能换 prompt，不能真正扩展。
2. **上游 API Key 永不进入插件。** 插件拿到的是带作用域的模型句柄，或平台本地 OpenAI 兼容网关的本地 URL + 一次性 token。插件自己的第三方服务密钥走插件命名空间存储，与平台 Key 隔离。
3. **工具调用统一走 ToolRegistry。** 平台命令自动暴露为工具；插件可以声明自己的工具；外部 MCP 工具后期接入同一注册表。所有调用都带来源、`runId` 和风险等级。
4. **确认发生在工具执行边界。** 删除论文、删除标注、改设置等动作由平台拦截并请求用户确认，不能只依赖聊天 UI，也不能信任插件自行确认。即使插件自己渲染界面，平台仍然能在工具执行前拦住。
5. **模型请求归一化。** 平台把各家的流式文本和 `tool_calls` 拼装成统一事件；插件不直接解析 SSE，也不绑定某家供应商的 SDK。不支持工具调用的模型要优雅降级。
6. **运行可观测。** 即使 loop 在插件里，平台仍记录 run、步数、token、工具调用和确认结果；用户可以取消，平台可以限额。

### 插件侧 API 草案

字段名可以调整，但信息必须完整：

```ts
interface AiApi {
  /** 当前插件被允许使用的模型 */
  listModels(): Promise<ModelInfo[]>
  /** agent run 的边界：预算、取消、审计都由平台记录 */
  startRun(options: RunOptions): AgentRun
}

interface AgentRun {
  readonly id: string
  readonly signal: AbortSignal
  chat(request: ChatRequest): AsyncIterable<ChatEvent>
  cancel(reason?: string): void
}

type ChatEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; callId: string; name: string; arguments: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; reason: 'stop' | 'tool-calls' | 'length' | 'aborted' | 'error' }
```

插件侧的典型循环：

```ts
const run = reader.ai.startRun({ maxSteps: 12 })
const messages = [{ role: 'user', content: '把第 3 页关于 attention 的句子高亮' }]

for (let step = 0; step < 12 && !run.signal.aborted; step++) {
  const reply = await collect(run.chat({ messages, tools }))
  if (reply.toolCalls.length === 0) break

  messages.push({ role: 'assistant', toolCalls: reply.toolCalls })
  for (const call of reply.toolCalls) {
    const result = await reader.tools.execute(call, run.signal)
    messages.push({ role: 'tool', toolCallId: call.id, content: result.content })
  }
}
```

聊天 UI 通过 participant 协议输出 markdown、工具卡片、进度和用量，工作台负责渲染；插件不能直接控制确认弹窗。工具确认与权限校验在 `reader.tools.execute` 的执行边界完成。

### 与当前内置 AI 的关系

内置的基础翻译和对话仍属于 A 层，但必须走同一套模型网关和 participant 协议，不允许存在只给内置功能使用的私有通道。高级 agent、深度研究工作流和领域工具优先做成 B/C 层插件，这样公开 API 会被持续验证。

### 当前已落地的基础

还不是完整的插件宿主，但先把 agent 需要的平台边界立住了：

- `src/main/ai.ts`：OpenAI 兼容接口的流式文本和 `tool_calls` 归一化为 `StreamChatResult`；工具参数分片会拼装完整后再返回；旧的 `streamChatCompletion` 保留为只取文本的兼容包装。
- `src/main/ai-anthropic.ts`：Anthropic Messages API（`/v1/messages`）适配层，负责消息/工具定义转换和 SSE 事件解析，输出与 `ai.ts` 相同的 `StreamChatResult`；由配置里的 `provider` 选择。
- `src/main/ai-run.ts`：`startRun` 创建单个 run，提供 `runId`、取消、步数/token 预算和超时；run 由 agent runtime 保存，也会传给 `ai-request.ts` 计步，不通过 IPC 暴露。
- `src/main/ai-request.ts`：单次模型请求的执行边界，负责解析配置、解密 Key、校验 Base URL、解析工具 schema、计步和取消；翻译与 agent 宿主共用。
- `src/main/tool-registry.ts`：工具注册、JSON Schema、风险等级、AI 暴露白名单、`authorize`/`onInvoke` 钩子。
- `src/main/platform-tools.ts`：第一批平台工具 `library.list`、`paper.get`、`paper.readPage`、`annotations.list/add/remove`；只读工具直接执行，写入和删除默认拒绝，必须经过确认钩子。
- `src/main/pdf-text.ts`：主进程侧的 PDF 单页文本提取，pdfjs 按需动态加载，限制文件大小和解析超时；渲染进程和插件都不需要直接读文件。
- `src/main/ipc/tools.ts`：`tools:list` / `tools:execute` 执行边界；渲染进程只能按名字调用已注册工具，写操作由主进程弹出确认弹窗，插件无法跳过。
- `src/main/ipc/ai.ts`：`ai:chat` 只负责翻译，接收消息、配置 id 和请求 id，返回文本；工具 schema 不能由渲染进程伪造。
- `src/main/agent/`：第一方 agent loop（模型 → 工具 → 模型）运行在独立的 `agent-host` `utilityProcess` 中。主进程负责会话、run 预算、超时、工具白名单、Key 和事件转发，宿主只按会话请求模型和工具；渲染进程只调 `agent:start/cancel` 并订阅 `agent:event`。
- `AssistantPanel.vue` + `store/assistant.ts`：对话可开启“工具”模式，只使用平台判定为只读且对 AI 开放的工具，并在气泡下方展示工具调用记录；停止对话时取消会话，模型增量、工具事件和最终结果都通过 `agent:event` 返回。

后续接入扩展宿主时，插件 API 直接复用这些边界；不需要重写 SSE 解析，也不需要把 agent loop 搬进主进程。

### 插件宿主现状

C 层已从“只发现”推进到“独立进程执行”，但进程隔离不等于安全沙箱：

- `src/main/plugins/manifest.ts`：manifest 校验（id/version、`engines.readerBai`、激活事件、命令贡献、权限白名单、入口路径不越界）；未知字段一律拒绝。
- `src/main/plugins/discovery.ts`：扫描 `userData/Userdata/plugins` 的真实子目录，跳过符号链接，单个插件损坏只记录 issue。
- `src/main/plugins/host.ts` + `src/main/ipc/plugins.ts`：第三方插件默认关闭，启用状态写入 `userData/Userdata/plugins.json`；不兼容当前版本的插件不能启用。`runtimePlugins()` 只返回已启用、版本兼容且声明了 `main` 的入口。
- `src/main/plugins/protocol.ts`：主进程与扩展宿主的消息协议；只接受 `ready/status/log/api-request/stopped`，API 方法限定为 `tools.list` / `tools.execute`，并限制字段长度和参数体积。
- `src/main/plugins/runtime.ts`：用 `utilityProcess.fork` 启动 `out/main/plugin-host.js`，插件启停后整体重载宿主；宿主崩溃、启动失败和退出都会反映为运行状态。工具请求在主进程侧按 manifest 权限放行，写操作仍经过确认弹窗。
- `src/main/plugins/host-process.ts`：扩展宿主入口，动态 import 插件 `main`，只激活声明了 `onStartup` 的插件（`onCommand` 暂保持 inactive），激活/停用都有 10 秒超时；向插件注入 `pluginId`、权限、`log` 和受限的 `tools` API。
- `src/main/plugins/api.ts`：插件作者契约（`PluginContext` / `PluginModule` / `missingToolPermissions`）。
- 平台工具带 `requiredPermissions`：读工具要求 `documents:read`，标注写工具要求 `documents:read` + `annotations:write`；插件未声明时主进程直接拒绝。
- `PluginSettings.vue` + `store/plugins.ts`：设置页展示插件、权限、命令、manifest 错误和宿主运行状态（未启动/启动中/运行中/启动失败），并负责启停；`plugins:runtime` 与 `plugins:runtime-changed` 提供状态。
- 已知边界：扩展宿主目前是带完整 Node 权限的 utilityProcess，manifest 权限只约束平台工具调用，不能阻止插件直接读文件或访问网络。现阶段保持插件在独立宿主进程中运行，不退回主进程或进程内模块；命令触发、participant 输出协议和真正的 OS 级限制（Node 权限模型、能力进程或系统沙箱）后续再补，在此之前只应安装可信插件。

### AI 插件安全约束

- 论文正文视为不可信输入；agent 默认只读，写操作逐次确认，防止 PDF 中的提示注入。
- 插件默认不直接访问网络；需要访问自有后端的，在 manifest 声明域名并在启用时告知用户。
- `documents:read` 与 `network` 同时授予时，用户必须知道论文内容可能离开本机。
- 按插件、按 run、按天限制 token 和步数；插件不能绕过平台配额。
- 需要 shell、进程或文件系统能力的 agent 单独定级，默认不授予。

## 数据与安全边界

- API Key、账号令牌等敏感信息只在主进程解密和使用；第三方插件拿不到明文，只能通过平台服务发起请求。
- 应用数据统一放在 `userData/Userdata`：`library.json`、`annotations.json`、`settings.json`、`plugins.json` 直接放在这层，内容较多的 `papers/` 和 `plugins/` 各有独立子目录，与 Electron/Chromium 在 `userData` 根目录生成的缓存和配置分开，便于备份和迁移。导入 PDF 时默认复制一份到 `Userdata/papers` 作为论文库副本，原文件保留；用户显式选择其他存储目录后，新副本才写到该目录。设置页的「存储」分区只清理 Electron 的 HTTP、代码和 DNS 缓存，不删除 `Userdata` 下的应用数据；卸载入口独立成「卸载」分区。
- 威胁模型、当前防护、已知风险和加固顺序见 [security.md](security.md)。新增 IPC、文件访问、网络请求和插件能力时按其中的检查清单执行。
- 任何模块或插件都不得直接写 `library.json` / `annotations.json`；对书库的修改必须走平台 API 并经过校验。
- 云端能力默认关闭，开启前说明会发送哪些数据；本地知识库索引不自动上传。
- 所有来自渲染进程、内置模块或插件的数据在进入主进程时都视为不可信，沿用现有的结构化克隆 + 字段校验模式。

## 路线阶段

1. **阅读与本地书库**（A，已有基础）：导入、空间、渲染、标注、持久化。
2. **翻译与 AI 对话**（A，已有基础）：选区翻译、流式对话、多模型配置。
3. **平台化改造**：抽出命令、视图槽位、事件总线、模块存储等贡献接口，把阅读/翻译按域与外壳解耦但保留在 A 层；同时把 AI 请求收进主进程网关，补上工具注册表和 run 边界；此时还不引入第三方插件宿主。
4. **AI 插件宿主**（进行中）：扩展宿主进程、manifest/激活事件、工具权限与确认已落地；下一步补 participant 输出协议、命令触发和真正的插件沙箱，并接入第一个第一方 agent 插件验证“loop 在插件、能力在平台”。
5. **本地知识库**（B）：全文索引、向量检索、笔记/引用管理，作为可关闭的内置模块接入。
6. **云端查找与推荐**（B + C + D）：内置查找/推荐入口，检索源与推荐策略作为可替换插件，后端在云端；离线时优雅降级。
7. **写作与社区**（B + C + D）：写作编辑器与社区客户端内置，文档格式/模板/导出走插件，账号、同步与内容在云端。

每个阶段的验收标准：

- A 层：始终可用，不要求可卸载，但只能依赖平台 API 和共享服务。
- B 层：可以整体关闭且不影响阅读主路径，通过贡献接口接入，懒加载重依赖。
- C 层：可以在不修改核心代码的情况下安装/卸载，权限受控、崩溃隔离。
- D 层：不可用时，所有相关入口给出可读提示，不阻塞本地功能。
- AI 网关：上游 Key 不出主进程；内置 AI 与插件使用同一套模型接口；不支持工具调用的模型能优雅降级。
- AI 插件：agent loop 在插件内；平台能按 run 取消、限额和审计；写操作在执行边界确认；插件拿不到平台 Key。

## 对当前代码的约束

在贡献接口和插件宿主落地之前，先按下面的规则写代码，避免加深耦合：

- 新增能力前先判定属于 A/B/C/D 哪一层；不要把产品核心体验直接做成第三方插件，也不要继续堆进 `Home.vue` 或 `PdfViewer.vue`。
- 新功能做成独立组件 + store，通过 props / 事件与外壳通信；跨功能不要互相 import store，用共享 store、事件或平台服务。
- 新增 IPC 通道按 `<domain>:<action>` 命名，并在 preload 暴露**最小**接口；主进程负责校验。
- 设置项按域组织（如已有的 `ai`），不要把所有模块/插件的配置平铺进根对象。
- 需要长任务（索引、下载、模型请求）时走主进程或 Worker，不要在渲染主线程阻塞 UI。
- 网络请求集中在主进程，渲染进程不直接 `fetch` 外部服务。
- AI 请求统一走 `src/main/ai.ts` 的网关；不在组件或插件里直接 `fetch`、解析 SSE 或绑定某家供应商的 SDK。新增模型能力先做网关归一化，再暴露给插件。
- 工具和动作必须带 JSON Schema、风险等级和来源；删除、批量修改等破坏性操作一律在执行边界确认。
- 上游 API Key 不进入渲染进程、插件、日志或错误信息；插件自有密钥按插件命名空间隔离。
