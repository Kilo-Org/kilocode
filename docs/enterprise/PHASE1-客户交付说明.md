# 企业私有化 AI 编程工具 — Phase 1 交付说明

| 项 | 内容 |
|---|---|
| 文档版本 | v1.1 |
| 对应规划 | 《企业私有化 Ai 编程工具 v2.4》Phase 1（基础验证期 / MVP） |
| 适用对象 | 客户技术负责人、信息化部门、试点项目组 |
| 密级建议 | 对外可脱敏后使用 |

---

## 1. Phase 1 要解决什么问题

Phase 1 的目标是验证**技术路线可行**：在贵单位可控环境内，开发者通过定制 VS Code 插件连接私有化 AI 引擎，完成 AI 对话与代码辅助；同时具备 **License 管控原型**、**品牌定制能力** 和 **标准化部署材料**，为 Phase 2 商业化与合规能力打底。

本阶段交付的是 **可演示、可试点** 的 MVP，不是面向全集团上线的生产终版。

---

## 2. 客户可感知的能力（已完成）

### 2.1 开发者插件（VS Code）

| 能力 | 说明 | 客户价值 |
|---|---|---|
| 私有化引擎连接 | 插件可连接贵单位部署的 Kilo Engine（本机或服务器固定地址），不再依赖公网 Kilo 云服务 | 代码与推理流量不出域 |
| 自定义模型接入 | 通过 OpenAI 兼容接口配置国产/私有化大模型（如 GLM、DeepSeek、本地 vLLM 等） | 与现有模型平台对接 |
| License 校验（原型） | 支持在线校验、离线 License 文件；未授权时阻断 AI 功能 | 为按人授权、到期停服做准备 |
| 授权缓存与宽限 | 在线校验成功后可缓存 24 小时；服务短暂不可用时最多 7 天宽限期（可配置） | 提升可用性，降低单点故障影响 |
| 品牌与产品名 | 可配置产品名称；提供开源合规（Apache 2.0）声明入口 | 自有品牌 + 开源协议合规 |
| 企业私有化设置页 | 设置内独立「企业私有化」页，展示 License 状态、Engine 地址、快捷打开配置 | 运维与试点人员可自检 |

### 2.2 部署与集成材料（平台侧）

| 交付物 | 说明 |
|---|---|
| Docker Compose 样例 | 一键编排 Kilo Engine、向量库 Qdrant；可选 GPU 推理（vLLM）、API 网关（APISIX）、License 演示服务 |
| 本机轻量联调方案 | 无需 Docker 时，可用脚本在本机启动 Engine + 插件联调（适合 POC 快速验证） |
| API 网关配置样例 | APISIX 路由、限流（100 次/分钟）、审计日志、流式（SSE）配置说明 |
| 桥接层 POC | Go 语言反向代理示例 + 内部 API 契约草案，便于后续与统一网关、国产模型平台对接 |
| License 演示服务 | 用于 POC 的 Mock 校验接口，模拟正式 License 服务行为 |
| OpenAPI 草案 | License 校验、健康检查等接口定义，便于与客户 IAM/计费系统对接设计 |

### 2.3 文档体系

| 文档 | 用途 |
|---|---|
| 安装部署手册 | 环境要求、镜像构建、Compose 启动、插件配置 |
| 轻量联调指南 | 无 Docker 场景的步骤说明 |
| 端到端联调清单 | 试点验收勾选表 |
| 定制 VSIX 打包说明 | 品牌化插件打包与分发 |
| 安全评审模板 | License 原型已具备/待加强项说明（供贵单位安全评审填写） |
| Phase 2 规划摘要 | 下一阶段商业化与合规能力路线图 |

---

## 3. 典型使用场景（Phase 1 可演示）

```text
开发者 PC
  └── 定制 VS Code 插件
        ├── License 校验（在线 / 离线文件）
        └── 连接 ──► 贵单位 Kilo Engine（本机或内网服务器）
                          └── 私有化大模型 API（OpenAI 兼容）
```

**可选增强路径（测试云已验证，2026-06-14）：**

```text
插件 ──► APISIX 网关（限流、审计）──► Kilo Engine ──► Ruiyu MaaS / 私有化模型
              └── License 服务（POC Mock）
```

测试环境：`43.143.227.210`（OpenCloudOS 9），FullChain 自动化 smoke 已通过。若公网网关端口未对开发机开放，可使用 **SSH 端口转发** 完成同等链路验收（材料见 `PHASE1-VSCODE-CLOUD-TUNNEL.md`）。

---

## 4. 试点验收建议（客户侧）

建议在 **10～50 人试点环境** 按下列项验收（详见内部联调清单，可向项目组索取）：

| 序号 | 验收项 | 通过标准 |
|---|---|---|
| 1 | 插件安装 | 定制 VSIX 安装成功，侧边栏正常打开 |
| 2 | License | 设置页显示「有效」；过期或错误配置时无法使用 AI |
| 3 | 引擎连接 | 显示已连接贵单位 Engine（内网地址） |
| 4 | AI 对话 | 可发起对话并流式返回结果 |
| 5 | 模型配置 | 使用贵单位指定模型端点，无公网 Kilo 网关依赖 |
| 6 | 开源合规 | 可查看 Apache 2.0 相关声明 |

