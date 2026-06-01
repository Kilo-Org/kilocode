# Layer 2 防腐桥接层（Phase 1 契约）

独立仓库建议名：`enterprise-bridge`（Go）。

## 职责

| 组件 | Phase 1 | Phase 2+ |
|---|---|---|
| API 抽象 | 透传 `POST /v1/chat/completions` → Kilo Engine | 统一内部 `/internal/v1/*` |
| 版本适配 | 占位 | Kilo 版本字段映射 |
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

Phase 1 允许 **Extension → APISIX → Kilo Engine** 直连，不强制经过 bridge。桥接全量在 Phase 2 与 License/RBAC 同网关路由。

## 上游合并

Kilo Engine 升级时仅修改本仓 `api-adapter/` 映射，不修改 Layer 3 业务服务。
