# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

`reader-bai` is an Electron desktop PDF reader for academic papers. Users import PDFs into a local library, organize them into spaces, read them, and keep highlights/underlines per paper. The renderer is Vue 3 + TypeScript (`<script setup>`), styled with Tailwind CSS v4 and shadcn-vue components, with PDF rendering handled by pdfjs-dist.

## Common Commands

### Development

```bash
npm run dev          # Start development server with HMR
```

### Building

```bash
npm run build        # Type check and build for production
npm run build:win    # Build for Windows
npm run build:mac    # Build for macOS
npm run build:linux  # Build for Linux
npm run build:unpack # Build without packaging
```

### Code Quality

```bash
npm run lint         # Run ESLint with caching
npm run lint:fix     # Run ESLint and auto-fix issues
npm run format       # Run Prettier to format code
npm run typecheck    # Run both Node and Web type checking
npm run typecheck:node  # Type check main and preload processes
npm run typecheck:web   # Type check renderer (Vue) code
```

### Preview

```bash
npm run start        # Preview production build
```

There is no test suite; verify changes with typecheck, lint and a manual run.

## Architecture

### Three Processes

1. **Main** (`src/main/index.ts`) — window creation and all persistence/file access. Writes `library.json` and `annotations.json` under `app.getPath('userData')`. Paper reads and annotation writes are checked against library records.
2. **Preload** (`src/preload/index.ts`, `index.d.ts`) — context isolation bridge. Exposes `window.electron` (electron-toolkit) and `window.api`; `index.d.ts` declares the `Api` interface and shared data shapes.
3. **Renderer** (`src/renderer/src/`) — Vue app. It never touches Node APIs or the filesystem directly; everything goes through `window.api` (treat it as possibly `undefined`).

### Renderer Layout

- `views/Home.vue` — app shell. Owns `currentPaper` plus library open/width state; composes the panels below. Routing is a single hash route (`router/index.ts`).
- `components/LibraryPanel.vue` — spaces and paper list: import, rename, delete, drag-and-drop between spaces, PDF-metadata title backfill.
- `components/PdfViewer.vue` — pdf.js rendering, zoom, text layer, click/double-click selection and the annotation overlay. See [docs/pdf-viewer.md](docs/pdf-viewer.md) before changing it.
- `components/ActivityBar.vue`, `components/Toolbar.vue` — window chrome.
- `components/ui/**` — shadcn-vue (reka-ui) components; treat as generated code and keep local edits minimal.
- `lib/pdf.ts` — shared pdf.js worker setup and PDF metadata title parsing.
- `types.ts` — renderer-side copies of library data types.

### IPC and Persistence

Renderer APIs live in `src/preload/index.ts` and map 1:1 to `ipcMain.handle` channels:

- Library: `library:list`, `library:createSpace`, `library:renameSpace`, `library:deleteSpace`, `library:renamePaper`, `library:movePaper`, `library:removePaper`
- Files: `dialog:importPaper`, `paper:read`
- Annotations: `annotations:list`, `annotations:add`, `annotations:remove`

Data rules:

- `library.json` is `{ spaces, papers }`. `normalizeLibrary` migrates the old array-only format and fills missing fields; keep this path working.
- `annotations.json` is keyed by paper path: `{ [paperPath]: PaperAnnotation[] }`.
- Removing a paper or a space never deletes PDFs from disk; deleting a space moves its papers to uncategorized.
- `titleSource` (`file` | `metadata` | `user`) prevents metadata backfill from overwriting user renames.

When adding an IPC feature, update all three layers: handler in `src/main/index.ts`, method in `src/preload/index.ts`, type in `src/preload/index.d.ts` (plus `src/renderer/src/types.ts` if it is app data). Renderer-facing data must be structured-cloneable — strip Vue reactive proxies before sending.

### Path Aliases and Styling

- `@renderer/*` and `@/*` → `src/renderer/src/*` (Vite and `tsconfig.web.json`).
- Tailwind CSS v4 is wired through `@tailwindcss/vite`; theme tokens live in `assets/css/reset.css`, imported by `assets/css/index.css`. There is no `tailwind.config` file.
- shadcn-vue configuration is in `components.json`; UI components import `cn` from the `cn` package.

### PDF Viewer Constraints

Detailed rules: [docs/pdf-viewer.md](docs/pdf-viewer.md). The critical ones:

- Keep the pdf.js worker inline (`?worker&inline`); a URL-based worker breaks the packaged `file://` build.
- Rendering is lazy and generation-guarded. Preserve the generation checks and render-task cancellation when touching load, zoom or resize.
- Text selection and annotations are single-page only. Annotation rectangles are persisted as normalized `0..1` page coordinates, never pixels.
- Do not move selection listeners off `document` or change click/double-click semantics without checking the viewer doc.

## Code Style

- Prettier: single quotes, no semicolons, 100 char line width, no trailing commas.
- ESLint extends @electron-toolkit configs with Vue support; `**/out` and `**/dist` are ignored.
- All Vue components must use TypeScript (`<script lang="ts">`, enforced by ESLint).
- Prefer the Composition API and `<script setup lang="ts">` for new components.
