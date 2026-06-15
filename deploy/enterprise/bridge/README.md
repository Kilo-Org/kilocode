# Layer 2 防腐桥接层（Phase 1 契约）

独立仓库建议名：`enterprise-bridge`（Go）。

## 职责

| 组件 | Phase 1 | Phase 2+ |
|---|---|---|
| API 抽象 | `adapter/proxy.go` 反向代理 | 统一 `/internal/v1/*` |
| 版本适配 | `adapter/version.go` 框架（`X-Enterprise-Api-Version`） | v0.x 路径/字段映射 |
| 配置翻译 | 占位 | 企业 YAML ↔ `kilo.jsonc` |
| 国产模型 | 由 Engine `provider` 配置 | 独立 model-adapter |

## 内部标准（草案）

```
POST /internal/v1/chat
  → Kilo: POST {engine}/session/... (随 SDK 演进)

GET /internal/v1/models
  → Kilo provider list
```

## MVP 路径

Phase 1 路径：**Extension → APISIX → enterprise-bridge → Kilo Engine**（`up.ps1 -FullChain`）。

POC：`docker compose --profile gateway up -d`（含 bridge）。`/health` 为桥接自检。

API 契约草案：[`../openapi.yaml`](../openapi.yaml)。

## 上游合并

Kilo Engine 升级时仅修改本仓 `api-adapter/` 映射，不修改 Layer 3 业务服务。
