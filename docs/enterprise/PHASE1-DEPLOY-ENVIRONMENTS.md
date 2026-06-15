# 部署环境策略：公网测试 + 内网生产

适用：**开发团队通过 VS Code 插件使用**；模型可 **自建 GPU（vLLM）** 或 **外部 OpenAI 兼容 API**；**测试走公网云**，**正式走纯内网**。

相关：[PHASE1-DEPLOY-CLOUD.md](./PHASE1-DEPLOY-CLOUD.md) · [PHASE1-DEPLOY.md](./PHASE1-DEPLOY.md) · [PHASE1-VSIX.md](./PHASE1-VSIX.md)

---

## 1. 两套环境，同一套 Compose

服务端组件相同，仅 **网络、域名/IP、密钥、模型来源** 不同：

| 项 | 测试环境（公网云） | 生产环境（纯内网） |
|---|---|---|
| 位置 | 阿里云/腾讯云等公网 VM | 机房 / 私有云，**无外网** |
| 插件入口 | `http://公网IP:9080/kilo` | `http://ai.internal:9080/kilo` 或内网 DNS |
| 安全组 | 9080 限 **测试人员 IP**；禁止 0.0.0.0/0 长期开放 | 仅 **办公网/VPN 网段** |
| Engine 4096 | 不暴露公网（`.env.cloud` 绑 127.0.0.1） | 同样不对外，只经 APISIX |
| TLS | Phase 1 可 HTTP；建议测试也上 HTTPS | Phase 2 必须 HTTPS + 国密（军工） |
| License | Mock / POC Key | Phase 2 正式 License 服务 |
| VSIX | `company-ai-test.vsix` + 测试 settings | `company-ai.vsix` + 生产 settings |
| 数据 | 测试代码/对话，可清理 | 生产数据不出域 |

```text
                    ┌──────────────────┐
  测试：公网云 VM    │ APISIX :9080     │
                    │ Engine + Qdrant  │
                    │ [可选 vLLM GPU]  │
                    └────────┬─────────┘
                             │
         测试程序员 VS Code ──┘（公网或 VPN 访问云 IP）

                    ┌──────────────────┐
  生产：内网服务器   │ 同上 Compose 栈   │
                    └────────┬─────────┘
                             │
         正式程序员 VS Code ──┘（仅内网/VPN，无外网 egress 到模型公网*）

* 若生产禁止出域，外部 API 需换成内网模型网关地址
```

---

## 2. 模型三种接法（测试和生产都适用）

### 模式 A — 仅外部 API（无 GPU，最快试点）

Engine 不跑 vLLM，调用已有模型平台（DeepSeek、GLM、企业 MaaS 等）。

**`.env`：**

```bash
# 测试云：填公网可达的 API（或云机到 MaaS 专线）
KILO_CUSTOM_API_BASE_URL=https://api.deepseek.com/v1
KILO_CUSTOM_API_KEY=sk-xxx

# 生产内网：填内网模型网关，禁止填公网 URL
# KILO_CUSTOM_API_BASE_URL=http://llm-gateway.internal/v1
```

**Compose：** 不需要 `--profile vllm`。

---

### 模式 B — 自建 GPU（vLLM 与 Engine 同机或同 VPC）

**同机（测试云 GPU 实例）：**

```bash
# .env
KILO_CUSTOM_API_BASE_URL=http://vllm:8000/v1
VLLM_BIND=127.0.0.1:8000
VLLM_MODEL=Qwen/Qwen2.5-Coder-14B-Instruct
```

```bash
docker compose --profile gateway --profile license --profile vllm up -d
```

**生产内网：GPU 机与 Engine 分机（推荐规模化）：**

| 机器 | 跑什么 |
|---|---|
| CPU 机 | Engine + APISIX + Qdrant + Bridge |
| GPU 机 | 仅 vLLM `:8000`（内网 IP） |

CPU 机 `.env`：

```bash
KILO_CUSTOM_API_BASE_URL=http://10.0.20.5:8000/v1
```

---

### 模式 C — 混合（补全走小模型 GPU，对话走外部/80B）

Phase 1：在 Engine / `kilo.jsonc` 配主模型；补全可在插件 `customApi` 单独指向 14B。

测试云可 **对话用外部 API、补全用同机 vLLM 14B**；生产内网则两个 endpoint 都必须是内网地址。

---

## 3. 公网测试环境 — 操作步骤

### 3.1 云主机

- 系统：Ubuntu 22.04 x86_64  
- 无 GPU：4C8G（模式 A）  
- 有 GPU：按 vLLM 模型选 GPU 云实例（模式 B）  
- 安全组：**入站 9080** ← 测试组 IP；**22** ← 运维 IP；**其余关闭**

### 3.2 部署

```bash
git clone <私有仓> && cd kilocode-main/deploy/enterprise
cp .env.cloud.example .env
nano .env   # 密码、KILO_CUSTOM_API_* 或 vLLM

chmod +x scripts/*.sh
./scripts/deploy-cloud.sh --build --full-chain
# 模式 B 再加 vllm profile，见 PHASE1-DEPLOY-CLOUD.md §8
```

