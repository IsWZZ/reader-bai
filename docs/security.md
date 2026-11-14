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

- [window.ts](../src/main/window.ts) 开启 `contextIsolation`，未开启 `nodeIntegration`；生产环境关闭 DevTools。
- [index.html](../src/renderer/index.html) 通过 CSP 限制资源：`default-src 'self'`、`script-src 'self'`、`worker-src 'self' blob:`，渲染进程无法连接外部地址。
- 新窗口请求被拒绝，改用系统浏览器打开，避免在应用内加载任意页面。
- `paper:read` 校验路径属于论文库；`dialog:importPaper` 只接受文件对话框的结果，不接受渲染进程指定任意路径。
- 导入时把文件复制到论文库目录（默认 `userData/papers`），目录只能通过 `dialog:chooseDirectory` 的原生对话框选择；`library.directory` 在主进程校验为绝对路径，非法值拒绝写入。
- 标注的新增和删除同样校验论文库归属。
- AI 请求只在主进程发起（[ai.ts](../src/main/ai.ts)、[ipc/ai.ts](../src/main/ipc/ai.ts)），Key 不经过 `ai:chat` 参数；消息在进入主进程时校验角色、条数和总长度。
- Key 优先用 Electron `safeStorage` 加密后落盘，见 [settings-store.ts](../src/main/settings-store.ts)。
- 设置、书库和 AI 消息都有规范化逻辑，异常文件按空数据降级，不会导致启动失败。
- 未发现 `v-html`、`innerHTML`、`eval` 等直接注入点。
- 插件代码只在 `utilityProcess` 扩展宿主中执行，不进入渲染进程或主进程；宿主消息经过协议校验，API 方法限定为 `tools.list` / `tools.execute`，字段和参数有长度上限。插件调用工具时按 manifest 的 `requiredPermissions` 校验，写操作仍由主进程弹出确认。
- E2E 使用临时 `--user-data-dir`，测试不会读写真实用户数据；密钥使用假值。

## 已知风险与加固顺序

### P0：优先处理

1. **`settings:get` 会把解密后的 API Key 回传给渲染进程。**
   [settings-store.ts](../src/main/settings-store.ts) 的 `toPublic` 会解密每条配置，设置面板和 Pinia 因此持有明文 Key。一旦渲染进程被 XSS 或恶意扩展攻破，Key 会直接泄露。
   目标形态：渲染进程只拿到 `hasApiKey` 或掩码；用户编辑时留空表示“保持原 Key”，只有输入新 Key 时才通过 `settings:update` 上传。未配置 Key 的提示改为基于 `hasApiKey` 判断。
2. **Preload 额外暴露了 `window.electron`（`electronAPI`）。**
   当前渲染进程并未使用它，但它包含比 `window.api` 大得多的 IPC 面。只保留 `window.api`，删除 `electronAPI` 的暴露和日志。

### P1：平台加固

3. **`sandbox: false`。** 当前 preload 在关闭沙箱的渲染进程中运行。确认 `@electron-toolkit/preload` 与现有 API 在 `sandbox: true` 下可用后开启；开启前保持 `contextIsolation` 和最小 preload。
4. **缺少主窗口导航拦截。** 只拦截了新窗口，没有阻止主窗口 `will-navigate`。PDF 或页面中的链接不应把应用导航到远程站点，应拒绝非应用自身地址的导航。
5. **`shell.openExternal` 没有协议白名单。** 只允许 `https:` / `http:`（必要时再显式放开特定协议），拒绝 `file:`、自定义协议和可执行内容。
6. **没有拒绝默认权限请求。** 应设置 `session.setPermissionRequestHandler`，默认拒绝摄像头、麦克风、通知、剪贴板等权限，确有需要时再按 origin 精确放开。
7. **AI Base URL 允许任意 `http://` 主机。** Key 会发往用户填写的地址。默认要求 HTTPS，仅对 `localhost` / `127.0.0.1` 放开 HTTP 便于本地模型；发送前展示目标主机，配置错误时给出明确提示。
8. **`safeStorage` 不可用时退化为明文存储。** 这是可接受的降级，但必须让用户可见：设置页提示“系统安全存储不可用，Key 将以明文保存”，并避免把该文件纳入任何同步。
9. **扩展宿主不是安全沙箱。** [host-process.ts](../src/main/plugins/host-process.ts) 运行在 `utilityProcess` 中，只能隔离崩溃和主进程状态，插件 JS 仍可 `require('fs')`、`require('net')` 或读取 `process.env`；manifest 权限只约束平台工具调用。在引入 Node 权限模型、能力进程或 OS 级沙箱之前，应只安装可信插件，并优先补上安装来源校验与签名。不要因为插件声明了权限就把它当成已隔离。

### P2：持续清理

10. `annotations:list` 未校验论文库归属，与 `add` / `remove` 不一致；统一走同一个归属检查。
11. 标注对象目前只依赖结构化克隆，未逐字段校验 `type`、`color`、`page`、`rects` 范围和文本长度；补上后再写入。
12. CSP 的 `style-src` 含 `'unsafe-inline'`。当前由 Vue/Tailwind 运行时样式需要；引入自定义样式时优先使用 class，逐步收紧。
13. 依赖与更新链路：保持锁文件提交，定期跑 `npm audit`，跟 Electron 安全版本；C 层插件必须有签名或哈希校验，安装前展示权限。

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
