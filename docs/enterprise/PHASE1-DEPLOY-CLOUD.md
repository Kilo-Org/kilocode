# Phase 1 云服务器 Docker 部署指南

面向 **Linux 云主机**（阿里云 / 腾讯云 / 华为云 / 私有云 VM）。开发者在本机 VS Code，Engine 与网关跑在云上。

相关：[PHASE1-DEPLOY.md](./PHASE1-DEPLOY.md) · [PHASE1-E2E-CHECKLIST.md](./PHASE1-E2E-CHECKLIST.md)

---

## 1. 推荐架构（云上）

```text
开发者 PC（VS Code）
    │  HTTPS/HTTP（建议 Phase 2 上 TLS）
    ▼
云安全组 :9080  ──►  APISIX (:9080)
                          │
                          ▼
                     enterprise-bridge (:8080，仅 127.0.0.1)
                          │
                          ▼
                     kilo-engine (:4096，仅 127.0.0.1)
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
         qdrant (内网)          vLLM / 外部模型 API（可选 GPU 机）
```

**原则：** 公网只暴露 **9080（APISIX）**；Engine / Bridge / Qdrant **绑定 127.0.0.1**，避免 4096 直接暴露在公网。

---

## 2. 云主机规格建议

| 场景 | CPU / 内存 | 磁盘 | GPU | 说明 |
|---|---|---|---|---|
| 最小 POC（外接模型 API） | 4C / 8G | 40G | 无 | 只跑 Engine + QISIX + Qdrant |
| 标准 POC（本机 14B） | 8C / 32G | 100G | 1×24G+ | 加 `--profile vllm` |
| 生产试点 | 按 v2.4 100 人估算 | SSD | 按模型 | Phase 2 再上 K8s |

系统：**Ubuntu 22.04 / 24.04 LTS** 或 **OpenCloudOS 9**（RHEL 系，用 dnf + Docker CE 官方源，见 [PHASE1-CLOUD-QUICKSTART-43.md](./PHASE1-CLOUD-QUICKSTART-43.md) §1）。ARM 需自行构建 `linux/arm64` 镜像。

---

## 3. 安全组 / 防火墙

| 端口 | 监听 | 安全组 | 说明 |
|---|---|---|---|
| 22 | SSH | 办公 IP 白名单 | 运维 |
| **9080** | APISIX | 开发者网段或 VPN | **插件唯一入口** |
| 4096 | Engine | **不开放** | `.env.cloud` 已绑 127.0.0.1 |
| 8080 / 6333 / 19090 | 内部 | **不开放** | 同上 |

```bash
# Ubuntu ufw 示例（可选，与安全组二选一或叠加）
sudo ufw allow 22/tcp
sudo ufw allow 9080/tcp
sudo ufw enable
```

---

## 4. 云主机初始化

```bash
# 4.1 安装 Docker（Ubuntu）
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

sudo usermod -aG docker "$USER"
# 重新登录 SSH 后生效

# 4.2 GPU 机（可选，vLLM）
# 安装 NVIDIA 驱动 + nvidia-container-toolkit，见 NVIDIA 官方文档
```

**上传代码（任选其一）：**

```bash
# A. Git 克隆（推荐私有仓）
git clone <your-repo-url> kilocode-main
cd kilocode-main

# B. 本机 rsync
# rsync -avz --exclude node_modules ./ d:/path/ user@云IP:~/kilocode-main/
```

**安装 Bun（构建 CLI 需要）：**

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

---

## 5. 一键部署（推荐 FullChain）

```bash
cd deploy/enterprise

# 使用云专用 env（Engine 不暴露公网）
cp .env.cloud.example .env
nano .env   # 必改：KILO_SERVER_PASSWORD；模型 URL 等

chmod +x scripts/*.sh
./scripts/deploy-cloud.sh --build --full-chain
```

脚本会：构建 `kilo-engine:local` 镜像 → 启动 Engine + Qdrant + Bridge + APISIX + License Mock → 跑 smoke。

**手动分步：**

```bash
./scripts/build-engine.sh
cp .env.cloud.example .env && nano .env
docker compose --profile gateway --profile license up -d \
  kilo-engine qdrant enterprise-bridge apisix license-mock
./scripts/e2e-smoke.sh --full-chain
```

