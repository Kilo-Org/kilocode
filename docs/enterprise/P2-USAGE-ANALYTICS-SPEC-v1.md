# P2 客户使用统计 — 口径说明 v1

面向 **私有化 Platform 管理后台**，读者为 **租户管理员**（仅本租户数据）。  
参照样例：`docs/enterprise/analysis_report-2026-6-22-2026-6-26.xlsx`（四 sheet）。

| 项 | 定稿 |
|---|---|
| 时区 | **Asia/Shanghai**（自然日切分、日期筛选、导出均以此为准） |
| IDE 枚举 | `vscode` \| `jetbrains` \| `android`（导出与 UI 用规范名 `jetbrains`，不用 jetbrain） |
| 客户端 | 当前仅 **VS Code** 实际上报；JetBrains / Android 预留 schema，值为 0 直至插件就绪 |
| 数据目的地 | 客户 Platform PostgreSQL（**不走 PostHog**） |
| 实现变更记录 | 开发期维护 **`docs/enterprise/P2-USAGE-ANALYTICS-CHANGES.md`**（见 §9） |
| 效能考核（算分/等级） | 见 **[P2-ASSESSMENT-SPEC-v1.md](./P2-ASSESSMENT-SPEC-v1.md)**（基于本规格明细，独立模块） |

---

## 1. 架构

```
VS Code / JetBrains / Android
    → 企业 usage 上报（复用现有埋点触发点，目的地 Platform）
    → Platform POST /api/v1/usage/...（ingestion，实现阶段定义）
    → PostgreSQL（原始事件 + 日聚合）
    → 管理后台「使用分析」+ 导出 xlsx（四 sheet）
```

权限：`tenant_admin`（可选 `audit_admin`）仅本租户；`sys_admin` 是否可看跨租户由产品另定（默认 P2 不做贵司跨客户汇总）。

---

## 2. 企业 Usage 事件（统一契约）

每条上报包含（客户端 + 服务端校验）：

| 字段 | 说明 |
|---|---|
| `tenant_id` | 服务端从 JWT 解析 |
| `user_email` | 与 SSO / Platform 用户表一致 |
| `ide` | `vscode` \| `jetbrains` \| `android` |
| `occurred_at` | ISO8601；聚合按 **Asia/Shanghai** 切日 |
| `event` | 见下表 |
| `metrics` | 事件附带计数（JSON） |

### 2.1 事件名与 xlsx 列对应

| 企业事件 | xlsx 用途 |
|---|---|
| `completion.suggested` | 补全建议次数 |
| `completion.accepted` | 补全采纳次数；metrics: `chars`, `lines` |
| `comment.line.generated` / `.accepted` | 逐行注释（P2 无能力 → 0） |
| `comment.func.generated` / `.accepted` | 函数注释（P2 → 0） |
| `optimize.generated` / `.accepted` | 代码优化（P2 → 0） |
| `agent.task.triggered` | 智能体任务触发次数 |
| `agent.file.edited` | 智能体编辑文件；metrics: `path`（去重用） |
| `agent.file.edit_accepted` | 采纳智能体编辑文件 |
| `inline.accepted` | inline 采纳字符；metrics: `chars` |
| `human.chars` | 人工产生字符（P2 → 0） |
| `llm.tokens` | Token；metrics: `input`, `output` |

---

## 3. 指标口径（定稿）

### 3.1 Token 使用量

```
Token使用量 = Σ (每次 LLM 调用的 inputTokens + outputTokens)
```

- 含：对话、Agent、补全、inline 等 **所有 LLM 调用**
- 不含：cache read/write 单独计数（不进 xlsx）
- 纯本地 cache 补全不计 Token

### 3.2 补全

| 指标 | 定义 |
|---|---|
| 补全建议次数 | 每次 **唯一补全展示** 计 1（含 LLM 与 cache 展示） |
| 补全采纳次数 | 用户 Accept/Tab 采纳计 1 |
| 补全采纳行数 | 采纳文本按 `\n` 分行，至少 1 |
| 代码补全采纳字符 | 采纳文本字符长度 |
| 补全采纳率 | 补全采纳次数 ÷ 补全建议次数；分母 0 → **0** |

