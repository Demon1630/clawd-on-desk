# Clawd on Desk

Clawd on Desk 是一个 Windows 桌面宠物 Electron 应用，用来把你的 Codex / Claude Code 会话状态挂到桌面上。

这个仓库是在原始项目 `rullerzhou-afk/clawd-on-desk` 基础上整理出来的版本，保留了桌宠本体，同时补上了更适合日常使用的状态展示：

- 桌宠旁边显示 Codex 额度
- 额度支持 5 小时 / 本周两个窗口
- 额度用得比理论进度快时会有提示
- 桌宠下方显示当前会话的实时内容与状态

## 运行环境

- Windows 10 / 11
- Node.js 20+
- 已安装 Codex CLI

## 开发运行

```bash
npm install
npm start
```

## 说明

- 这是一个 Electron 桌面应用，首次启动会依赖本机 Codex CLI 和会话日志。
- 如果你想自己打包，可以先确认 Electron 相关依赖已安装，再运行打包命令。
- 仓库里不包含 `node_modules/`、打包产物和本机临时文件。

## 项目结构

- `src/` - Electron 主进程、预加载脚本、渲染层和界面样式
- `assets/` - 图标、音效和图片资源
- `hooks/` - 各类模型/代理的会话钩子和日志监控
- `agents/` - 代理定义和分类逻辑
- `themes/` - 桌宠主题资源
- `pwa/` - 相关 Web/PWA 资源

## 原始项目

原始项目：`rullerzhou-afk/clawd-on-desk`

如果你想继续维护这个仓库，建议保留这个 README 里的“原始项目”说明，方便其他人知道来源和分支关系。
