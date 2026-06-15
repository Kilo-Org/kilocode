# Phase 1 License 原型 — 安全评审纪要（模板）

**评审对象**：`enterprise/license.ts`、离线 JSON、`mock-license.mjs`  
**阶段**：Phase 1 原型（非生产）  
**密级**：内部

## 1. 已实现控制

| 控制 | 说明 |
|---|---|
| 在线校验 | `POST /api/v1/license/verify`，失败阻断 CLI 连接 |
| 缓存 | 成功结果缓存 24h（可配置） |
| 宽限期 | 服务不可达时 7 天内沿用上次成功结果（可配置） |
| 离线文件 | 校验 `expiresAt`、可选 `key` 匹配、**RSA-SHA256 签名**（`license-crypto.ts`） |
| 密钥 | Engine 密码经 `KILO_SERVER_PASSWORD` / 设置项，不写死仓库 |

## 2. Phase 1 已知缺口（Phase 2 必须关闭）

| 缺口 | 风险 | 计划 |
|---|---|---|
| RSA 离线为原型实现 | 无私钥 HSM；公钥需安全分发 | Phase 2 服务端签发 + 密钥轮换 |
| 无硬件指纹绑定 | 授权可复制 | Phase 2 军工版 |
| Mock 服务无鉴权 | 仅 POC 环境 | 生产换 Go License 服务 + mTLS |
| 宽限期 7 天 | 长期断网仍可用 | 可配置降至 0–1 天（企业版） |

## 3. 评审结论（填写）

| 项 | 结论 |
|---|---|
| POC / 试点 | ✅ 通过（RSA 原型 + 在线 Mock） | 生产禁止 |
| 生产 | ⬜ 禁止（待 Phase 2） |

签字：________  日期：________
