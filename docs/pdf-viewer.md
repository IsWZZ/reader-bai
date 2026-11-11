# PDF 阅读器模块规则（PdfViewer）

`src/renderer/src/components/PdfViewer.vue` 是最大的组件，负责 pdf.js 渲染、缩放、文本选择与注释。修改前先看这里的约束。

## 职责与输入

- 唯一 prop 是 `src`：论文在磁盘上的绝对路径。
- 文件读取和注释持久化全部通过 `window.api`（主进程会校验路径属于论文库）。
- 页面结构：canvas（像素渲染）+ `.pdf-text-layer`（透明文本层，用于选区）+ 注释覆盖层（`pointer-events-none`）。

## 渲染管线

- `loadDocument()` 是唯一入口：递增 `generation` → 取消旧任务 → 销毁旧 `loadingTask` → `api.readPaper()` → `pdfjsLib.getDocument({ data })`。
- 加载后先取所有页在 `scale=1` 下的尺寸填入 `pageSizes`，保证占位高度和滚动条正确；此时不绘制内容。
- **懒渲染**：`IntersectionObserver`（root 为滚动容器，`rootMargin: 200px`）触发 `scheduleRender`，只渲染可视区附近的页。所有页共用一条串行的 `renderQueue`，避免多页同时绘制卡顿主线程。
- `renderPage()` 按容器宽度计算 viewport，canvas 的 backing store 乘以 `devicePixelRatio`，CSS 尺寸用逻辑像素；同一页的 `RenderTask` 会先取消再重绘。
- 每处 `await` 之后都要检查 `currentGeneration === generation`，避免切换论文/缩放后旧任务覆盖新状态。新增异步步骤时保持这个模式。
- `renderedWidths` 记录每页最近渲染宽度，宽度没变就跳过重复渲染。

## 缩放与布局

- `zoom = 1` 表示适应容器宽度；范围 0.5–3，步进 1.2。实际页宽 = `availableWidth * zoom`。
- 缩放时先取消所有渲染、更新 canvas 的 CSS 占位尺寸，再重新渲染可视页；`pendingSelection` 会清空。
- `ResizeObserver` 先同步更新 canvas 尺寸，再 debounce 300ms 并用 `requestIdleCallback` 重绘；容器宽度为 0（面板开合中）时直接忽略。
- pdf.js worker 必须在 `src/renderer/src/lib/pdf.ts` 中内联（`?worker&inline`），否则打包后的 `file://` 环境加载不到 worker。解析 PDF 元数据标题时要创建独立 worker 并销毁，不能影响阅读器共用的那个。

## 选区：单击选词、双击选句

- 监听器挂在 `document` 上（`mousedown` / `mouseup` / `dblclick`），在 `onMounted` 注册、`onBeforeUnmount` 移除。工具栏按钮的 `mousedown` 需要 `@mousedown.prevent`，否则点击按钮会清空选区。
- `handleMouseUp` 在拖动超过 4px 或 `event.detail !== 1` 时不做选词，把拖拽交给浏览器原生选区。
- 单击选词：`textNodeAt` + `WORD_CHAR`（Unicode 字母/数字/`'`/`’`/`_`/`-`），坐标来自 `caretPositionFromPoint`（回退 `caretRangeFromPoint`）。
- 双击选句（`selectSentenceAtPoint`）依赖文字层的排版信息，不要退化成整页字符串扫描：
  1. `buildLines`：按垂直重叠 > 50% 且水平间距不超过 1.5 倍行高把 span 聚成视觉行，行字号取行内最大值（上标不干扰）。
  2. `collectBlockLines`：只取与点击行**字号相同（容差 8%）且连续**的行。标题、作者、脚注字号不同，天然被排除。
  3. 若点击行字号 ≥ 页面行字号中位数 × 1.4，视为标题，整块选中相邻的同字号行（`headingBlockLines`）。
  4. `buildBlockText`：按阅读顺序拼接，行间换行；段落开头用空行标记（缩进 > 0.5em 或垂直留白 > 0.9em，但换栏不算）；行内短标签（如 `Abstract`、`Keywords`，且前一段不超过 20 字符）与大间距正文之间也插入空行；同一行内 span 间距 > 0.15em 时补一个空格，因为 pdf.js 会把词间空格切掉。
  5. `sentenceRangeAt`：向两侧找最近的句末符号，空行是硬边界。句号判断会跳过小数、邮箱/网址（句号后紧跟字母数字）、常见缩写，并处理 `51.6°S.` 这类非空白前缀的首字母缩写。

## 注释（高亮 / 下划线）

- `getSelectionOnPage()` 只接受**同一页**内的选区，返回 `{ pageNumber, rects, text }`；跨页目前不支持。
- 选区矩形会归一化为相对页面宽高的 `0..1` 坐标（`mergeRects`），**持久化必须存归一化坐标**，不能存像素，否则缩放/窗口变化后无法对齐。
- `mergeNormalizedRects` 先按垂直重叠分行，再合并同一行中水平相邻的片段，避免同一行拆成多个色块或下划线出现“双线”。
- 覆盖层用百分比定位；高亮色为 `#facc15`（带透明度 + `mix-blend-mode: multiply`），下划线色为 `#ef4444`。
- 新增注释前会去重（同页、同类型、同文本、同矩形）；通过 IPC 发送前要转成普通对象，Vue 响应式代理无法结构化克隆。
- “取消标记”按当前选区与已有注释矩形的重叠判断要删除的注释，再按 id 删除。

## 修改时注意

- 不要把整页/整文档一次性渲染，也不要另加滚动监听；懒渲染依赖 `IntersectionObserver` + 渲染队列。
- 不要移除 `generation` 检查或跳过 `RenderTask.cancel()`。
- 文本选择依赖 pdf.js 生成的 span 结构；升级 pdfjs-dist 后重点回归单击选词、双击选句、拖拽选区和注释对齐。
- 注释覆盖层必须保持 `pointer-events-none`，否则会挡住文本层。
