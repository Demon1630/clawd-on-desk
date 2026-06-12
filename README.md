# Clawd on Desk

一个 Windows 桌面宠物应用，基于原始项目 [rullerzhou-afk/clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) 整理而来。

这个版本在原桌宠能力上增加了 Codex 辅助信息展示：可以在桌宠旁边显示 Codex 额度状态，并在桌宠下方显示当前 Codex 会话的实时回复内容。

## 功能

- 桌面宠物悬浮显示
- 支持主题、动画、托盘菜单和基础设置
- 显示 Codex 5 小时额度和本周额度
- 根据当前时间进度提示额度是否使用偏快
- 显示当前 Codex 会话标题、运行状态和最新回复内容
- 读取 Codex transcript，支持回复过程中的实时内容刷新
- 支持本地桌面提醒，到点后通过系统通知和桌宠提示牌提醒
- 支持一键健康提醒，每小时第 50 分钟提醒起来走一下、喝点水
- 支持通过 iCloud CalDAV 与 Apple Calendar 双向同步提醒和日程
- 支持选择目标日历、同步所有日历、同步天数窗口和自动刷新频率
- 本地读取 Codex 状态，不上传额度、会话或 token

## 环境要求

- Windows 10 或 Windows 11
- Node.js 20 或更高版本
- npm
- Git
- 已安装并登录 Codex CLI

确认环境：

```powershell
node -v
npm -v
git --version
codex --version
```

如果 `codex --version` 无法运行，请先安装并登录 Codex CLI。额度和实时会话内容都依赖本机 Codex CLI 及其本地会话日志。

## 项目依赖

运行依赖写在 `package.json` 的 `dependencies` 中：

- `electron-updater`：Electron 自动更新相关能力
- `htmlparser2`：HTML / SVG 解析
- `koffi`：Windows 原生能力调用
- `ws`：WebSocket 通信

开发和打包脚本会通过 `npx` 调用：

- `electron`
- `electron-builder`

首次运行时请先安装依赖：

```powershell
npm install
```

## 本地运行

```powershell
git clone https://github.com/Demon1630/clawd-on-desk.git
cd clawd-on-desk
npm install
npm start
```

也可以使用：

```powershell
npm run dev
```

## 打包

生成未安装目录包：

```powershell
npm run pack
```

生成正式安装包：

```powershell
npm run build
```

打包产物通常会输出到 `dist/` 或 Electron Builder 配置对应的输出目录。仓库不会提交这些产物。

## Codex 额度显示

额度显示依赖本机 Codex CLI。应用会尝试通过本地 Codex 能力读取账户 rate limit 信息，并展示：

- 5 小时额度
- 本周额度
- 剩余额度百分比
- 重置时间
- 是否比理论使用进度更快

“超前 N 个百分点”的含义是：当前实际已用额度，比按时间推算的理论已用额度多了 N 个百分点。

例如 5 小时额度理论上每小时使用 20%。如果距离重置还有 3 小时，理论已用约 40%；实际已用 52%，则会显示超前 12 个百分点。

## 实时会话内容

桌宠下方的会话卡片会读取 Codex transcript 文件，并展示当前会话的最新 assistant 输出。

这部分依赖：

- Codex 正在本机运行
- Codex 已生成本地 transcript
- Clawd 能从 session snapshot 中拿到 `transcript_path`

如果只显示“正在运行”，通常说明暂时没有读到可展示的 assistant 文本，或当前 Codex 版本的 transcript 结构发生了变化。

## 桌面提醒

在设置窗口的“提醒”页可以创建、编辑、完成、延后或删除提醒。提醒数据保存在本机偏好设置中，到点后会：

- 弹出 Windows 系统通知
- 在桌宠旁边显示提醒提示牌
- 在应用后台运行时继续检查提醒

提醒包含标题、时间和可选备注。已完成的提醒不会继续弹出，到点后仍未完成的提醒会显示为已超时。

提醒页还提供“一键健康提醒”开关。开启后，Clawd 会在每个小时的第 50 分钟提醒你起来走一下、喝点水；该提醒不会写入普通提醒列表，也不会同步到 Apple Calendar。

## Apple Calendar 同步

“提醒”页内置 Apple Calendar 同步区域，可通过 iCloud CalDAV 将 Clawd 提醒与 Apple Calendar 日程双向同步。

使用前需要准备：

- Apple ID
- Apple 账号的“应用专用密码”
- 已在 iCloud 中启用日历

同步能力包括：

- Clawd 中新增或修改的提醒会写入 Apple Calendar
- Apple Calendar 中新增或修改的日程会导入 Clawd 提醒
- 在任一侧删除已同步项目后，下次同步会删除另一侧对应项目
- 可选择一个目标日历作为默认写入日历
- 可开启“同步所有日历”，让 Clawd 读取并刷新所有可用日历
- 可设置同步天数窗口，避免一次导入过多历史日程或节假日
- 可设置自动刷新频率，也可以手动点击“立即同步”

说明：

- Apple ID 和应用专用密码只保存在本机，使用 Electron `safeStorage` 加密后写入用户数据目录。
- “同步所有日历”开启后，目标日历选择不再限制读取范围；Clawd 会扫描所有可用 Apple Calendar。
- 同步窗口只导入未来指定天数内的日程，默认 7 天。

## 常见问题

### 启动时报 `Cannot find module`

请先确认已经安装依赖：

```powershell
npm install
```

如果是修改已安装版的 `app.asar` 后出现该问题，通常是重新打包时漏掉了 `node_modules/`。应基于完整源码或完整备份重新打包，不要只打包精简源码目录。

### 额度显示为 `Codex --`

可能原因：

- Codex CLI 没有安装
- Codex CLI 没有登录
- 本机找不到 `codex.exe`
- Codex 的 rate limit 接口返回结构发生变化

先确认：

```powershell
codex --version
```

### 会话卡片没有实时刷新

可能原因：

- 当前会话还没有 assistant 输出
- transcript 路径没有进入 session snapshot
- Codex transcript 结构变化
- 应用还没有重启到最新版本

可以先重启应用，再开一个新的 Codex 对话测试。

### Apple Calendar 无法同步

可先检查：

- 是否使用的是 Apple“应用专用密码”，不是 Apple ID 登录密码
- Apple ID 是否已经开启双重认证
- iCloud 日历里是否至少有一个可写日历
- 设置页里是否已保存凭据并开启 Apple Calendar 同步
- 同步天数窗口是否覆盖了要导入的日程日期

## 项目结构

- `src/`：Electron 主进程、预加载脚本、渲染层、状态管理和界面逻辑
- `hooks/`：Codex、Claude Code 等工具的 hook 脚本
- `agents/`：不同 agent 的定义和日志监听逻辑
- `assets/`：图标、声音、SVG 等资源
- `themes/`：桌宠主题资源
- `pwa/`：PWA 相关资源
- `extensions/`：编辑器扩展相关文件

## 不提交的内容

以下内容不会提交到仓库：

- `node_modules/`
- `dist/`
- `out/`
- `.tmp/`
- `*.asar`
- `*.asar.backup-*`
- `*.log`

## 原始项目

本项目基于 [rullerzhou-afk/clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) 整理和修改。

请保留原始项目来源说明，方便后续使用者了解项目来源和分支关系。
