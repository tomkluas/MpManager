# Paperclip 本地任务面板

此目录提供可选的 Paperclip 本地任务面板接入。它不负责生成内容或自动发表，未安装时不影响主工作台。

Paperclip 需要 Node.js 24.11 或更高版本。首次使用先在仓库根目录安装依赖：

```powershell
./Setup.ps1 -IncludePaperclip
```

macOS/Linux：

```bash
bash ./setup.sh --paperclip
```

然后按照 Paperclip 官方 `onboard` 流程初始化实例，并确保配置文件位置与根目录 `.env` 中的 `PAPERCLIP_CONFIG` 一致。初始化完成后将 `PAPERCLIP_ENABLED` 改为 `true`。

在项目根目录另开 PowerShell 窗口运行：

```powershell
./research/runtime-lab/Start-Lab.ps1
```

macOS/Linux：

```bash
bash ./research/runtime-lab/start-lab.sh
```

面板地址为 <http://127.0.0.1:4320>。服务已运行时不要重复启动。

## 保留内容

- `state/paperclip/`：Paperclip 的 PostgreSQL 数据、配置和本地密钥。
- `node_modules/`：由 Windows `Setup.ps1 -IncludePaperclip` 或 macOS/Linux `setup.sh --paperclip` 安装的固定版本 Paperclip。
- `config/`、`materials/` 和 `.env`：工作台首次导入旧资料时使用的本地来源。
- `package.json` 和 `package-lock.json`：需要重装依赖时使用。

`npm-cache/`、旧模型实验状态、验证产物和一次性实验脚本已清理；它们不参与当前服务启动。
