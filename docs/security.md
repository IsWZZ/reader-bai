# 安全模型与加固清单

本文记录 `reader-bai` 的安全边界、现有防护和已知风险。新增 IPC、文件访问、网络请求、内置模块或第三方插件时，先对照本文。

## 威胁模型

阅读器要同时面对这些输入，默认都不可信：

- **PDF 文件**：来自互联网或他人，可能包含恶意链接、异常结构或超大页面。
- **渲染进程**：运行 UI 和 PDF 渲染。任何 XSS、依赖漏洞或被注入的脚本都应被视为已失守，不能让它直接触达文件系统、密钥或其他应用数据。
- **用户配置**：Base URL、模型名等可以指向任意主机，错误配置会把 Key 发到非预期服务。
- **内置模块（B 层）**：与平台同信任级，但仍只能通过平台 API 访问核心数据。
- **第三方插件（C 层）**：不可信，默认拒绝；需要 manifest、权限声明、沙箱和来源校验。
- **云端服务（D 层）**：可选能力，默认关闭；发送哪些数据必须可解释、可关闭。

## 信任边界

| 边界            | 规则                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Main ↔ Renderer | 渲染进程视为不可信；所有 IPC 参数在主进程校验，不信任类型、长度、路径和枚举值                                        |
| Preload         | 只暴露最小 `window.api`；不暴露 Node、`ipcRenderer`、`electronAPI` 或文件系统                                        |
| 核心数据文件    | `library.json` / `annotations.json` / `settings.json` 只由平台服务读写，模块和插件不得直接修改                       |
| 密钥            | API Key、令牌等只在主进程解密和使用；渲染进程只需要知道“是否已配置”                                                  |
| 文件访问        | 导入只走系统文件对话框；读取只允许论文库中已登记的路径；不接受渲染进程传来的任意路径                                 |
| 网络            | 渲染进程不直接请求外部服务；AI、检索、更新等统一走主进程代理                                                         |
| 插件            | 插件运行在独立 utilityProcess，拿不到 `window.api`；平台工具按 manifest 权限放行。宿主目前仍有 Node 权限，见已知风险 |

## 现有防护

- [window.ts](../src/main/window.ts) 开启 `sandbox` 和 `contextIsolation`，关闭 `nodeIntegration` 与 `webviewTag`；生产环境关闭 DevTools。
- [index.html](../src/renderer/index.html) 通过 CSP 限制资源：`default-src 'self'`、`script-src 'self'`、`worker-src 'self' blob:`，渲染进程无法连接外部地址。
- 新窗口请求和主窗口导航一律拒绝，只有 `http(s)` 链接交给系统浏览器，避免在应用内加载任意页面或打开本地文件。
- `session.setPermissionRequestHandler` / `setPermissionCheckHandler` 默认拒绝摄像头、麦克风、通知、剪贴板等权限。
- Preload 只暴露 `window.api`，不暴露 `electronAPI`、Node 或文件系统。
- `paper:read` 校验路径属于论文库；`dialog:importPaper` 只接受文件对话框的结果，不接受渲染进程指定任意路径。
- 导入时把文件复制到论文库目录（默认 `userData/data/papers`），目录只能通过 `dialog:chooseDirectory` 的原生对话框选择；`library.directory` 在主进程校验为绝对路径，非法值拒绝写入。
- 标注的新增和删除同样校验论文库归属。
- AI 请求只在主进程发起（[ai.ts](../src/main/ai.ts)、[ipc/ai.ts](../src/main/ipc/ai.ts)），Key 不经过 `ai:chat` 参数；消息在进入主进程时校验角色、条数和总长度。
- AI Base URL 只允许 HTTPS；仅 `localhost` / `127.0.0.1` / `[::1]` 可使用 HTTP，保存和发起请求时都会校验。
- Key 优先用 Electron `safeStorage` 加密后落盘，见 [settings-store.ts](../src/main/settings-store.ts)；系统安全存储不可用时 `settings:get` 返回 `keyStorage: 'plaintext'`，设置页会明确提示 Key 将以明文保存。
- `settings:get` 只返回 `hasApiKey`，不返回明文或密文 Key；`settings:update` 中未带 `apiKey` 的配置保留原有 Key，新增配置必须填写。
- 已有 Key 的配置一旦更改 origin（协议、主机、端口），`settings:update` 会先弹出主进程原生确认；取消则整体拒绝保存。
- 设置、书库和 AI 消息都有规范化逻辑，异常文件按空数据降级，不会导致启动失败。
- 未发现 `v-html`、`innerHTML`、`eval` 等直接注入点。
- 插件代码只在 `utilityProcess` 扩展宿主中执行，不进入渲染进程或主进程；宿主消息经过协议校验，API 方法限定为 `tools.list` / `tools.execute`，字段和参数有长度上限。插件调用工具时按 manifest 的 `requiredPermissions` 校验，写操作仍由主进程弹出确认。
- E2E 使用临时 `--user-data-dir`，测试不会读写真实用户数据；密钥使用假值。

