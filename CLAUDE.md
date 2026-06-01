# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

TaskTodo 是一个 Obsidian 插件，提供任务规划和今日视图。它依赖另一个插件 **TaskLite Core**（插件 ID: `taskslite`）作为宿主，通过 `host.ts` 中的 `getTaskLiteHost()` 获取宿主 API 实例。如果 TaskLite Core 未启用，插件会显示提示并停止工作。

## 常用命令

```bash
bun install          # 安装依赖（包管理器为 bun）
bun run dev          # 开发模式（esbuild watch）
bun run build        # 生产构建（tsc 类型检查 + esbuild 压缩打包）
bun run lint         # ESLint 检查（typescript-eslint + eslint-plugin-obsidianmd）
bun test             # 运行测试（bun 内置 test runner）
bun test <name>      # 运行单个测试文件
```

类型检查通过 `tsc -noEmit -skipLibCheck` 完成，lint 通过 `eslint .` 完成，测试通过 `bun test` 完成。

## 架构

- **`src/main.ts`** — 插件入口，注册 ribbon 图标和命令，激活 TaskTodo 视图
- **`src/host.ts`** — 定义 `TaskTodoHost` 和 `TaskTodoCoreApi` 接口，运行时从 Obsidian 插件系统中查找 TaskLite Core 实例
- **`src/taskLiteInterop.ts`** — 从 `host.ts` 重新导出公共类型；定义任务符号常量（`TASK_SYMBOLS`）、任务行序列化（`serializeTaskLine`）和日期工具
- **`src/taskTodo/taskListView.ts`** — 核心 UI：`TaskTodoTaskListView`（继承 `ItemView`），包含任务列表渲染、分组、子任务展开、编辑弹窗等全部视图逻辑
- **`src/taskTodo/taskTodoSort.ts`** — 任务排序逻辑：优先级 > 日期类型 > 日期值 > 深度 > 路径 > 行号
- **`src/i18n.ts`** — 国际化（en/zh），通过 `t(key)` 函数调用，自动根据 Obsidian locale 选择语言

## 关键设计

- 任务数据全部来自 TaskLite Core 的 `listTasks()` API，不直接读取 vault 文件
- 任务编辑通过 `openTaskLineModal` 弹窗（优先使用宿主的 `modalApi`，回退到内置的 `QuickTaskLineModal`）
- 视图通过 `queueRender()` 防抖（150ms）响应 vault 的 modify/create/delete/rename 事件
- 两个标签页："计划中"（有 scheduled 或 due 日期的任务）和"今日"（今日到期、计划今日、或在 start-due 区间内的任务）
- 任务符号遵循 Tasks 插件 emoji 约定（📅 due、⏳ scheduled、🛫 start 等）

## 项目约束

- 代码注释和文档使用中文
- TypeScript 严格模式（strictNullChecks、noImplicitAny 等），`baseUrl` 设为 `src`

### 版本更新与发布约束

- **每次更新版本要发布一个 pre-release**：当代码更改且需要发版时，必须修改版本号（如 `0.2.1-alpha.0` -> `0.2.1-alpha.1`），同步更新 `package.json`、`manifest.json` 和 `versions.json`，运行 `bun run build`，提交推送代码，打上对应的 git tag（如 `v0.2.1-alpha.1`）并推送，最后使用 GitHub CLI 创建 pre-release 并上传构建好的 `main.js`、`manifest.json`、`styles.css` 文件。

### 禁止直接读写笔记文件内容

**本插件不得直接读写 vault 文件内容（`app.vault.read/cachedRead/modify/create/delete`、`editor.replaceRange` 等），所有任务数据的增删改均必须通过 TaskLite Core API（`host.api.*`）进行，无任何例外。**

理由：
- 任务文件的读写逻辑由 TaskLite Core 统一维护（缓存、文档存储、并发安全）
- 绕过 API 直接写文件可能造成与 TaskLite 内部状态不一致

以下属于正常的 Obsidian 官方 API 用法，不在此约束范围内（均为只读或无副作用操作）：
- **`vault.on(event)`** — 事件监听，不读写文件内容，仅用于触发视图刷新
- **`vault.getMarkdownFiles()` / `vault.getFiles()`** — 只读的文件索引枚举，不涉及文件内容
