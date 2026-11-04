# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

An Electron application built with Vue 3 and TypeScript using electron-vite as the build tool.

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

## Architecture

### Three-Process Architecture

This Electron app follows the standard three-process architecture:

1. **Main Process** (`src/main/`) - Node.js process that manages windows and system interactions
2. **Preload Scripts** (`src/preload/`) - Bridge between main and renderer with context isolation
3. **Renderer Process** (`src/renderer/`) - Vue 3 web application

### Path Aliases

- `@renderer/*` → `src/renderer/src/*` (configured in both Vite and TypeScript)

### Key Files

- `electron.vite.config.ts` - Vite configuration for all three processes
- `src/main/index.ts` - Main process entry, creates BrowserWindow
- `src/renderer/src/main.ts` - Vue app entry point
- `src/renderer/src/router/index.ts` - Vue Router configuration (hash history)
- `src/preload/index.ts` - Exposes APIs to renderer via contextBridge

### IPC Communication

The preload script exposes two global objects to the renderer:

- `window.electron` - Standard electron API from @electron-toolkit/preload
- `window.api` - Custom APIs (extend in `src/preload/index.ts`)

Current IPC handlers:

- `ping` → logs `pong` (example handler in `src/main/index.ts`)

### TypeScript Configuration

- `tsconfig.json` - Root config with project references
- `tsconfig.node.json` - Main + preload processes
- `tsconfig.web.json` - Renderer (Vue) code

Vue components must use `<script lang="ts">` (enforced by ESLint).

## Code Style

- Prettier: single quotes, no semicolons, 100 char line width, no trailing commas
- ESLint extends @electron-toolkit configs with Vue support
- All Vue components must use TypeScript (`<script lang="ts">`)