## 已知风险与加固顺序

### 已修复

1. **`settings:get` 不再回传 API Key。** 渲染进程只拿到 `hasApiKey`；编辑时 Key 输入框留空，不填写表示保留原 Key。
2. **Preload 不再暴露 `window.electron`（`electronAPI`）。** 渲染进程只有 `window.api`，相关调试日志已删除。
3. **渲染进程已开启 `sandbox: true`。**
4. **主窗口导航已拦截。** `will-navigate` 一律阻止，不把应用导航到任何外部地址。
5. **`shell.openExternal` 已加协议白名单。** 只放行 `https:` / `http:`。
6. **默认权限请求已拒绝。**
7. **AI Base URL 已要求 HTTPS。** 只有本机回环地址可以使用 HTTP。
8. **更改已有 Key 的配置地址需要原生确认。** 渲染进程无法绕过主进程的确认框把 Key 引到新主机；路径变化不触发确认。
9. **`annotations:list` 已补上论文库归属校验。** 与 `add` / `remove` 一致，非书库路径一律拒绝。
10. **标注写入与读取都已逐字段校验。** id、类型、颜色、页码、文本长度和归一化坐标在主进程校验；读盘时坏条目被跳过，不会拖垮整个标注库。
11. **`safeStorage` 明文降级已对用户可见。** 系统安全存储不可用时设置页提示 Key 将以明文保存；该设置文件仍不应纳入任何同步。

### P1：待处理

1. **扩展宿主不是安全沙箱（现阶段仍保留独立 utilityProcess）。** [host-process.ts](../src/main/plugins/host-process.ts) 运行在 `utilityProcess` 中，只能隔离崩溃和主进程状态，插件 JS 仍可 `require('fs')`、`require('net')` 或读取 `process.env`；manifest 权限只约束平台工具调用。当前决定是不把插件拉回主进程、也不改成进程内模块，继续以独立宿主进程作为隔离边界；Node 权限模型、能力进程或 OS 级沙箱等进一步限制放到后续阶段。在补齐这些限制和安装来源校验/签名之前，应只安装可信插件。不要因为插件声明了权限就把它当成已隔离。

### P2：持续清理

4. CSP 的 `style-src` 含 `'unsafe-inline'`。当前由 Vue/Tailwind 运行时样式需要；引入自定义样式时优先使用 class，逐步收紧。
5. 依赖与更新链路：保持锁文件提交，定期跑 `npm audit`，跟 Electron 安全版本；C 层插件必须有签名或哈希校验，安装前展示权限。当前 `npm audit --omit=dev` 为 0；开发依赖仍有 eslint / minimatch 链路的 moderate 告警，升级前先确认工具链兼容。

## 新增 IPC 检查清单

- 通道名使用 `<domain>:<action>`，preload 只加一个窄方法，不暴露通用 `invoke(channel, ...)`。
- 主进程校验每个参数：类型、非空、长度、枚举、数值范围；错误信息不回显 Key、绝对路径等敏感内容。
- 路径类参数只接受论文库中已登记的路径；需要新路径时用系统对话框产生。
- 返回值只包含渲染进程真正需要的字段；密钥类字段默认不返回。
- 长任务支持取消和超时，并在窗口销毁时中止；流式回调前检查 `event.sender.isDestroyed()`。
- 发送前剥离 Vue 代理，测试同时覆盖成功、非法输入和失败路径。
- 不通过日志输出密钥、令牌、选区正文和论文内容。

## 模块与插件

- **B 层内置模块**：与 A 层同信任级，但仍必须走平台 API；不得直接读写核心数据文件，不得绕过 AI/网络代理拿 Key。
- **C 层第三方插件**：默认不可信。manifest 声明权限；逻辑优先独立进程或 Worker；拿不到 `window.api`、Node 和文件系统；网络、存储、UI 都通过宿主注入的受限 API。
- **云端能力**：默认关闭；开启前说明上传内容；账号令牌只在主进程持有；离线时所有入口优雅降级。
- 插件崩溃或异常不能拖垮外壳；安装、升级、卸载都要有来源校验和权限展示。

## 验证

- 安全相关改动至少补一条 E2E 或单元测试：非法路径、非法 IPC 参数、缺少 Key、Key 不出现在渲染进程返回值中。
- E2E 继续使用独立临时 `--user-data-dir` 和假 Key，禁止连接真实 AI 服务。
- 发布前检查：CSP 未被放宽、导航与权限处理器生效、生产构建关闭 DevTools、`npm audit` 无未处理的高危项。
