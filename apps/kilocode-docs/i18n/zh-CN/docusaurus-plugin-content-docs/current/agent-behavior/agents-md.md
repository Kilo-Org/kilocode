# AGENTS.md 文件

AGENTS.md 文件提供了一种标准化的方式来配置不同 AI 编码工具的 AI 代理行为。它允许你定义项目特定的指令、编码标准和指南,供 AI 代理在处理代码库时遵循。

## 什么是 AGENTS.md?

AGENTS.md 是一个用于配置软件项目中 AI 代理行为的开放标准。它是一个放置在项目根目录的简单 Markdown 文件,包含给 AI 编码助手的指令。该标准得到多个 AI 编码工具的支持,包括 Kilo Code、Cursor 和 Windsurf。

可以将 AGENTS.md 视为"AI 代理的 README"——它告诉 AI 如何处理你的特定项目、遵循什么约定以及尊重什么约束。

## 为什么使用 AGENTS.md?

- **可移植性**: 无需修改即可在多个 AI 编码工具中使用
- **版本控制**: 与代码一起存放在仓库中
- **团队一致性**: 确保所有团队成员的 AI 助手遵循相同的指南
- **项目特定**: 针对项目的独特需求和约定进行定制
- **简单格式**: 纯 Markdown——无需特殊语法或配置

## 文件位置和命名

### 项目级 AGENTS.md

将 AGENTS.md 文件放在**项目根目录**:

```
my-project/
├── AGENTS.md          # 主文件名(推荐)
├── src/
├── package.json
└── README.md
```

**支持的文件名**(按优先级顺序):

1. `AGENTS.md`(大写、复数——推荐)
2. `AGENT.md`(大写、单数——备用)

:::warning 大小写敏感
文件名必须是大写(`AGENTS.md`),而不是小写(`agents.md`)。这确保了在不同操作系统和工具之间的一致性。
:::

### 子目录 AGENTS.md 文件

你也可以在子目录中放置 AGENTS.md 文件以提供特定上下文的指令:

```
my-project/
├── AGENTS.md                    # 根级指令
├── src/
│   └── backend/
│       └── AGENTS.md            # 后端特定指令
└── docs/
    └── AGENTS.md                # 文档特定指令
```

在子目录中工作时,Kilo Code 将加载根目录的 AGENTS.md 和任何子目录的 AGENTS.md 文件,子目录文件对于冲突的指令具有优先权。

## 文件保护

`AGENTS.md` 和 `AGENT.md` 在 Kilo Code 中都是**写保护文件**。这意味着:

- AI 代理无法在没有明确用户批准的情况下修改这些文件
- 你将被提示确认对这些文件的任何更改
- 这可以防止意外修改项目的 AI 配置

## 基本语法和结构

AGENTS.md 文件使用标准 Markdown 语法。没有必需的结构,但使用标题和列表组织内容可以让 AI 模型更容易解析和理解。

### 推荐结构

```markdown
# 项目名称

项目及其目的的简要描述。

## 代码风格

- 所有新文件使用 TypeScript
- 遵循 ESLint 配置
- 使用 2 个空格缩进

## 架构

- 遵循 MVC 模式
- 组件保持在 200 行以下
- 使用依赖注入

## 测试

- 为所有业务逻辑编写单元测试
- 保持 >80% 代码覆盖率
- 使用 Jest 进行测试

## 安全

- 永远不要提交 API 密钥或机密
- 验证所有用户输入
- 对数据库访问使用参数化查询
```

## 最佳实践

- **具体明确**——使用具体规则,如"将圈复杂度限制在 < 10",而不是模糊的指导,如"编写好代码"
- **包含代码示例**——展示错误处理、命名约定或架构决策的模式
- **按类别组织**——在清晰的标题下对相关指南进行分组(代码风格、架构、测试、安全)
- **保持简洁**——使用要点和直接语言;避免长段落
- **定期更新**——随着项目约定的演变进行审查和修订

## AGENTS.md 在 Kilo Code 中的工作原理

### 加载行为

当你在 Kilo Code 中开始任务时:

1. Kilo Code 检查项目根目录的 `AGENTS.md` 或 `AGENT.md`
2. 如果找到,内容将被加载并包含在 AI 的上下文中
3. AI 在整个对话过程中遵循这些指令
4. 对 AGENTS.md 的更改在新任务中生效(可能需要重新加载)

### 与其他规则的交互

AGENTS.md 与 Kilo Code 的其他配置系统协同工作:

| 功能                                                           | 范围 | 位置                      | 目的                       | 优先级      |
| -------------------------------------------------------------- | ---- | ------------------------- | -------------------------- | ----------- |
| **[模式特定自定义规则](/agent-behavior/custom-rules)**        | 项目 | `.kilocode/rules-{mode}/` | 模式特定规则和约束         | 1(最高)     |
| **[自定义规则](/agent-behavior/custom-rules)**                | 项目 | `.kilocode/rules/`        | Kilo Code 特定规则和约束   | 2           |
| **AGENTS.md**                                                  | 项目 | 项目根目录或子文件夹      | 项目指南的跨工具标准       | 3           |
| **[全局自定义规则](/agent-behavior/custom-rules)**            | 全局 | `~/.kilocode/rules/`      | 全局 Kilo Code 规则        | 4           |
| **[自定义指令](/agent-behavior/custom-instructions)**         | 全局 | IDE 设置                  | 所有项目的个人偏好         | 5(最低)     |

### 启用/禁用 AGENTS.md

AGENTS.md 支持在 Kilo Code 中**默认启用**。要禁用它,编辑 `settings.json`:

```json
{
	"kilocode.useAgentRules": false
}
```

## 相关功能

- **[自定义规则](/agent-behavior/custom-rules)** - 具有更多控制的 Kilo Code 特定规则
- **[自定义模式](/agent-behavior/custom-modes)** - 具有特定权限的专门工作流
- **[自定义指令](/agent-behavior/custom-instructions)** - 所有项目的个人偏好
- **[从 Cursor 或 Windsurf 迁移](/advanced-usage/migrating-from-cursor-windsurf)** - 其他工具的迁移指南

## 外部资源

- [AGENTS.md 规范](https://agents.md) - 官方标准文档
- [dotagent](https://github.com/johnlindquist/dotagent) - 代理配置文件的通用转换工具
- [awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) - 700+ 个可以改编的示例规则
