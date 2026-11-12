# reader-bai

面向学术论文的桌面工作台（Electron + Vue 3 + TypeScript）。当前已提供本地书库、PDF 阅读、高亮/下划线、选区翻译与流式 AI 对话。

长期的学术论文工作台方向还包括本地知识库、云端论文查找、写作、推荐与社区，按四层组织：平台核心（书库、阅读、标注、翻译/AI）轻量内置；知识库、云端查找入口、写作、推荐、社区客户端作为随应用发布、可关闭的内置模块；检索源、AI 提供商、导出格式等可替换实现作为第三方插件；账号、同步、推荐和社区后端属于云端服务。设计约束、扩展点和路线阶段见 [docs/architecture.md](docs/architecture.md)。

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS
$ npm run build:mac

# For Linux
$ npm run build:linux
```
