# 插件视图（UI）

插件可以通过 `contributes.views` 提供一个沙箱化的 HTML 面板。面板显示在活动栏，按 `location` 占用主内容区或左侧栏。

## manifest

```json
{
  "id": "reader-bai.arxiv",
  "name": "arXiv",
  "version": "1.0.0",
  "engines": { "readerBai": "^1.0.0" },
  "activationEvents": ["onStartup"],
  "contributes": {
    "views": [
      {
        "id": "reader-bai.arxiv.panel",
        "title": "arXiv 检索",
        "location": "sidebar",
        "entry": "ui/index.html"
      }
    ]
  },
  "permissions": ["documents:read"]
}
```

- `id`：视图 id，至少两段，插件内唯一。
- `location`：`main` 替换主内容区，`sidebar` 替换左侧书库面板。
- `entry`：相对插件目录的 HTML 文件，不能是绝对路径或包含 `..`。
- 只有用户启用且宿主版本兼容的插件才会显示视图。
- 视图不要求声明 `main`；纯 UI 插件可以没有 `main`。
- 外部网络默认被 CSP 禁止；需要直连网络时声明 `network` 权限。

## 文件结构

```text
plugins/
└─ arxiv/
   ├─ manifest.json
   └─ ui/
      ├─ index.html
      └─ app.js
```

HTML 及其相对资源通过 `reader-bai-plugin://<plugin-id>/<entry>` 加载，只能读取该插件目录内的普通文件。

## 隔离

- iframe 使用 `sandbox="allow-scripts"`，没有 `allow-same-origin`，不能访问父页面 DOM、Cookie 或 `window.api`。
- 子 frame 导航只允许留在 `reader-bai-plugin://` 内。
- 默认 CSP：脚本/样式/字体只来自插件目录；`connect-src 'none'`；不能嵌套子 frame、表单提交或对象。
- 声明 `network` 后放行 `https:` 和本机回环的 `connect-src`，以及 https 图片/媒体。

## postMessage 协议

所有消息都发给父窗口：

```js
parent.postMessage(message, '*')
```

### 父窗口 → 插件：初始化

```js
{
  type: 'reader-bai:init',
  pluginId: 'reader-bai.arxiv',
  viewId: 'reader-bai.arxiv.panel',
  theme: 'light' | 'dark'
}
```

在 iframe `load` 后发送一次。

### 插件 → 父窗口：请求

```js
{
  type: 'reader-bai:request',
  requestId: 'req-1',
  method: 'tools.list' | 'tools.execute',
  params?: unknown
}
```

### 父窗口 → 插件：响应

```js
{ type: 'reader-bai:response', requestId: 'req-1', ok: true, result }
{ type: 'reader-bai:response', requestId: 'req-1', ok: false, error: '可读错误' }
```

`requestId` 最长 100 字符，由插件生成并原样返回。

## 可用能力

### `tools.list`

返回平台注册且对 AI 开放的工具列表。

### `tools.execute`

```js
{
  method: 'tools.execute',
  params: {
    name: 'library.list',
    input: {}
  }
}
```

主进程会按插件 manifest 的 `permissions` 校验工具的 `requiredPermissions`。写操作和破坏性操作仍由平台弹出确认，插件无法绕过。

当前不提供文件系统、设置、网络代理或任意 IPC；新增能力必须在主进程 `plugins/view-bridge.ts` 中显式加入并补权限校验。

## 示例

```html
<!-- ui/index.html -->
<h1>arXiv</h1>
<pre id="result">loading…</pre>
<script src="./app.js"></script>
```

```js
// ui/app.js
const result = document.getElementById('result')

parent.postMessage({ type: 'reader-bai:request', requestId: 'list-1', method: 'tools.list' }, '*')

window.addEventListener('message', (event) => {
  const data = event.data
  if (data?.type === 'reader-bai:init') {
    document.documentElement.dataset.theme = data.theme
  }
  if (data?.type === 'reader-bai:response' && data.requestId === 'list-1') {
    result.textContent = data.ok
      ? data.result.map((tool) => tool.name).join('\n')
      : `请求失败：${data.error}`
  }
})
```