### 3.3 逐行注释 / 函数注释 / 代码优化 / 人工产生字符

**P2：列与导出保留，数值恒为 0。**  
说明：当前 Kilo 无对应独立产品能力；功能上线后接入 `comment.*` / `optimize.*` / `human.chars` 事件。

采纳率分母为 0 时 → **0**。

### 3.4 智能体

| 指标 | 定义 |
|---|---|
| 智能体任务触发次数 | 用户 **主动发起** 的一次 Agent 任务 = 一条启动/继续 Agent 执行的 **用户消息** |
| 智能体任务编辑文件次数 | write/edit/patch 类 tool **成功写盘**；按 **上海自然日 × 用户 × ide × 文件路径** 去重计 1 |
| 采纳智能体任务编辑文件次数 | 上述编辑在 session 结束前 **未被 checkpoint restore 覆盖该文件** |
| 智能体编程采纳字符 | 计为「采纳」的编辑，按 **本次 patch 插入+替换字符数** 累加 |
| 智能体编辑采纳率 | 采纳编辑文件次数 ÷ 编辑文件次数；分母 0 → **0** |

**周期汇总（Sheet1）**：对周期内 **每个自然日** 的「编辑文件次数」**求和**（同文件不同天各算 1）。

### 3.5 inline

| 指标 | 定义 |
|---|---|
| inline采纳字符 | Inline Assist / inline edit 入口写入编辑器的字符数；与补全采纳 **互斥**（按产品入口区分） |

### 3.6 活跃与 IDE 展示

| 指标 | 定义 |
|---|---|
| **活跃天数** | 周期内，该用户 **任意 IDE** 至少 1 条 usage 事件的 **上海自然日** 天数（合并 IDE） |
| **IDE 列** | 每个 ide 各自有事件的自然日数，格式：`vscode(4天), jetbrains(2天)`（仅展示有数据的 ide，顺序 vscode → jetbrains → android） |

### 3.7 趋势

对比 **上一段等长周期** 的 Token使用量：

| 条件 | 显示 |
|---|---|
| 环比 ≥ +10% | 📈 上升 |
| 环比 ≤ -10% | 📉 下降 |
| 之间 | ➡️ 平稳 |
| 上周期无数据，或本周期活跃 **< 2 天** | — 数据不足 |

### 3.8 排名

周期内按 **Token使用量** 降序；相同则 **活跃天数** 降序。

### 3.9 姓名

Platform 用户表 `display_name`；无则回退邮箱本地部分。

---

## 4. 四 Sheet 规格

### Sheet1 — 用户汇总

一行 = 一用户（周期内合并 IDE）。列顺序与样例 xlsx 一致：

排名、姓名、邮箱、IDE、活跃天数、趋势、  
补全建议次数、补全采纳次数、补全采纳行数、  
逐行注释生成次数、逐行注释采纳次数、函数注释生成次数、函数注释采纳次数、  
代码优化生成次数、代码优化采纳次数、  
智能体任务触发次数、智能体任务编辑文件次数、采纳智能体任务编辑文件次数、  
代码补全采纳字符、inline采纳字符、智能体编程采纳字符、人工产生字符、  
Token使用量、  
补全采纳率、逐行注释采纳率、函数注释采纳率、代码优化采纳率、智能体编辑采纳率

### Sheet2 — IDE 分类统计

一行 = 一个 ide（`vscode` / `jetbrains` / `android` 三行常驻，无数据为 0）。  
指标列为 Sheet1 去掉排名/姓名/邮箱/趋势后的 **租户级 SUM**。

### Sheet3 — 每日明细

一行 = **日期 × 邮箱 × ide**。  
列：日期、姓名、邮箱、IDE + Sheet1 中计数/字符/Token 列（无排名/趋势/采纳率）。

### Sheet4 — 未使用用户

本租户 **Platform 用户全集** LEFT JOIN 周期内有任意 usage 的用户 → 无记录者。  
列：姓名、邮箱。

---

## 5. VS Code 映射（实现参考）

