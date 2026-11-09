# 运行与数据安全

## 启动与停止

在仓库根目录启动工作台：

```powershell
./Start.ps1
```

macOS/Linux 使用 `bash ./start.sh`。工作台地址与停止方式相同。

工作台地址：<http://127.0.0.1:4330>。

启动脚本在当前窗口前台运行。关闭窗口或按 `Ctrl+C` 会停止服务；业务数据已经写入 SQLite，重新启动后继续使用。不要同时启动两个工作台实例，它们会争用 4330 端口和同一数据目录。

可选 Paperclip 面板单独启动：

```powershell
./research/runtime-lab/Start-Lab.ps1
```

macOS/Linux 使用 `bash ./research/runtime-lab/start-lab.sh`。

Paperclip 地址：<http://127.0.0.1:4320>。它不可用时，工作台仍可独立运行，任务镜像会跳过并记录提示。

## 健康检查

页面检查：

```powershell
Invoke-WebRequest http://127.0.0.1:4330/ -UseBasicParsing |
  Select-Object StatusCode, StatusDescription
```

接口检查：

```powershell
Invoke-RestMethod http://127.0.0.1:4330/api/status
```

`ready.model` 表示 DeepSeek Key 是否已配置，`ready.paperclip` 表示可选面板是否连接，`ready.browser` 表示浏览器能力已装载。Paperclip 为 `false` 不代表主服务故障。

## 配置与凭证

新建内容任务提交时，服务会先检查产品资料是否确认、执行文件和密钥能否读取、文件目录能否写入、本机代理端口能否监听，以及 DeepSeek、火山绘图的模型列表接口是否可访问。任一检查失败时，不创建任务、不调用生成接口、不扣减任务调用预算；定时创建和接续执行同样经过检查。产品定位分析只检查文字模型，不要求绘图配置。

模型列表访问成功只说明当前连接与该查询接口鉴权通过，不保证生成权限、余额和配额全部可用。检查不会通过付费写稿或生图来验证权限。平台登录不阻止出稿，上传草稿前会重新检查公众号账号。

任务显示“联网权限受阻”时，应检查服务进程所在运行环境的网络权限，补充主题、参考文章或更换密钥不能解除该限制。“正文上传校验失败”应核对本地稿与平台草稿；“中断结果待核实”应先检查调用日志和平台实际结果，避免重复操作。

DeepSeek、火山方舟、端口、路径和默认调用预算统一在项目根目录 `.env` 配置。“运行设置”页面不保存密钥，只显示非敏感摘要并提供连接测试。修改 `.env` 后必须重启工作台。

保存配置后，可在“运行设置”分别测试文字模型和图片模型连接。测试只查询服务商的模型列表，不生成文章或图片，也不消耗任务调用预算；通过只代表网络和当前查询鉴权正常，实际生成权限、余额和配额仍以服务商响应为准。

火山凭证也支持临时环境变量 `ARK_API_KEY` 或 `VOLCENGINE_API_KEY`。不要把真实 Key 写入 README、测试、提交记录或启动日志。

首次启动且当前数据库为空时，程序会尝试从 `research/runtime-lab/config/`、`materials/` 和 `.env` 导入旧资料；也会只读检查 `archive/legacy-operator/data/catalog.sqlite`，迁移旧图片配置。

## 备份

停止工作台后再备份，至少保存：

```text
app/data/
research/runtime-lab/state/paperclip/   # 使用 Paperclip 时
research/runtime-lab/config/
research/runtime-lab/materials/
archive/legacy-operator/                # 仍需要旧版追溯时
```

恢复时把目录放回原位置，再启动服务。不要只复制 `operator.sqlite` 而遗漏同目录图片、运行账本和加密凭证。

迁移时应在新机器创建自己的 `.env`，不要复制或提交包含真实密钥的 `.env`。

## 常见问题

### 4330 端口已被占用

先访问 <http://127.0.0.1:4330>。如果页面正确，说明服务已经启动，不要再开一个实例。若不是本项目，查找占用进程：

```powershell
Get-NetTCPConnection -LocalPort 4330 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

确认进程身份后再决定是否关闭，不要直接结束未知进程。

### 页面显示模型未配置

检查根目录 `.env` 中的 `DEEPSEEK_API_KEY`、模型名称和服务地址，修改后重启工作台，再到“运行设置”测试文字模型连接。

### Paperclip 未连接

这不阻止内容任务运行。需要面板时启动 `research/runtime-lab/Start-Lab.ps1`，确认 4320 端口可访问；不要删除 `state/paperclip/instances/default/config.json` 或数据库目录。

macOS/Linux 使用 `bash ./research/runtime-lab/start-lab.sh` 启动。

### 任务停在“结果不明”

系统故意阻止自动重试，因为上游可能已经计费或平台可能已经收到操作。先查看任务调用记录或平台后台，再按界面提示人工处理，不能通过删除数据库状态强制重跑。

## 清理边界

可安全重新生成的通常只有安装缓存、临时测试目录和明确标记的日志。以下内容不是缓存：

- `app/data/`；
- 根目录 `.env`（只包含本机配置和凭证，备份时注意保密）；
- `app/node_modules/` 和 Paperclip `node_modules/`（删除后服务无法直接启动）；
- `research/runtime-lab/state/paperclip/`；
- 产品配置、材料和旧业务归档。

清理前先停止服务并完成备份。
