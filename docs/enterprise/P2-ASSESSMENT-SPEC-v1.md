# P2 AI 编程效能考核 — 开发规格 v1

面向 **私有化 Platform 管理后台**，在 [P2 使用统计](./P2-USAGE-ANALYTICS-SPEC-v1.md) 明细数据之上，提供 **可排名、可分级** 的个人考核能力。  
业务模型来源：[AI编程效能度量考核方案_V3.xlsx](./AI编程效能度量考核方案_V3.xlsx)（V3：三维核心 + 效率校验）。

| 项 | 定稿 |
|---|---|
| 前置依赖 | P2 使用统计 v1 已验收（`usage_events` + 四 Tab 明细 + xlsx 导出） |
| 时区 | **Asia/Shanghai**（与使用统计一致） |
| 考核对象（Phase A） | 租户内 **个人**（按邮箱/用户） |
| 考核对象（Phase B，可选） | **研发经理 / 团队**（需组织树，后期补） |
| 数据目的地 | 客户 Platform PostgreSQL（评分结果可落库或按需计算） |
| 实现变更记录 | 开发期维护 **`P2-ASSESSMENT-CHANGES.md`**（见 §11） |

**与「使用分析」的关系：**

| 模块 | 目的 | 用户感知 |
|---|---|---|
| 使用分析（已有） | 透明、可审计的 **原始指标明细** | 「用了多少、采纳多少」 |
| 效能考核（本文） | **加权算分 + 等级** | 「本期考核几分、什么档」 |

两模块 **UI 与权限分离**；考核结果不得与明细报表混为一 Tab，避免员工质疑口径不一致。

---

## 1. 分期交付（待定项可后置）

| 阶段 | 范围 | 依赖 | 默认 |
|---|---|---|---|
| **Phase A** | 个人 V3 考核：派生指标 → 归一化 → 加权 → 效率乘数 → A～E | P2 明细聚合字段 | **首期必做** |
| **Phase B** | 管理者团队考核（五维 + 团队等级） | Phase A 个人综合分 + **HR 组织树** | **可选，后期补** |
| **Phase C** | 渗透率真算（AI / (AI+人工)） | **`human.chars` 或 Git 等** | **可选，后期补** |

**决策可后置说明：**

- **不上组织树**：Phase A 仍可交付个人榜、等级分布、考核 xlsx；经理榜可用 Excel 手工分组过渡。
- **不采人工产出**：Phase A 不受影响；Phase B 可将「渗透率」权重置 0，或暂用四维度（覆盖率、活跃度、标杆率、托底分）替代。

---

## 2. 架构

```
usage_events（已有）
    → 周期聚合（与使用分析同源，Asia/Shanghai）
    → 派生指标（AI总采纳字符、活跃参与、产出效率…）
    → 评分引擎（对数归一化 + 权重 + 效率乘数）
    → 个人综合分 + 等级（Phase A）
    → [可选] 按 team 聚合 → 经理团队分（Phase B）
    → 管理后台「效能考核」Tab + 考核 xlsx 导出
```

**路径约束（与 P2 使用统计 §8 一致）：**

| 层级 | 路径 |
|---|---|
| 评分引擎、API、导出 | `deploy/enterprise/platform/` |
| 管理后台 | `deploy/enterprise/platform/admin-ui/` |
| 组织树、HR 导入 | `deploy/enterprise/platform/`（Phase B 新增表，与 `usage_events` 解耦） |
| 人工产出采集 | `packages/kilo-vscode/src/enterprise/` 或 Git 集成（Phase C，单独批次） |
| **禁止** | 在 `packages/opencode/` 非 `kilocode` 路径内嵌考核逻辑 |

---

## 3. Phase A — 个人 V3 考核模型

### 3.1 综合分公式

```
基础得分 = 有效产出×W1 + 交互深度×W2 + 活跃参与×W3
综合得分 = 基础得分 × 效率校验乘数
```

**默认权重（V3，可配置）：**

| 维度 | 权重 W | 指标名称 |
|---|---|---|
| 有效产出 | **40%** | AI总采纳字符数 |
| 交互深度 | **30%** | Token 使用量 |
| 活跃参与 | **30%** | 智能体触发 + 补全采纳 |

默认 `W1=0.40, W2=0.30, W3=0.30`；实现时写入租户级或全局 **考核策略配置**（见 §6）。

### 3.2 派生指标（由 P2 明细汇总）

周期内、单用户、**合并 IDE**（与使用分析 Sheet1 一致）：

| 派生字段 | 计算公式 | P2 明细来源 |
|---|---|---|
| `aiAcceptedChars` | 补全采纳字符 + 智能体编程采纳字符 | `completionAcceptedChars + agentAcceptedChars` |
| `tokenTotal` | Σ LLM input+output | `tokens` |
| `activeParticipation` | 智能体任务触发 + 补全采纳次数 | `agentTriggered + completionAccepted` |
| `outputEfficiency` | `aiAcceptedChars / tokenTotal` | 仅 `tokenTotal > 0` 时计算 |

