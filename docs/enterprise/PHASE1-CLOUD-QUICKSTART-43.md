# 测试云快速部署 — 43.143.227.210

程序员本机 **不需要 Docker**。服务端跑 FullChain，VS Code 连 `:9080/kilo`。

| 角色 | 机器 | 做什么 |
|---|---|---|
| 服务端 | `43.143.227.210`（**OpenCloudOS 9**） | Docker FullChain + Ruiyu MaaS Key |
| 程序员 | 本机 Windows | VS Code + VSIX + settings |

---

## 0. 云安全组（必做）

在腾讯云控制台为实例放行：

| 端口 | 来源 | 说明 |
|---|---|---|
| 22 | 你的办公 IP | SSH |
| **9080** | 测试程序员 IP（或临时 0.0.0.0/0） | 插件入口 |

**不要**对公网开放 4096 / 8080 / 6333。

---

## 1. 云服务器初始化（OpenCloudOS 9）

> OpenCloudOS 9 与 RHEL 9 同源，用 **dnf** 装 Docker（须 **> 20.10.9**，见 [OC 官方 FAQ](https://docs.opencloudos.org/faq/)）。防火墙多为 **firewalld**，不是 ufw。

SSH 登录 `43.143.227.210` 后，**一键初始化**（推荐）：

```bash
cd kilocode-main/deploy/enterprise   # 上传代码后
chmod +x scripts/bootstrap-oc9.sh
./scripts/bootstrap-oc9.sh
# 若提示加入 docker 组，退出 SSH 重新登录
source ~/.bashrc
docker compose version
bun --version
```

**或手动安装（腾讯云 OpenCloudOS 9 推荐镜像源，勿用 download.docker.com）：**

```bash
# 若曾失败，先删掉坏掉的官方源
sudo rm -f /etc/yum.repos.d/docker-ce.repo

# 方式 1：系统已预置腾讯 docker-ce 源（多数腾讯云 OC9 镜像可直接装）
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin --nobest

# 方式 2：仍失败时，显式添加腾讯云镜像
sudo dnf config-manager --add-repo https://mirrors.cloud.tencent.com/docker-ce/linux/centos/docker-ce.repo
sudo sed -i 's|download.docker.com|mirrors.tencentyun.com/docker-ce|g' /etc/yum.repos.d/docker-ce.repo
sudo dnf makecache -y
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin --nobest

sudo systemctl enable --now docker
docker compose version
```

**安装 Bun（构建 Engine 必需，`bun install` 前必做）：**

```bash
curl -fsSL https://bun.sh/install | bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
bun --version
```

或：`bash /root/kilocode-main/deploy/enterprise/scripts/ensure-bun.sh`

<details>
<summary>Ubuntu 22.04/24.04（备用）</summary>

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker "$USER"
curl -fsSL https://bun.sh/install | bash && source ~/.bashrc
```

</details>

---

## 2. 上传代码到云服务器

**方式 A — Git（有私有仓时推荐）：**

```bash
git clone <你的仓库> kilocode-main
cd kilocode-main
```

**方式 B — 本机 Windows 打包上传（无 Git 时）：**

在本机 PowerShell（仓库根目录）：

```powershell
.\deploy\enterprise\scripts\pack-for-cloud.ps1
# 产物：仓库根目录 kilocode-cloud.tgz（约 170 MB，不含 node_modules）

scp D:\ai\kilocode-main\kilocode-cloud.tgz root@43.143.227.210:/root/
```

云上解压：

```bash
mkdir -p /root/kilocode-main
tar -xzf /root/kilocode-cloud.tgz -C /root/kilocode-main
cd /root/kilocode-main/deploy/enterprise
./scripts/ensure-bun.sh
source ~/.bashrc
cd /root/kilocode-main && bun install --ignore-scripts
```

---

## 3. 配置并部署 FullChain

```bash
cd kilocode-main/deploy/enterprise

cp env/test.cloud.ruiyumaas.env.sample .env
nano .env
# 必改：
#   KILO_SERVER_PASSWORD=设一个强密码（记下来，VS Code 要用）
#   KILO_CUSTOM_API_KEY=你的 Ruiyu MaaS Key

chmod +x scripts/*.sh
./scripts/deploy-cloud.sh --build --full-chain
```

成功标志：脚本末尾 `[smoke] Passed.` 且提示 `Plugin gateway: http://<云IP>:9080/kilo`。

---

## 4. 云上自测

```bash
cd deploy/enterprise
source .env

curl -u "kilo:$KILO_SERVER_PASSWORD" http://127.0.0.1:9080/kilo/global/health

curl -X POST http://127.0.0.1:9080/api/v1/license/verify \
  -H "Content-Type: application/json" \
  -d '{"key":"poc-demo-key","machineId":"cloud","client":"vscode"}'
```

---

## 5. 本机程序员 VS Code

> **公网 9080 已通（2026-06-02）：** 优先 **§5B 公网直连**；若安全组临时收紧，仍可用 [PHASE1-VSCODE-CLOUD-TUNNEL.md](./PHASE1-VSCODE-CLOUD-TUNNEL.md) 的 SSH 隧道 + [samples/vscode-settings.cloud-tunnel-43.json](./samples/vscode-settings.cloud-tunnel-43.json)。

### 5A. SSH 隧道联调（公网 9080 未通时；2026-06-14 已验收 B4–B6）

**终端 1（保持运行）：**

```powershell
$env:SSH_PASSWORD = "云机 root 密码"
python D:\ai\kilocode-main\scripts\ssh-tunnel-9080.py
```

**VS Code：**

1. **文件 → 打开文件夹** → `D:\ai\kilocode-main`
2. 合并 [samples/vscode-settings.cloud-tunnel-43.json](./samples/vscode-settings.cloud-tunnel-43.json) 到 `.vscode/settings.json`
3. `remoteServer.password` = 云 `.env` 的 `KILO_SERVER_PASSWORD`
4. **Developer: Reload Window**
5. 企业私有化 → License **有效 / online** → 已连接 → 对话

验证隧道：

```powershell
$pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("kilo:你的KILO_SERVER_PASSWORD"))
Invoke-WebRequest -Uri "http://127.0.0.1:9080/kilo/global/health" -Headers @{ Authorization = "Basic $pair" } -UseBasicParsing
```

### 5B. 公网直连（安全组放行 9080 后）

1. 合并 [samples/vscode-settings.cloud-43.143.227.210.json](./samples/vscode-settings.cloud-43.143.227.210.json)
2. 本机 curl：

```powershell
$pair = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("kilo:你的KILO_SERVER_PASSWORD"))
Invoke-WebRequest -Uri "http://43.143.227.210:9080/kilo/global/health" -Headers @{ Authorization = "Basic $pair" } -UseBasicParsing
```

应返回 **200**。

---

## 6. 常见问题

| 现象 | 处理 |
|---|---|
| 本机 curl 9080 超时 | 安全组/bridge 异常 → 用 **§5A SSH 隧道**；机内 `curl 127.0.0.1:9080` 应 200 |
| 聊天框「连接失败」 | 隧道未开 / 9080 端口冲突 → 重启隧道 + Reload Window |
| `offline_key_mismatch` | `license.key` 须与离线文件 `key` 一致；在线模式清空 `offlinePath` |
| smoke 通过但外网不通 | `APISIX_HTTP_BIND=0.0.0.0:9080`；检查 **firewalld** / 安全组 |
| `download.docker.com` SSL / Connection reset | 腾讯云 OC9 勿用官方源；见 §1 手动安装「腾讯云镜像」 |
| `docker-ce-stable` metadata 失败 | `sudo rm -f /etc/yum.repos.d/docker-ce.repo` 后改用腾讯云源 |
| Permission denied (docker.sock) | `usermod -aG docker $USER` 后 **重新 SSH 登录** |
| SELinux 导致容器异常 | POC 可临时 `sudo setenforce 0`；生产再配策略 |
| build-engine 失败 | 确认 `bun` 在 PATH；仓库含完整 `packages/opencode` |
| 对话无回复 | `.env` 的 `KILO_CUSTOM_API_KEY`；云机出站需允许 HTTPS 443 |
| `EROFS: read-only file system, kilo.jsonc` | `docker-compose.yml` 去掉 config 卷的 `:ro`，`docker compose up -d --force-recreate kilo-engine` |
| Gateway 502 / smoke 网关失败 | `apisix.yaml` 用 `file-logger` 而非 `http-logger`+`file://`；`docker compose restart apisix` |
| `bun: command not found` | 先装 Bun：`curl -fsSL https://bun.sh/install \| bash` 然后 `source ~/.bashrc` |

---

## 7. 验收勾选

完成后更新 [PHASE1-E2E-CHECKLIST.md](./PHASE1-E2E-CHECKLIST.md) **A5–A9** 与 **B4–B6**（经隧道或公网网关）。
