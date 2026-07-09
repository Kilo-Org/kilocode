# Phase 2 — W6 联调验收清单

**周次：** W6  
**目标：** E2E 自动化全绿、附件三 Blocker 证据、验收申请单。

---

## 自动化（云机执行）

```bash
cd /root/kilocode-main/deploy/enterprise
chmod +x scripts/smoke-phase2-all.sh

# 可选：公网 HTTPS 探测
export PUBLIC_PLATFORM_URL=https://wab.flyfishphp.cn
export PUBLIC_LOGTO_URL=https://logto.wab.flyfishphp.cn

./scripts/smoke-phase2-all.sh
```

| ID | 脚本 / 命令 | 状态 |
|---|---|---|
| W6-01 | `smoke-phase2.sh` | ✅ |
| W6-02 | `smoke-phase2-w3.sh` | ✅ |
| W6-03 | `smoke-phase2-w4.sh` | ✅ |
| W6-04 | `e2e-smoke.sh --full-chain` | ✅ |
| W6-05 | RBAC 三员互斥 | `smoke-rbac.sh`（HTTP，免拉 golang 镜像） | ✅ |
| W6-06 | Logto discovery HTTPS | ✅ |
| W6-07 | `smoke-phase2-all.sh` 总脚本 | ✅ 2026-06-02 ALL PASSED |

---

## Blocker 手工 / 浏览器（附件三 §3.4）

| ID | 用例 | 状态 | 证据 |
|---|---|---|---|
| P2-L3-02 | License 在线校验 | ✅ W2 smoke | |
| P2-L3-08 | OIDC Logto 登录 | ✅ 2026-06-22 浏览器 | 录屏 |
| P2-L3-10 | 后台 1～4、7、8 | ✅ W4 admin | 走查 |
| P2-L2-01～04 | deepseek 配置翻译 | ✅ W4 smoke apply | generated.kilo.jsonc |
| P2-L2-05 | 配置下发 Engine | ✅ force-recreate | |
| P2-L3-09 | VS Code SSO + 对话 | ✅ 2026-06-23 | VSIX enterprise.2 + 录屏 |
| P2-L4-01/02 | 灰度 / Fallback | ⏸ W5 延期 | 见 §延期项 |

---

## 延期 / 非 Blocker（W5）

| 项 | 说明 |
|---|---|
| P2-L3-09 | VS Code 插件 SSO + 默认网关 | ✅ 2026-06-23 gatekeeper 直连 |
| P2-L4-01 | `X-Canary` traffic-split |
| P2-L4-02 | Fallback upstream |
| P2-L3-03/04/05/06/07 | 到期降级、离线 RSA、用量、跨租户 — 部分有单测/ smoke，完整演示可 Phase 3 补强 |

---

## 交付物

| 文档 | 路径 |
|---|---|
| E2E 清单 | [PHASE2-E2E-CHECKLIST.md](./PHASE2-E2E-CHECKLIST.md) |
| 验收申请单 | [验收申请单-Phase2.md](./验收申请单-Phase2.md) |
| 总脚本 | `deploy/enterprise/scripts/smoke-phase2-all.sh` |

---

## 修订

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-06-22 | W6 联调验收骨架 |
| v1.2 | 2026-06-23 | P2-L3-09 插件 SSO + 对话验收 |
