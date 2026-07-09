# 企业私有化 — 文档索引

本目录存放 **基于 Kilo Code 的企业私有化二次开发** 的规划、里程碑、部署与对客户说明。开发维护请以 [二次开发计划.md](./二次开发计划.md) 为总览。

## 规划与总览

| 文档 | 读者 | 说明 |
|---|---|---|
| [二次开发计划.md](./二次开发计划.md) | 研发 / PM | **主计划 v3.0**：对齐外包合同 M1～M5、三批次范围、验收与交付物 |
| [软件外包开发合同_企业私有化AI编程工具.md](./软件外包开发合同_企业私有化AI编程工具.md) | 甲方 / PM | 固定总价、24 周工期、付款与验收法律依据 |
| [验收标准详细说明.md](./验收标准详细说明.md) | QA / 甲方 | **合同附件三**：Phase 1～3 用例与 M2 blocker |
| [开源组件合规报告.md](./开源组件合规报告.md) | 安全 / 法务 | **v1.0**（2026-06-14 扫描，GPL 排查通过） |
| [../企业私有化Ai编程工具v2.4.md](../../企业私有化Ai编程工具v2.4.md) | 产品 / 架构 | 原始商业与技术方案（v2.4） |

## Phase 1（当前）

| 文档 | 读者 | 说明 |
|---|---|---|
| [PHASE1-MILESTONES.md](./PHASE1-MILESTONES.md) | 研发 | 周次任务与内部验收状态 |
| [PHASE1-客户交付说明.md](./PHASE1-客户交付说明.md) | 客户 / 售前 | 对外交付范围与边界 |
| [PHASE1-DEPLOY.md](./PHASE1-DEPLOY.md) | 运维 / 研发 | 安装部署手册 |
| [PHASE1-DEPLOY-CLOUD.md](./PHASE1-DEPLOY-CLOUD.md) | 运维 / 研发 | **云服务器 Docker 部署** |
| [PHASE1-DEPLOY-ENVIRONMENTS.md](./PHASE1-DEPLOY-ENVIRONMENTS.md) | 运维 / 架构 | **公网测试 + 内网生产**、GPU/外部 API |
| [PHASE1-MVP-DELIVERY.md](./PHASE1-MVP-DELIVERY.md) | 研发 / PM | **MVP 交付执行清单**（当前） |
| [验收申请单-Phase1.md](./验收申请单-Phase1.md) | PM / 甲方 | M2 验收申请模板 |
| [PHASE1-E2E-LOCAL.md](./PHASE1-E2E-LOCAL.md) | 研发 | 无 Docker 轻量联调 |
| [PHASE1-E2E-CHECKLIST.md](./PHASE1-E2E-CHECKLIST.md) | 研发 / QA | 端到端验收勾选 |
| [PHASE1-VSIX.md](./PHASE1-VSIX.md) | 研发 | 定制插件打包 |
| [PHASE1-VSCODE-TEST.md](./PHASE1-VSCODE-TEST.md) | 研发 / QA | **VS Code 安装与验收**（不用 Cursor） |
| [PHASE1-DEPLOY-TEST-API.md](./PHASE1-DEPLOY-TEST-API.md) | 运维 | 测试云 + 外部 API |
| [PHASE1-CLOUD-QUICKSTART-43.md](./PHASE1-CLOUD-QUICKSTART-43.md) | 运维 / 研发 | **测试云 43.143.227.210 快速部署** |
| [PHASE1-VSCODE-CLOUD-TUNNEL.md](./PHASE1-VSCODE-CLOUD-TUNNEL.md) | 研发 | **SSH 隧道联调**（公网 9080 未通时） |
| [PHASE1-SECURITY-REVIEW.md](./PHASE1-SECURITY-REVIEW.md) | 安全 | License 原型评审模板 |
| [PHASE1-PHASE2-BACKLOG.md](./PHASE1-PHASE2-BACKLOG.md) | PM | Phase 2 待办 |
| [PHASE2-PLAN.md](./PHASE2-PLAN.md) | PM / 研发 | **Phase 2 开发计划与六周流程**（含 SSO） |
| [PHASE2-W2-CHECKLIST.md](./PHASE2-W2-CHECKLIST.md) | 研发 | **W2** License + RBAC |
| [PHASE2-KICKOFF.md](./PHASE2-KICKOFF.md) | PM | Phase 2 启动会纪要模板 |
| [ADMIN-ANT-DESIGN-PRO.md](./ADMIN-ANT-DESIGN-PRO.md) | 前端 / 全栈 | **管理后台 Ant Design Pro 开发文档**（8 模块规格、API、排期） |
| [P2-USAGE-ANALYTICS-SPEC-v1.md](./P2-USAGE-ANALYTICS-SPEC-v1.md) | PM / QA | **P2 IDE 使用统计口径与验收表**（§7 已验收 2026-07-09） |
| [P2-USAGE-ANALYTICS-CHANGES.md](./P2-USAGE-ANALYTICS-CHANGES.md) | 研发 | P2 使用统计实现变更台账 |
| [P2-ASSESSMENT-SPEC-v1.md](./P2-ASSESSMENT-SPEC-v1.md) | PM / 研发 | **P2 效能考核（V3 个人模型；经理/渗透率可后期补）** |
| [P2-ASSESSMENT-CHANGES.md](./P2-ASSESSMENT-CHANGES.md) | 研发 | P2 效能考核实现变更台账 |
| [AI编程效能度量考核方案_V3.xlsx](./AI编程效能度量考核方案_V3.xlsx) | PM / HR | V3 考核模型与 95 人样例 |

## 部署资产

代码与配置见仓库 `deploy/enterprise/`（Compose、APISIX、桥接 POC、脚本）。

**客户源码仓 skycode（GitHub）发布流程**（内网研发用，不进客户仓）：

| 文档 | 说明 |
|---|---|
| [../../deploy/enterprise/skycode/DELIVERY-WORKFLOW.md](../../deploy/enterprise/skycode/DELIVERY-WORKFLOW.md) | **日常开发后 export → commit → push 步骤** |
| [../../deploy/enterprise/skycode/MANIFEST.md](../../deploy/enterprise/skycode/MANIFEST.md) | 客户仓白名单 / 黑名单 |

联调辅助脚本（仓库根 `scripts/`）：

| 脚本 | 用途 |
|---|---|
| `ssh-tunnel-9080.py` | 本机 9080 → 云机 9080（需 `SSH_PASSWORD` 环境变量） |
| `ssh-tunnel-test.py` | 一次性：建隧道 + health + license 自检 |

## 代码入口（本 Fork）

| 路径 | 层级 |
|---|---|
| `packages/kilo-vscode/src/enterprise/` | Layer 5 企业模块 |
| `packages/kilo-vscode/src/enterprise-config.ts` | 自定义 API / 全局配置 |
| `deploy/enterprise/` | Layer 1/4 部署样例 |

## 修订约定

- 阶段验收更新：`PHASE1-MILESTONES.md` 状态列 + `二次开发计划.md` §进度
- 对客户表述变更：同步 `PHASE1-客户交付说明.md`
- 新阶段启动：新增 `PHASE2-*.md`，在本 README 登记
