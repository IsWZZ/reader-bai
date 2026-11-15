<div align="center">

# READER-BAI

**A local-first desktop reading and research workbench for academic papers**

[![CI](https://github.com/IsWZZ/reader-bai/actions/workflows/ci.yml/badge.svg)](https://github.com/IsWZZ/reader-bai/actions/workflows/ci.yml)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vue.js&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

Import PDFs, organize them spatially, read and save highlights and underlines; select a passage to
translate, and summon streaming AI chat at any time.

Offline-first — reading, library management, and annotations need no network; all cloud features are optional.

[English](README.en.md) | [中文](README.md)

</div>

---

## Features

| Module                 | Description                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| 📚 Local library       | Import PDFs, organize by spaces, search, and manage metadata                                |
| 📖 PDF reading         | Lazy rendering, zoom, and cross-page text selection powered by pdf.js                       |
| 🖍 Annotations          | Highlights and underlines, persisted per paper                                              |
| 🌐 Selection translate | Click a word or double-click a sentence to send it to the side assistant panel              |
| 🤖 AI assistant        | Multiple model configs, streaming chat, metadata extraction on import (AI + Crossref)       |
| 🧩 Plugin system       | Manifest validation, permission declarations, separate-process host, sandboxed plugin views |

> Currently at the stage where layer A (platform core) and layer C (third-party plugin host) have
> basic capabilities. Layer B built-in modules and layer D cloud services are not yet developed; see
> [Product direction](#product-direction) below.

## Tech Stack

| Category | Choice                                            |
| -------- | ------------------------------------------------- |
| Desktop  | Electron 44                                       |
| UI       | Vue 3 (`<script setup lang="ts">`) + TypeScript   |
| Build    | electron-vite                                     |
| Styling  | Tailwind CSS v4 + shadcn-vue                      |
| PDF      | pdfjs-dist                                        |
| State    | Pinia + Vue Router                                |
| Testing  | Vitest, Vue Test Utils, Playwright (Electron E2E) |

## Getting Started

Requires Node.js 22+, npm, and one of macOS / Windows / Linux.

```bash
git clone git@github.com:IsWZZ/reader-bai.git
cd reader-bai
npm install
npm run dev
```

`npm install` downloads the Electron binary and rebuilds native dependencies through `postinstall`,
so the first install takes a while.

## Commands

| Command             | Description                                           |
| ------------------- | ----------------------------------------------------- |
| `npm run dev`       | Start development mode                                |
| `npm run build`     | Type check + build                                    |
| `npm run build:mac` | Package for macOS (also `build:win` / `build:linux`)  |
| `npm run lint`      | ESLint check (`lint:fix` auto-fixes)                  |
| `npm run format`    | Prettier formatting                                   |
| `npm run typecheck` | Four type-check passes: node / web / test / e2e       |
| `npm test`          | Run unit and component tests                          |
| `npm run test:e2e`  | Build, then run Electron E2E with Playwright          |
| `npm run test:all`  | Full pre-release check: lint + typecheck + unit + E2E |

## Project Structure

```text
reader-bai/
├─ src/
│  ├─ main/            # Electron main process: IPC, persistence, AI gateway, plugin host
│  ├─ preload/         # Minimal window.api bridge and type declarations
│  └─ renderer/        # Vue 3 renderer: library, reader, AI panel, settings
├─ tests/              # unit / component / e2e
├─ docs/               # Architecture, security, PDF, plugin views, testing
├─ build/ resources/   # Packaging resources
└─ out/                # Build output (not committed)
```

Each of the three processes has its own conventions file: [main](src/main/CLAUDE.md),
[preload](src/preload/CLAUDE.md), [renderer](src/renderer/CLAUDE.md).

## Product Direction

The long-term goal of `reader-bai` is an academic paper workbench, organized in four layers:

| Layer                      | Contents                                                                              | Status         |
| -------------------------- | ------------------------------------------------------------------------------------- | -------------- |
| **A. Platform core**       | Library, reading, annotations, basic translation / AI chat                            | Basic support  |
| **B. Built-in modules**    | Knowledge base, cloud lookup entry points, writing, recommendations, community client | Planned        |
| **C. Third-party plugins** | Replaceable implementations such as search sources, model providers, export formats   | Host available |
| **D. Cloud services**      | Account, sync, recommendations, community and search proxy backend                    | Planned        |

Layering rules, extension points, and roadmap phases are in [docs/architecture.md](docs/architecture.md).

## Security

- API keys, tokens, file paths, and network requests exist only in the main process; the renderer never sees plaintext keys.
- The renderer does not touch Node or the filesystem, and treats `window.api` as potentially `undefined`.
- File reads are limited to paths already registered in the library; external links are restricted to `http(s)`, and navigation and new windows are denied by default.
- Plugin logic runs in a separate `utilityProcess`; plugin UI runs in a sandboxed iframe without `allow-same-origin`.

Full boundaries and the hardening checklist are in [docs/security.md](docs/security.md).

## Documentation

- [Architecture and product direction](docs/architecture.md)
- [Security design](docs/security.md)
- [PDF viewer](docs/pdf-viewer.md)
- [Plugin views](docs/plugin-views.md)
- [Testing conventions](docs/testing.md)
- [Repository development conventions](CLAUDE.md)

## Contributing

Run `npm run test:all` before submitting. New features should come with tests at the matching layer
(unit / component / E2E), and new main-process IPC needs the corresponding preload method and
`index.d.ts` type declarations.
