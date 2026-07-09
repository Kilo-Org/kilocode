# Phase 2 — W4 关项清单

**周次：** W4  
**目标：** Admin 8 模块 MVP、L3 模型配置翻译下发、4 家 Provider 配置冒烟。

---

## 交付物

| 路径 | 说明 |
|---|---|
| `migrations/000005_model_config.up.sql` | 模型配置 + 审计表 |
| `internal/model/` | kilo.jsonc 翻译 + GET/PUT/apply |
| `internal/admin/static/` | 8 模块管理后台（静态 SPA） |
| `internal/tenant|usage|monitor|audit/` | 各模块 API |
| `scripts/smoke-phase2-w4.sh` | W4 验收脚本 |

---

## 云机部署

```bash
cd /root/kilocode-main/deploy/enterprise

# platform 写入 ./config/generated.kilo.jsonc（与 engine 共享目录）
docker compose --profile platform up -d --build enterprise-platform

chmod +x scripts/smoke-phase2-w4.sh
./scripts/smoke-phase2-w4.sh

# 使 Engine 加载新配置
docker compose up -d --force-recreate kilo-engine
```

管理后台：`http://<host>:8090/admin/`（或经 APISIX `/admin/`）

---

## W4 关项勾选

| ID | 项 | 状态 |
|---|---|---|
| W4-01 | Admin 8 模块页面可访问 | ✅ smoke admin 200 |
| W4-02 | `GET/PUT /api/v1/model-config` | ✅ put deepseek OK |
| W4-03 | `POST apply` 生成 `generated.kilo.jsonc` | ✅ 宿主机已生成 |
| W4-04 | deepseek 翻译冒烟 | ✅ smoke-phase2-w4（仅 deepseek） |
| W4-05 | 监控/用量/审计 API | ✅ smoke 通过 |
| W4-06 | Engine recreate 后配置生效 | ✅ force-recreate 已执行 |

**云机 smoke（2026-06-18）：** phase `2-w4` 全绿；最终 apply 为 minimax（见 `generated.kilo.jsonc`）。

确认 Engine 挂载路径（`.env`）：

```bash
grep KILO_ENGINE_CONFIG .env
# 应为：KILO_ENGINE_CONFIG=./config/generated.kilo.jsonc
head -5 config/generated.kilo.jsonc
```

---

## 修订

| 版本 | 日期 | 说明 |
|---|---|---|
| v1.0 | 2026-06-18 | W4 Admin + 模型配置骨架 |
| v1.1 | 2026-06-18 | W4-01～06 云机 smoke + engine recreate |

---

## W5 预告

- APISIX traffic-split 灰度
- Fallback upstream
- VS Code SSO + 默认网关