---

## 6. 验证（在云主机上）

```bash
source .env
# 本机 Engine（仅 127.0.0.1 可达）
curl -u "kilo:$KILO_SERVER_PASSWORD" http://127.0.0.1:4096/global/health

# 经网关全链路（模拟开发者访问）
curl -u "kilo:$KILO_SERVER_PASSWORD" http://127.0.0.1:9080/kilo/global/health

# License
curl -X POST http://127.0.0.1:9080/api/v1/license/verify \
  -H "Content-Type: application/json" \
  -d '{"key":"poc-demo-key","machineId":"test","client":"vscode"}'
```

公网验证（在你 **开发 PC** 上，将 `CLOUD_IP` 换成弹性公网 IP）：

```bash
curl -u "kilo:<密码>" http://CLOUD_IP:9080/kilo/global/health
```

---

## 7. VS Code 插件配置（开发者本机）

将 `CLOUD_IP` 换成云服务器公网 IP 或域名：

```json
{
  "kilo-code.new.enterprise.remoteServer.enabled": true,
  "kilo-code.new.enterprise.remoteServer.url": "http://CLOUD_IP:9080/kilo",
  "kilo-code.new.enterprise.remoteServer.password": "<与 KILO_SERVER_PASSWORD 相同>",
  "kilo-code.new.enterprise.license.enabled": true,
  "kilo-code.new.enterprise.license.serverUrl": "http://CLOUD_IP:9080",
  "kilo-code.new.enterprise.license.key": "poc-demo-key",
  "kilo-code.new.customApi.enabled": true,
  "kilo-code.new.customApi.baseUrl": "https://你的模型API/v1"
}
```

说明：

- **不要** 把 `remoteServer.url` 设为 `:4096`，除非你 intentionally 暴露了 Engine（不推荐）。
- 模型 API 若在 **另一台 GPU 云机**，`customApi.baseUrl` 填那台机的 OpenAI 兼容地址；若在 compose `vllm` profile 内，Engine 容器内用 `http://vllm:8000/v1`（`.env` 已配）。

---

## 8. 可选：同机 GPU + vLLM

```bash
# .env 中
# VLLM_BIND=127.0.0.1:8000
# KILO_CUSTOM_API_BASE_URL=http://vllm:8000/v1

docker compose --profile gateway --profile license --profile vllm up -d
```

首次拉模型较慢，需足够磁盘与显存。

---

## 9. 运维命令

```bash
cd deploy/enterprise
docker compose ps
docker compose logs -f kilo-engine
docker compose logs -f apisix
docker compose restart kilo-engine

# 升级镜像后
./scripts/build-engine.sh
docker compose --profile gateway --profile license up -d --force-recreate kilo-engine
```

数据卷：`kilo-data`、`qdrant-data`（`docker volume ls`）。

---

## 10. 常见问题

| 现象 | 处理 |
|---|---|
| 外网 curl 9080 超时 | 检查云安全组、实例防火墙、APISIX 是否 `0.0.0.0:9080` |
| 插件连不上 | URL 必须含 `http://`；密码与 `.env` 一致；走 `/kilo` 前缀 |
| build-engine 失败 | 安装 Bun；仓库需完整 `packages/opencode` |
| bridge 构建失败 | 云机安装 Go 非必须，Docker 多阶段构建自带 Go |
| License 失败 | Mock 是否启动；`license.serverUrl` 用网关 `9080` 不要 `19090`（经 APISIX 路由） |
| 流式断流 | 见 `deploy/enterprise/apisix/SSE-VERIFY.md` |

---

## 11. Phase 1 验收勾选

云部署完成后，在 [PHASE1-E2E-CHECKLIST.md](./PHASE1-E2E-CHECKLIST.md) 勾选 **A1–A9**，本机完成 **B1–B6**。

---

## 12. 安全提醒（POC）

- 更换默认密码；POC 结束后收紧 9080 源 IP。
- Phase 2 建议在 APISIX 前加 **HTTPS（TLS）** 与 JWT 生产配置。
- 代码与业务数据不出域：模型 API 也应在客户可控网络内。