| 现有埋点（插件/CLI） | 企业事件 |
|---|---|
| `AUTOCOMPLETE_UNIQUE_SUGGESTION_SHOWN` / cache 展示 | `completion.suggested` |
| `AUTOCOMPLETE_ACCEPT_SUGGESTION` + length | `completion.accepted` |
| `LLM Completion` tokens | `llm.tokens` |
| Agent 用户消息 / 任务消息 | `agent.task.triggered` |
| `TOOL_USED`（write/edit/patch） | `agent.file.edited` |
| session 结束且无 restore | `agent.file.edit_accepted` |
| patch 字符统计 | 智能体编程采纳字符 |
| `INLINE_ASSIST_AUTO_TASK` + chars | `inline.accepted` |

JetBrains / Android：同一契约，仅 `ide` 不同。

---

## 6. 管理后台（P2 交付）

- 菜单：**使用分析**（或扩展「用量」）
- 日期范围选择（上海时区）
- 四 Tab 对应四 sheet，列与导出一致
- **导出 xlsx**：文件名 `analysis_report-{from}-{to}.xlsx`，四 sheet 同名
- 说明文案：注释/优化/人工字符 P2 为 0；jetbrains/android 暂无客户端数据

---

## 7. 验收检查表

### 7.1 环境与权限

| # | 检查项 | 通过 |
|---|---|---|
| A1 | 租户管理员登录，仅见本租户数据 | ✅ |
| A2 | 非 tenant_admin 无法访问使用分析 | ✅ |
| A3 | 日期默认近 7 天，可选范围，按 Asia/Shanghai 切日 | ✅ |

### 7.2 Sheet1 用户汇总

| # | 检查项 | 通过 |
|---|---|---|
| B1 | 列名与顺序与样例 xlsx 一致（28 列） | ✅ |
| B2 | 排名按 Token 降序，同分按活跃天数 | ✅ |
| B3 | 姓名来自用户表，邮箱与 SSO 一致 | ✅ |
| B4 | IDE 列格式 `vscode(N天)`，多 IDE 逗号分隔 | ✅ |
| B5 | 活跃天数 = 合并 IDE 的有事件自然日 | ✅ |
| B6 | 趋势：环比 Token ±10% 规则；<2 天活跃为「数据不足」 | ✅ |
| B7 | 补全建议/采纳/行数/字符与 VS Code 实测一致 | ✅ |
| B8 | Token = 全 LLM input+output 加总 | ✅ |
| B9 | 五种采纳率公式正确，分母 0 为 0 | ✅ |
| B10 | 注释/优化/人工字符列存在且为 0 | ✅ |

### 7.3 Sheet2 IDE 分类

| # | 检查项 | 通过 |
|---|---|---|
| C1 | 固定三行：vscode、jetbrains、android | ✅ |
| C2 | vscode 有数据时 SUM 与 Sheet1 租户合计一致 | ✅ |
| C3 | jetbrains、android 当前为 0 | ✅ |

### 7.4 Sheet3 每日明细

| # | 检查项 | 通过 |
|---|---|---|
| D1 | 粒度：日期 × 用户 × ide | ✅ |
| D2 | 某日仅 vscode 使用时仅 vscode 行 | ✅ |
| D3 | 日 Token 之和 ≤ Sheet1 用户 Token（允许四舍五入误差） | ✅ |

### 7.5 Sheet4 未使用用户

| # | 检查项 | 通过 |
|---|---|---|
| E1 | 周期内无 usage 的租户用户均列出 | ✅ |
| E2 | 有 usage 的用户不出现 | ✅ |

### 7.6 导出

| # | 检查项 | 通过 |
|---|---|---|
| F1 | 导出 xlsx 含四 sheet，名称与样例一致 | ✅ |
| F2 | 导出数据与页面同范围一致 | ✅ |
| F3 | Excel 打开中文列名无乱码 | ✅ |

### 7.7 VS Code 联调（最小场景）