**说明：** 代码补全、P99 延迟、千人并发、等保/国密全栈等属于 Phase 2 或需贵单位 GPU 与环境实测的专项指标，**不作为 Phase 1 硬性交付承诺**。

---

## 5. Phase 1 明确不包含的内容

为避免预期偏差，下列能力 **不在 Phase 1 交付范围**：

| 类别 | 未包含项 | 计划阶段 |
|---|---|---|
| 商业化 | 完整订阅计费、租户管理、管理后台 | Phase 2 |
| 安全（生产级） | RSA/SM2 离线签名校验、硬件指纹绑定、国密全栈 | Phase 2 / 军工版 |
| 权限与审计 | RBAC、三员管理、审计入 ClickHouse、合规报表 | Phase 2～3 |
| 单点登录 | SAML / OIDC 对接 AD/LDAP | **Phase 2**（OIDC 必达） |
| 高可用 | 同城双活、异地灾备落地实施 | Phase 3+ |
| 客户端 | JetBrains 全系列插件 | Phase 3（P1） |
| 生产运维 | 7×24 专属运维、等保测评陪测签字 | 商务合同约定 |

---

## 6. 交付物清单（便于合同或验收附件引用）

### 6.1 软件与配置

- 基于开源 Kilo Code 的 **Fork 定制 VS Code 扩展**（含企业私有化模块）
- 扩展内置/捆绑 **Kilo CLI（Engine）** 构建能力
- 企业相关 **VS Code 配置项**（产品名、远端 Engine、网关地址、License 等）

### 6.2 部署资产目录（仓库路径：`deploy/enterprise/`）

- `docker-compose.yml` — 容器化编排
- `scripts/` — 构建镜像、启动栈、健康检查、本机联调脚本
- `apisix/` — 网关配置与 SSE 验证说明
- `bridge/` — 桥接层 POC 与说明
- `mock-license.mjs` — License POC 服务
- `openapi.yaml` — 接口契约草案
- `samples/offline-license.example.json` — 离线授权文件样例

### 6.3 文档目录（仓库路径：`docs/enterprise/`）

- `PHASE1-客户交付说明.md`（本文档）
- `PHASE1-DEPLOY.md` — 安装部署手册
- `PHASE1-E2E-LOCAL.md` — 无 Docker 轻量联调
- `PHASE1-E2E-CHECKLIST.md` — 联调验收清单
- `PHASE1-VSIX.md` — 插件打包
- `PHASE1-SECURITY-REVIEW.md` — 安全评审模板
- `PHASE1-PHASE2-BACKLOG.md` — 下一阶段能力列表

---

## 7. 开源合规说明（向客户必述）

本产品基于 [Kilo Code](https://github.com/Kilo-Org/kilocode)（Apache License 2.0）构建。

- 插件内提供 **「Enterprise: About & Open Source Notice」** 命令，展示版权声明与许可说明。
- 企业在产品化命名、Logo 上可以自有品牌；须保留对 Kilo Code 上游的许可证义务。
- 企业增值模块（License、私有化部署、网关集成等）为 **独立开发**，与 Kilo Code 开源社区版产品边界分离。

---

## 8. 环境与依赖（客户准备）

| 项 | Phase 1 最低要求 | 推荐（完整 POC） |
|---|---|---|
| 客户端 | VS Code ≥ 1.105，Windows / macOS / Linux | 统一推送定制 VSIX |
| 服务端 | 可运行 Kilo Engine 的 Linux 或本机 Windows 联调 | x86 服务器 + Docker |
| 模型 | 至少一个 OpenAI 兼容 API 端点 | 内网 vLLM / 国产 MaaS |
| 网络 | 插件与 Engine 互通；禁止出域则关闭公网 egress | 内网 DNS / 证书（Phase 2） |
| GPU | 对话试点可不强制 | 代码补全/大模型建议按 v2.4 算力规划 |

---

## 9. Phase 1 与 Phase 2 的衔接

Phase 1 验证 **「插件 + 私有化 Engine + License 原型」** 链路成立后，Phase 2 将重点建设：

- 正式 License / 订阅与只读降级、用量统计  
- RBAC 与 **管理后台**（租户、用户、模型、监控）  
- 桥接层与网关 **生产级** 落地（JWT、审计入库）  
- 离线授权 **RSA/SM2 验签** 与密钥体系  

详细 backlog 见 `PHASE1-PHASE2-BACKLOG.md`。

---

## 10. 文档修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-06-02 | 首版，对齐 Phase 1 MVP 实际交付范围 |
| v1.1 | 2026-06-14 | 补充测试云 FullChain 与 SSH 隧道联调验收说明 |

---

**如需对外 PDF / Word 版本**，可在本文基础上脱敏内部仓库路径与 Git 术语，保留第 2、4、5、7 章即可作为投标或试点方案附件。
