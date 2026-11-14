# src/preload/CLAUDE.md

Preload 指引。仓库级规则见 [根 CLAUDE.md](../../CLAUDE.md)；这里只约束主进程与渲染进程之间的桥。

## 定位

- `index.ts` 是唯一的桥接入口，只做 `contextBridge.exposeInMainWorld('api', api)`。
- Preload 运行在 `sandbox` + `contextIsolation` 下，是渲染进程的唯一权限出口；不要把它当成业务层。
- 不暴露 `electronAPI`、`ipcRenderer`、`require`、`process`、Node 或文件系统；不提供通用的 `invoke(channel, ...args)`。

## 接口规则

- 每个 IPC 对应一个窄方法，通道名写死，参数和返回值使用明确类型。
- 不在 preload 里做参数校验、业务判断、文件访问、网络请求或密钥处理；这些都在主进程。
- 不记录参数、返回值或密钥；错误让 `invoke` 原样 reject，由渲染进程决定如何提示。
- 跨桥数据必须是可结构化克隆的普通对象；不要传函数、类实例、Vue 代理或循环引用。
- 事件订阅（如 `onAiChunk`、`onPluginRuntime`）必须返回取消函数，并且只移除自己注册的监听，避免重复订阅和泄漏。
- 新方法必须和主进程 handler 同名对应；不要为了省事把多个通道包成一个通用方法。

## 类型同步

- `Api`、方法参数和返回值定义在 `index.ts`，并在 `index.d.ts` 中声明 `window.api: Api | undefined`。
- 应用数据类型变化时，同时更新 [src/renderer/src/types.ts](../renderer/src/types.ts)。
- 保持 `index.d.ts` 是模块（包含 `export {}`），否则 `declare global` 不会作为模块扩展生效。
- 渲染进程可能拿不到 `window.api`，类型保持可选，不要假设它一定存在。

## 安全默认

- `settings:get` 只暴露 `hasApiKey` / `keyStorage`，不暴露 Key 的明文或密文。
- 不把主进程的绝对路径、内部错误堆栈或插件宿主内部状态透传给渲染进程，除非页面确实需要。
- 新增方法先确认渲染进程真的需要调用；只给主进程用的能力不要出现在 `window.api` 上。

## 验证

- 新增或修改桥接方法时，同步补 E2E：正常调用、非法参数、失败路径。
- E2E 继续断言 preload 只暴露 `window.api`，不存在 `window.electron`。
- 订阅类方法在组件卸载后不再触发回调。