| # | 操作 | 期望 | 通过 |
|---|---|---|---|
| G1 | 用户 A 1 天内：触发补全展示 10 次、采纳 3 次 | Sheet1/3 建议 10、采纳 3；采纳率 30% | ✅ |
| G2 | 用户 A 发起 2 次 Agent 任务，改 1 个文件且未 revert | 触发 2；编辑文件 1；采纳 1；采纳率 100% | ✅ |
| G3 | 选择跨 2 个上海自然日 | Sheet3 两行；Sheet1 活跃天数 2 | ✅ |
| G4 | 导出 xlsx 与页面数字一致 | 四 sheet 与 Tab 一致 | ✅ |

---

## 8. Fork 升级友好约束

本仓库为 **Kilo / OpenCode fork**。P2 实现须遵守下列边界，避免在 `packages/opencode/` 共享区堆积 diff，影响日后合并 upstream。

### 8.1 路径分级

| 路径 | 与 upstream 关系 | P2 改动策略 |
|---|---|---|
| `deploy/enterprise/` | 非 opencode 一部分 | 自由实现（Platform、admin-ui、ingestion、聚合、导出） |
| `packages/kilo-vscode/` | Kilo 扩展整包自有 | 自由实现；企业逻辑放 `src/enterprise/` |
| `packages/opencode/src/kilocode/` | Kilo 专用目录 | CLI 侧 Token / Tool 等 **优先在此** 增加 Platform 转发 |
| `packages/opencode/` 其它共享文件 | 与 upstream 共用 | **禁止**仅为 usage 统计而修改（见 §8.2） |
| `packages/kilo-telemetry/` | Kilo 包 | 可复用类型/工具；**不**把 PostHog 路径改成 P2 主路径 |

### 8.2 禁止与例外

**禁止**（除非书面例外并记录于 PR）：

- 为 P2 修改 `packages/opencode/src/` 下 **非 `kilocode`** 路径的 session、tool、provider 等核心逻辑
- 在共享文件中内联大段企业统计、聚合或 Platform HTTP 客户端代码
- 为统计复制 upstream 算法到 Kilo 目录（制造语义分叉）

**例外**（须最小 diff + `kilocode_change` 标记）：

- 共享文件 **仅** 增加一行 import、注册或 `if (enterprise)` 调用 Kilo 辅助函数
- 合并后须通过：`bun run script/check-opencode-annotations.ts`

### 8.3 推荐挂钩方式

```
插件埋点（kilo-vscode）
    → TelemetryProxy.capture()
        → 若 enterprise 开启：POST Platform /api/v1/usage/...
        → 原有 CLI /telemetry/capture 不变

CLI 独有事件（Agent 运行中 LLM、Tool）
    → packages/opencode/src/kilocode/ 内 usage 模块转发 Platform
    → 不修改共享 session/processor 主体
```

| 数据来源 | 实现位置 |
|---|---|
| 补全、inline、插件侧 Agent 触发 | `packages/kilo-vscode/src/enterprise/`（新建 `usage.ts` 等） |
| 在 `TelemetryProxy.capture` 一处集中转发 | `packages/kilo-vscode/src/services/telemetry/` |
| LLM Token、Tool 写盘等仅 Engine 可见 | `packages/opencode/src/kilocode/` |
| 入库、日聚合、四 sheet、xlsx | `deploy/enterprise/platform/` |

### 8.4 多客户端演进

- JetBrains / Android 将来 **独立客户端** 按 §2 契约上报；**不**为兼容而在 opencode 共享层加 IDE 分支
- 新客户端只增 `ide` 字段与上报实现，**不改** Platform schema 与 §4 列定义

### 8.5 实现自检（合并前）

| # | 检查项 |
|---|---|
| U1 | P2 相关 Go/TS 主要落在 `deploy/enterprise/`、`kilo-vscode/src/enterprise/`、`opencode/src/kilocode/` |
| U2 | `git diff packages/opencode/src/` 中非 `kilocode` 路径无 P2 专用逻辑 |
| U3 | 共享文件若有改动：单行或最小 block + `kilocode_change`，且 annotation checker 通过 |
| U4 | 企业开关关闭时，行为与公有云默认路径一致（无多余 Platform 请求） |

---

## 9. 实现变更记录（开发期）