**V3 考核 deliberately 不使用（防作弊，与 xlsx「指标筛选分析」一致）：**

| 排除项 | 原因 |
|---|---|
| 各类采纳率 | 可先全采纳再手改；智能体采纳率区分度低 |
| 智能体编辑文件次数 | 一次对话多文件，易刷分 |
| 补全建议次数 | 与采纳高度相关 |
| inline / 注释 / 优化 / 人工字符 | V3 个人分排除（注释/优化/人工在 P2 报表可为 0） |

### 3.3 对数归一化

对周期内 **参与考核的用户集合**（默认：租户内至少 1 条 usage 的用户），每个维度：

```
score_dim = ln(x + 1) / ln(max_dim + 1) × 100
```

其中 `max_dim` 为该周期、该租户内该维度的 **最大值**（非历史全局 max）。

### 3.4 效率校验乘数

```
outputEfficiency = aiAcceptedChars / tokenTotal   （tokenTotal > 0）
```

按周期内 **产出效率排名分位**（仅 tokenTotal>0 的用户参与排名）：

| 档位 | 条件 | 乘数 |
|---|---|---|
| 极高效率 | 排名 > P80 | 1.15 |
| 高效率 | P60～P80 | 1.08 |
| 正常 | P40～P60 | 1.00 |
| 低效率 | P20～P40 | 0.95 |
| 零产出（低 Token） | aiAcceptedChars=0 且 tokenTotal ≤ 周期 Token 中位数 | 0.95 |
| 零产出（高 Token） | aiAcceptedChars=0 且 tokenTotal > 周期 Token 中位数 | 0.82 |

`tokenTotal = 0` 的用户：效率乘数 **1.00**（或无 Token 则不乘，产品二选一；V3 样例中 Token=0 且仅有触发/采纳者乘数为 1）。

### 3.5 考核等级（默认 V3）

| 等级 | 综合得分 | 样例占比（参考，非强制） |
|---|---|---|
| A（优秀） | ≥ 80 | ~20% |
| B（良好） | 60～79 | ~18% |
| C（达标） | 40～59 | ~13% |
| D（待提升） | 20～39 | ~45% |
| E（需关注） | < 20 | ~4% |

等级线 **可配置**；是否强制正态分布由客户 HR 政策决定，系统 **只提供分数与默认映射**。

### 3.6 活跃天数

V3 样例中 **活跃天数不参与个人评分**（区分度低，多数 4～5 天）。  
可选产品规则（实现时开关）：

- 活跃天数 < N：不参与排名 / 显示「数据不足」
- 默认 N 不启用

---

## 4. Phase B — 管理者考核（可选，后期）

来源：xlsx「管理者考核体系」。**依赖 HR 组织树**：用户 → 团队 → 经理。

```
团队管理得分 = 覆盖率×0.20 + 渗透率×0.25 + 活跃度×0.20 + 标杆率×0.20 + 托底分×0.15
```

| 维度 | 定义 | Phase B 无组织树时 |
|---|---|---|
| 覆盖率 | Token>0 或有 AI 产出人数 / 团队人数 | 不可用 |
| 渗透率 | AI采纳 / (AI采纳 + **人工产出**) | 见 Phase C；或 **权重置 0** |
| 活跃度 | 团队人均 Token vs 公司均值 | 需组织树 |
| 标杆率 | 综合分≥60 人数占比 | 需组织树 + Phase A |
| 托底分 | 后 20% 成员均分 | 需组织树 + Phase A |

**组织数据模型（预留，Phase B 再 migration）：**

| 表/配置 | 字段（草案） |
|---|---|
| `org_teams` | id, tenant_id, name, manager_user_id |
| `org_memberships` | tenant_id, user_id, team_id, effective_from, effective_to |

HR 导入：CSV/API，**不与 usage_events 混表**。

---

## 5. Phase C — 人工产出 / 渗透率（可选，后期）

| 方案 | 说明 | 影响 |
|---|---|---|
| A. IDE `human.chars` | P2 事件契约已有，当前恒 0 | 需 VS Code 采集规则定义 |
| B. Git 增删行 | 周期内 commit 增量 | 需仓库绑定、隐私评审 |
| C. 暂不启用渗透率 | Phase B 四维度或渗透率权重=0 | **推荐默认** |

渗透率 **不影响 Phase A 个人 V3 公式**。

---

## 6. Platform 能力（开发项摘要）

### 6.1 Phase A API（草案）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/usage/assessment/report?from=&to=` | 个人榜：原始派生 + 三维分 + 乘数 + 综合分 + 等级 |
| GET | `/api/v1/usage/assessment/export?from=&to=` | xlsx，结构对齐 V3「考核评分结果」sheet |
| GET | `/api/v1/usage/assessment/config` | 读考核策略（权重、等级线） |
| PUT | `/api/v1/usage/assessment/config` | 改策略（tenant_admin） |