### 3.3 测试程序员 VS Code

```json
{
  "kilo-code.new.enterprise.remoteServer.enabled": true,
  "kilo-code.new.enterprise.remoteServer.url": "http://<云公网IP>:9080/kilo",
  "kilo-code.new.enterprise.remoteServer.password": "<KILO_SERVER_PASSWORD>",
  "kilo-code.new.enterprise.license.enabled": true,
  "kilo-code.new.enterprise.license.serverUrl": "http://<云公网IP>:9080",
  "kilo-code.new.enterprise.license.key": "poc-demo-key",
  "kilo-code.new.customApi.enabled": true,
  "kilo-code.new.customApi.baseUrl": "<若插件直连模型则填；通常 Engine 已配则不必>"
}
```

分发：**测试专用 VSIX** + 上述 settings（可打 `settings-test.json` 包进安装包）。

### 3.4 测试结束

- 关闭安全组 9080 对公网开放  
- 销毁或关机云 VM，避免长期暴露  

---

## 4. 纯内网生产环境 — 操作步骤

### 4.1 与测试的差异

| 配置 | 生产内网 |
|---|---|
| `.env` | 复制测试验证过的配置，**改所有密码/Key** |
| `KILO_CUSTOM_API_BASE_URL` | **必须内网 URL**，不能依赖公网 API（若制度要求不出域） |
| `APISIX_HTTP_BIND` | `0.0.0.0:9080`（内网监听） |
| DNS | `ai.company.internal` → 内网 LB 或 Engine 网关机 |
| 插件 URL | `http://ai.company.internal:9080/kilo`（不要用公网 IP） |

### 4.2 部署命令（与测试相同）

```bash
cp .env.cloud.example .env   # 或从测试 env 改密后拷贝
./scripts/deploy-cloud.sh --build --full-chain
```

内网 **无需改 Compose 结构**，只改 `.env` 与防火墙（仅内网网段访问 9080）。

### 4.3 正式程序员

- 安装 **生产 VSIX**（可与测试同包不同 settings）  
- 通过 **组策略 / 内网文档** 下发 `settings.json`  
- 必须能 **ping/ curl 内网网关**，无需访问公网  

---

## 5. 配置文件管理建议

在仓库或运维仓维护两份 env（**勿提交真实密钥**）：

```text
deploy/enterprise/
  .env.cloud.example      # 模板
  env/
    test.cloud.env.sample # 测试云：公网 IP 占位、外部 API 示例
    prod.intranet.env.sample # 生产：内网 DNS、内网模型地址
```

**插件侧：**

```text
docs/enterprise/samples/
  vscode-settings.test.json
  vscode-settings.prod.json
```

---

## 6. 从测试迁移到生产

| 步骤 | 动作 |
|---|---|
| 1 | 测试云跑通 [PHASE1-E2E-CHECKLIST.md](./PHASE1-E2E-CHECKLIST.md) A+B |
| 2 | 导出已验证的 `.env`（脱敏）为生产模板 |
| 3 | 内网新机 `./scripts/deploy-cloud.sh --build --full-chain` |
| 4 | 内网 curl 9080 health；找 2～3 人试点 VSIX |
| 5 | 全员 rollout + 关测试云公网 9080 |

**镜像：** 测试机构建的 `kilo-engine:local` 可 `docker save/load` 到内网，或在内网重新 `build-engine.sh`（推荐，避免传 tar 过大）。

---

## 7. 安全要点（测试云尤其注意）

| 风险 | 测试云 | 生产内网 |
|---|---|---|
| 9080 对全网开放 | **禁止**；仅测试 IP | 仅内网/VPN |
| 弱密码 | 必须强随机 | 独立更强密码 |
| 代码上传公网云 | 测试勿用真实核心库；或 VPN 专线进云 | 代码只在域内 |
| 外部 API | 测试可用公网 MaaS | 生产改用内网网关或本地 GPU |
| 测试数据残留 | 定期删卷 / 销毁 VM | 备份与审计 Phase 3 |

---

## 8. 快速决策表

| 你的情况 | 建议 |
|---|---|
| 先验证插件联调 | 公网云 + **模式 A 外部 API** + FullChain |
| 要测 14B 延迟 | 公网 **GPU 云** + **模式 B** |
| 生产不出域 | 内网 **模式 B GPU** 或 **内网模型网关** |
| 测试外部、生产 GPU | 两套 `.env`，同一 Compose，不同 `KILO_CUSTOM_API_BASE_URL` |

---

## 9. 相关命令速查

```bash
# 测试云 / 内网通用
cd deploy/enterprise
./scripts/deploy-cloud.sh --build --full-chain
./scripts/e2e-smoke.sh --full-chain

# 仅外部 API（不加 vllm）
docker compose --profile gateway --profile license up -d

# 加 GPU
docker compose --profile gateway --profile license --profile vllm up -d
```

程序员侧：**只装 VSIX + 连 `http://<网关>:9080/kilo`**，不在本机部署 Docker。
