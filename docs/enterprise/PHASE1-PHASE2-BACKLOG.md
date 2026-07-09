# Phase 2 Backlog（Phase 1 复盘输入）

对齐 [二次开发计划.md](./二次开发计划.md) v3.2 与 [PHASE2-PLAN.md](./PHASE2-PLAN.md)；Phase 2（M3）目标：**License 完整 + RBAC 三员 + SSO + 后台 8 模块 + 国产模型（含 Minimax）+ 灰度 Fallback**。

## P0 — L3 控制面 + L4 生产入口

| 架构模块 | 说明 |
|---|---|
| L3 License & 订阅引擎 | PG+Redis；在线/离线；只读降级；用量；虚线 → L2 API 抽象 |
| L3 RBAC | 多租户、三员；Auth 实线接入；虚线 → L2 API 抽象 |
| L3 SSO | OIDC 授权码（Blocker）；SAML 或 LDAP 择一；JWT → APISIX |
| L3 模型配置管理 | Endpoint/Fallback/配额；虚线 → L2 配置翻译 |
| L3 管理后台 | Ant Design Pro，8 模块（5/6 可占位） |
| L4 统一鉴权 | JWT 生产配置；Auth 后分流 RBAC / License / API 抽象 |
| L4 限流熔断 | 100～500 req/min，与 L3 租户配额联动 |

## P1 — L2 全量（除索引桥接）

| 架构模块 | 说明 |
|---|---|
| L2 API 抽象封装 | 替代 bridge POC 透传 |
| L2 版本适配器 | v0.x ↔ v1.x |
| L2 配置翻译层 | 服务端下发 kilo.jsonc / 企业 YAML |
| L2 国产模型适配层 | Qwen/DeepSeek/GLM/Minimax → LLM 集群 |
| RSA 离线验签 | 关闭 Phase 1 占位签名 |
| L5 VS Code | 默认经 L4；SSO 浏览器登录 |

## P2 — Phase 3 前置 / 规模化

| 架构模块 | 说明 |
|---|---|
| L4 灰度发布 | Traffic-Split |
| L4 请求审计 | Kafka → ClickHouse（与 L3 审计分工） |
| L3 审计日志 | WORM + 哈希链（Phase 3 主交付） |
| L2 索引服务桥接 | → **Kilo CLI**；租户 Collection |
| L5 JetBrains | IntelliJ SDK + L4 |
| L4 国密 SSL | 军工版（Phase 3） |
| SSO 国密 / 多 IdP 现场 | Phase 3 与密评联动 |

## Phase 1 遗留转交

| ID | 项 |
|---|---|
| P1-W2-02 | 独立 `enterprise-bridge` 仓库（或 monorepo `deploy/enterprise/bridge` 正式化） |
| P1-W6-04 | 本安全评审纪要签字 |
| A2 | 14B 模型 P95 延迟（需 GPU 环境实测） |
