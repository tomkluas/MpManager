# 开发与测试

## 环境

项目支持 Windows、macOS 和 Linux，需要 Node.js 22.19.0 或更高版本，推荐 Node.js 24。Windows 使用 PowerShell 脚本，macOS/Linux 使用 Bash 脚本。应用使用原生 Node.js HTTP、SQLite 和浏览器 JavaScript，不需要前端编译。

主要依赖见 `app/package.json`：

- `markdown-it`：Markdown 安全渲染；
- `fflate`：DOCX 压缩包读取；
- `fast-xml-parser`：DOCX XML 校验与解析。

首次克隆后在仓库根目录执行：

```powershell
./Setup.ps1
```

macOS/Linux 对应命令：

```bash
bash ./setup.sh
```

安装脚本先按 `app/package-lock.json` 安装应用依赖，再安装固定版本 OpenClaw。统一配置位于根目录 `.env`，模板为 `.env.example`。

## 启动开发实例

在仓库根目录执行：

```powershell
./Start.ps1
```

macOS/Linux 对应命令：

```bash
bash ./start.sh
```

启动脚本检查系统 Node.js 版本，加载根目录 `.env` 后执行 `app/src/server.mjs`。服务默认监听 `127.0.0.1:4330`，可用 `APP_PORT` 修改；自动化测试通过 `startServer({port, dataDir})` 注入临时端口和数据目录。

快速检查：

```powershell
Invoke-WebRequest http://127.0.0.1:4330/ -UseBasicParsing |
  Select-Object StatusCode, StatusDescription
```

## 源码导航

| 路径 | 职责 |
| --- | --- |
| `app/src/server.mjs` | HTTP 入口和组件组合 |
| `app/src/workflow.mjs` | 内容任务状态机与断点续跑 |
| `app/src/store.mjs` | SQLite 对象存储与并发保护 |
| `app/src/agent-runtime.mjs` | 模型子进程、限额代理和调用账本 |
| `app/src/content-tools.mjs` | 文档导入、Markdown 渲染与稿件资源组合 |
| `app/src/cover-agent.mjs` | 火山图片生成与结果校验 |
| `app/src/browser*.mjs` | 平台浏览器连接、页面识别和只读操作 |
| `app/src/wechat-*.mjs` | 微信编辑器状态确认和草稿保存 |
| `app/src/scheduler.mjs` | 周期内容和发布后数据任务 |
| `app/public/` | 无构建步骤的浏览器页面 |
| `app/tests/` | Node.js 测试 |

## 运行测试

```powershell
Set-Location app
npm.cmd test
```

macOS/Linux：

```bash
cd app
npm test
```

完整测试覆盖存储、工作流恢复、模型费用保护、文档导入、图片校验、账号状态、微信草稿、手工发布登记、调度器和 HTTP 接口。

测试约定：

- 外部模型和平台操作应使用注入的本地替身，不产生真实发表动作。
- 涉及 SQLite 的测试使用临时目录，测试结束后清理。
- 修改状态机时同时验证正常路径、重启恢复、并发请求和结果不明四类情况。
- 定向测试通过不能表述为全量测试通过；交付前在 `app/` 运行完整 `npm test`。

## 修改原则

- 新状态必须明确哪些操作可重试，哪些结果不明时必须停止。
- 任何付费调用都要先持久化额度占用，再发出外部请求。
- 平台“草稿已保存”和“文章已发表”是两个不同状态，不能互相替代。
- 用户上传的资源必须校验所属产品、文件类型、内容哈希和允许的本地路径。
- 页面新增写接口时，沿用现有同源令牌校验，不绕过 `server.mjs` 的统一入口。

## 不应提交的内容

`app/data/`、`app/logs/`、`node_modules/`、`.env`、Paperclip 状态和真实产品材料均已被 Git 忽略。提交前仍应检查 `git status`，避免把密钥、数据库、平台回执或用户文档加入版本控制。