P2 会跨 **Platform、admin-ui、kilo-vscode、opencode/kilocode** 多处改代码。除 Git 提交外，须维护 **单独变更台账**，便于后期按批次撤回、对比口径或回滚整功能切片。

### 9.1 台账文件

| 项 | 定稿 |
|---|---|
| 路径 | **`docs/enterprise/P2-USAGE-ANALYTICS-CHANGES.md`** |
| 创建时机 | 说「开始写代码」后、**第一次改 P2 相关代码前** 创建 |
| 更新时机 | 每完成一个可独立描述的逻辑批次（或一次有效编码会话）**追加一条**，勿事后补记 |
| 与 Git 关系 | **不替代** commit；台账面向「人读 + 按功能撤回」，Git 面向版本历史 |

### 9.2 每条记录须包含

| 字段 | 说明 |
|---|---|
| 批次 ID | 递增，如 `P2-001`、`P2-002` |
| 日期 | `YYYY-MM-DD` |
| 范围 | `platform` / `admin-ui` / `vscode` / `opencode-kilocode` / `docs`（可多选） |
| 摘要 | 一句话：做了什么、为何 |
| 文件清单 | 新增 / 修改 / 删除的 **仓库相对路径**（逐条列出） |
| 数据库 | 若有 migration：文件名、是否可逆、回滚 SQL 或说明 |
| 配置 / 环境变量 | 新增或变更的 env、VS Code 设置键、feature flag |
| 撤回步骤 | 如何撤销本批次（`git revert` 范围、需手动删的文件、需执行的 down migration 等） |
| 状态 | `进行中` \| `已完成` \| `已撤回` |

### 9.3 记录模板（复制到台账文件顶部）

```markdown
## P2-NNN — YYYY-MM-DD

- **范围**：
- **摘要**：
- **文件**
  - 新增：
  - 修改：
  - 删除：
- **数据库**：
- **配置**：
- **撤回**：
- **状态**：进行中
```

### 9.4 撤回用法

1. 在台账中筛选 `状态=已完成` 且与要撤能力相关的批次。  
2. **按批次 ID 倒序**执行各条「撤回步骤」（后写的先撤，避免残留依赖）。  
3. 将对应条目 `状态` 改为 `已撤回`，并可选追加 `P2-NNN-revert` 说明实际操作。  
4. 若整功能下线：从最新批次撤到 `P2-001`，并对照 §8.5 U1–U4 确认无残留。

### 9.5 开发自检

| # | 检查项 |
|---|---|
| C1 | 台账文件已创建且路径为 §9.1 |
| C2 | 每个已合并 / 已交付的 P2 批次在台账中有对应条目 |
| C3 | 触及 `packages/opencode/` 非 `kilocode` 的改动在台账中 **单独标明** 并附撤回步骤 |
| C4 | 含 DB migration 的批次写清 down / 回滚方式 |

---

## 10. 实现顺序（开发阶段）

1. 本文档定稿（v1）✓  
2. 创建并维护 **`P2-USAGE-ANALYTICS-CHANGES.md`**（§9）  
3. 遵守 §8 升级友好约束  
4. Platform：表结构、ingestion API、聚合、导出 xlsx  
5. VS Code：企业 usage 上报（映射 §5，§8.3）  
6. 管理后台：四 Tab + 导出  
7. 按 §7 验收；每步完成后更新台账批次状态 ✅（2026-07-09 云机 API + 管理后台 + VS Code 联调全通过）
8. JetBrains / Android 插件：仅增客户端，不改 schema  

---

## 11. 修订记录

| 版本 | 日期 | 说明 |
|---|---|---|
| v1 | 2026-07-05 | 初稿：口径定稿 + 验收表；时区 Asia/Shanghai |
| v1.1 | 2026-07-05 | 新增 §8 Fork 升级友好约束 |
| v1.2 | 2026-07-05 | 新增 §9 实现变更记录（`P2-USAGE-ANALYTICS-CHANGES.md`） |
| v1.3 | 2026-07-09 | §7 验收表全绿；云机 `43.143.227.210` + VSIX `yoyo-code-7.3.53-enterprise.2` 联调通过 |