权限：与使用分析一致 — `tenant_admin` / `audit_admin` 本租户；普通研发 **默认不可见他人分数**（可配置仅 HR/管理员可见）。

### 6.2 管理后台（Phase A）

路径建议：`/admin/usage` 下新增 Tab **「效能考核」**（与「使用分析」并列）。

| 区块 | 内容 |
|---|---|
| 筛选 | 日期范围（上海时区） |
| 个人榜 | 排名、姓名、邮箱、派生指标、三维分、基础分、效率乘数、综合分、等级 |
| 分布 | A～E 人数占比（柱状/表） |
| 说明 | 固定文案：不含采纳率；效率乘数防刷 Token；与明细 Tab 分工 |
| 导出 | `assessment_report-{from}-{to}.xlsx` |

### 6.3 计算时机

| 策略 | 优缺点 |
|---|---|
| **按需计算**（推荐 Phase A） | 无新表；周期查询时从 `usage_events` 聚合 + 内存算分；95～500 人规模可接受 |
| 落库快照 | 便于历史策略变更对比；Phase A 可不做了，除非客户要求「改权重不影响历史」 |

若落库，表名建议 `usage_assessment_snapshots`（Phase A 可选，非 Blocker）。

---

## 7. 字段映射（P2 明细 → 考核输入）

复用 [P2-USAGE-ANALYTICS-SPEC-v1.md](./P2-USAGE-ANALYTICS-SPEC-v1.md) 周期聚合逻辑，**不重复实现一套 ingestion**。

| 考核输入 | userSummaryRow（JSON）字段 |
|---|---|
| 补全采纳字符 | `completionAcceptedChars` |
| 智能体编程采纳字符 | `agentAcceptedChars` |
| Token | `tokens` |
| 智能体触发 | `agentTriggered` |
| 补全采纳次数 | `completionAccepted` |
| 活跃天数（参考） | `activeDays` |

实现应 **调用或抽取** `buildReport` 同级聚合，避免两套口径分叉。

---

## 8. 验收检查表（Phase A）

### 8.1 数据与公式

| # | 检查项 | 通过 |
|---|---|---|
| A1 | 同一周期，考核输入与「使用分析」Sheet1 关键字段一致 | ☐ |
| A2 | AI总采纳字符 = 补全采纳字符 + 智能体采纳字符 | ☐ |
| A3 | 活跃参与 = 触发 + 补全采纳（非编辑文件数） | ☐ |
| A4 | 对数归一化使用周期内 max | ☐ |
| A5 | 效率乘数分位与 V3 表一致（样例周期回放误差 < 0.1 分） | ☐ |
| A6 | 综合分 = 基础分 × 乘数，等级映射正确 | ☐ |

### 8.2 产品

| # | 检查项 | 通过 |
|---|---|---|
| B1 | 「效能考核」与「使用分析」分 Tab | ☐ |
| B2 | 导出 xlsx 列与 V3「考核评分结果」一致 | ☐ |
| B3 | 非管理员不能查看他人分数（默认） | ☐ |
| B4 | 考核策略权重可读；改权重后重新算分生效 | ☐ |

### 8.3 回放验收（推荐）

用 V3 xlsx 同周期 **2026-06-22～2026-06-26**、同租户 95 人明细：

- 取前 5 名与后 5 名综合分与等级对比 V3 样例
- 允许浮点误差；排名顺序一致

---

## 9. Fork 升级友好约束

与 [P2-USAGE-ANALYTICS-SPEC-v1.md §8](./P2-USAGE-ANALYTICS-SPEC-v1.md) 相同：

- 评分逻辑 **仅** 在 `deploy/enterprise/platform/`（Go）与 admin-ui
- 不修改 `usage_events` schema 即可交付 Phase A
- Phase B/C 通过 **新表 / 新事件** 扩展，不改 Phase A 公式

---

## 10. 实现顺序（开发阶段）

1. 本文档定稿（v1）✓  
2. 创建 **`P2-ASSESSMENT-CHANGES.md`**  
3. Platform：抽取聚合 → 派生指标 → V3 评分纯函数 + 单测（固定 V3 样例行）  
4. API：report + export  
5. Admin：效能考核 Tab + 导出  
6. §8 验收；回放 V3 xlsx 样例  
7. [可选] Phase B 组织树 + 经理榜  
8. [可选] Phase C 人工产出 + 渗透率  

---

## 11. 变更台账

| 项 | 路径 |
|---|---|
| 台账文件 | **`docs/enterprise/P2-ASSESSMENT-CHANGES.md`** |
| 批次 ID | `P2-A-001` 起（Assessment），与使用统计 `P2-001` 系列区分 |
| 创建时机 | 说「开始写考核代码」后、首次改代码前 |

---

## 12. 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1 | 2026-07-09 | 初稿：Phase A/B/C 分期；V3 个人模型；组织树与人工产出可后置 |
