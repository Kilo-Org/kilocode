# 测试环境：外部模型 API 部署（无 GPU）

公网云测试、**不建 vLLM**，Engine 通过 OpenAI 兼容 API 调模型。API Key **只配在服务器 `.env`**，程序员插件**不需要**填 Key。

---

## 1. 架构

```text
程序员 VS Code 插件
    → 云服务器 APISIX :9080/kilo
        → Kilo Engine（容器内 kilo.jsonc + KILO_CUSTOM_API_KEY）
            → https://api.deepseek.com/v1（或其他 MaaS）
```

云主机：**4C8G 即可**，无需 GPU。

---

## 2. 部署步骤

```bash
cd deploy/enterprise

# 推荐：DeepSeek
cp env/test.cloud.api.env.sample .env
nano .env   # 改 KILO_SERVER_PASSWORD、KILO_CUSTOM_API_KEY

chmod +x scripts/*.sh
./scripts/deploy-cloud.sh --build --full-chain
```

**不要**加 `--profile vllm`。

---

## 3. 支持的 API 配置

| 提供商 | 配置文件 | `.env` 中的 Key |
|---|---|---|
| **DeepSeek**（默认） | `config/deepseek.kilo.jsonc` | [platform.deepseek.com](https://platform.deepseek.com) 申请 |
| **Ruiyu MaaS** | `config/ruiyumaas.kilo.jsonc` | 设 `KILO_ENGINE_CONFIG=./config/ruiyumaas.kilo.jsonc` |

其他 OpenAI 兼容 API：复制 `deepseek.kilo.jsonc` 改 `baseURL` 和 `models` 字段。

---

## 4. 云安全组

| 端口 | 说明 |
|---|---|
| 9080 | 插件入口（限测试 IP） |
| 22 | SSH（限运维 IP） |

Engine 4096 不对公网开放。

---

## 5. 程序员 VS Code 配置

**无需** `customApi`（Key 在服务器上）：

```json
{
  "kilo-code.new.enterprise.remoteServer.enabled": true,
  "kilo-code.new.enterprise.remoteServer.url": "http://<云公网IP>:9080/kilo",
  "kilo-code.new.enterprise.remoteServer.password": "<与 .env KILO_SERVER_PASSWORD 相同>",
  "kilo-code.new.enterprise.license.enabled": true,
  "kilo-code.new.enterprise.license.serverUrl": "http://<云公网IP>:9080",
  "kilo-code.new.enterprise.license.key": "poc-demo-key",
  "kilo-code.new.customApi.enabled": false
}
```

模板：[samples/vscode-settings.test.json](./samples/vscode-settings.test.json)

---

## 6. 验证

```bash
# 服务端
source .env
curl -u "kilo:$KILO_SERVER_PASSWORD" http://127.0.0.1:9080/kilo/global/health

# 插件连上后发起对话；Engine 日志应出现对 api.deepseek.com 的请求
docker compose logs -f kilo-engine
```

---

## 7. 常见问题

| 现象 | 处理 |
|---|---|
| 对话报 401 | 检查 `.env` 中 `KILO_CUSTOM_API_KEY`；重启 `kilo-engine` |
| 模型不存在 | 检查 `KILO_ENGINE_CONFIG` 指向的 jsonc 里模型名与 API 一致 |
| 云机无法访问 API | 安全组出站需允许 HTTPS 443（访问 DeepSeek 等公网 API） |
| 生产内网不出域 | 改用内网模型网关 jsonc，禁止公网 API URL |

---

## 8. 与 GPU 模式切换

测试后期若要试自建 GPU，改 `.env` 并：

```bash
docker compose --profile vllm up -d
# 并换用 vLLM 专用 kilo.jsonc 或改 KILO_CUSTOM_API_BASE_URL=http://vllm:8000/v1
```

外部 API 与 GPU **二选一**或分机部署（对话 API、补全 GPU）。
