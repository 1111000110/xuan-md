# xuan-md

一个 Typora 风格的所见即所得 Markdown 编辑器（macOS / Windows，Electron + TypeScript）。

## 特性

- 所见即所得编辑：光标所在处显示 markdown 标记符，移开即渲染
- 标题、加粗、斜体、删除线、行内代码、链接、列表（有序/无序/任务，支持嵌套）
- 代码块语法高亮（highlight.js）、水平线
- 数学公式（KaTeX，行内 `$…$` 与块级 `$$…$$`）
- 表格：可视化单元格编辑，右键插入/删除行列
- Front Matter、多标签、源代码模式（`Cmd+/`）
- 文件关联：双击 `.md` 用本应用打开

## 开发

```bash
pnpm install
pnpm dev          # 启动开发（热更新）
pnpm typecheck    # 类型检查
pnpm build        # 构建产物
pnpm dist:mac     # 打包 macOS 应用
pnpm dist:win     # 打包 Windows x64 NSIS 安装包（需在 Windows 或 CI 中完成最终验证）
```
