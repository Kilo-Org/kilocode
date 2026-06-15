# SSH 隧道联调（本机 9080 未放行时）

**状态（2026-06-02）：** 测试云 `43.143.227.210` FullChain smoke 已通过；**公网 9080 对本机已可达**（health 200 + license valid）。插件 B4–B6 经隧道（2026-06-14）与公网直连均可验收。公网直连样例：[samples/vscode-settings.cloud-43.143.227.210.json](./samples/vscode-settings.cloud-43.143.227.210.json)；隧道样例：[samples/vscode-settings.cloud-tunnel-43.json](./samples/vscode-settings.cloud-tunnel-43.json)。

当腾讯云安全组尚未开放 **9080** 时，本机无法访问 `http://43.143.227.210:9080`，会出现：

```text
License verification failed (network)
```

## 方案 A：开放安全组（推荐）

腾讯云 → 安全组 → 入站 **TCP 9080** → 来源设为本机公网 IP。

然后将 `.vscode/settings.json` 改回公网 IP：

```json
"remoteServer.url": "http://43.143.227.210:9080/kilo",
"license.serverUrl": "http://43.143.227.210:9080"
```

## 方案 B：SSH 隧道（当前 settings 默认）

VS Code 使用 `127.0.0.1:9080`。隧道把本机 9080 转发到云机 `127.0.0.1:9080`，**隧道进程必须一直运行**，关终端或 Ctrl+C 后插件会连不上。

### 启动（二选一）

**方式 1 — OpenSSH（终端保持打开）：**

```powershell
ssh -o StrictHostKeyChecking=accept-new -N -L 9080:127.0.0.1:9080 root@43.143.227.210
```

输入 **云机 root 密码**（不是 `KILO_SERVER_PASSWORD`）。窗口无输出是正常的，不要关。

**方式 2 — 仓库脚本（推荐，便于后台跑）：**

```powershell
cd D:\ai\kilocode-main
$env:SSH_PASSWORD = "你的云机root密码"
python scripts/ssh-tunnel-9080.py
```

看到 `SSH tunnel 127.0.0.1:9080 -> ...` 即已就绪。`Ctrl+C` 停止。

一次性自检（建隧道 + curl health + license）：

```powershell
$env:SSH_PASSWORD = "你的云机root密码"
python scripts/ssh-tunnel-test.py
```

### 验证隧道是否活着

```powershell
$pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("kilo:abc12345"))
Invoke-WebRequest -Uri "http://127.0.0.1:9080/kilo/global/health" -Headers @{ Authorization = "Basic $pair" } -UseBasicParsing
```

- **200** + `{"healthy":true,...}` → 隧道正常
- **连接被拒绝 / 超时** → 隧道已断，按下面「重启」

### 关掉后如何重启

1. 若旧终端还在跑隧道，先 **Ctrl+C** 结束（或任务管理器结束 `ssh.exe` / `python.exe` 隧道进程）
2. 确认本机 9080 未被占用：`netstat -ano | findstr :9080`
3. 重新执行上面 **启动** 命令之一
4. 验证 health 返回 200
5. VS Code：**Developer: Reload Window**

### 常见现象

| 现象 | 原因 |
|---|---|
| `License verification failed (network)` | 隧道未开，或 9080 未转发 |
| `无法连接到远程服务器` | 同上 |
| VS Code 昨天能用今天不行 | 隧道进程已退出，需重启 |
| ssh 提示 `Address already in use` | 9080 被占用；结束旧隧道或改本地端口 |

**VS Code：** 已配置 `127.0.0.1:9080` + **离线 RSA License**（在线 License 经隧道也可用）。

`Developer: Reload Window` 后重试。

## License 说明

| 模式 | 配置 | 何时用 |
|---|---|---|
| 在线 | `license.serverUrl` + `license.key`（如 `poc-demo-key`） | 9080 可达公网或经隧道 |
| 离线 RSA | `offlinePath` + `offlinePublicKeyPath`；**`license.key` 须与离线文件内 `key` 一致**（如 `enterprise-offline-demo`） | 离线文件优先；失败时回退在线 |

**`offline_key_mismatch`：** 设置项 `license.key` 与 `offline-license.signed.json` 里的 `key` 不一致。改其一使相同，或删掉 `offlinePath` 仅用在线校验。

离线有效时插件 reason=`offline_rsa`，不阻断连接。
