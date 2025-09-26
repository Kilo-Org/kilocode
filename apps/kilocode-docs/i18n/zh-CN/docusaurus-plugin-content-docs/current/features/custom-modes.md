# 自定义模式

Kilo Code 允许您创建**自定义模式**，以根据特定任务或工作流调整 Kilo 的行为。自定义模式可以是**全局**（适用于所有项目）或**项目特定**（在单个项目中定义）。

## 粘性模型以提高工作效率

每种模式（包括自定义模式）都有**粘性模型**功能。这意味着 Kilo Code 会自动记住并选择您上次在特定模式下使用的模型。这让您能够为不同任务分配不同的首选模型，而无需不断重新配置，因为 Kilo 会在您切换模式时自动切换模型。

## 为什么使用自定义模式？

- **专业化**：创建针对特定任务优化的模式，如"文档编写者"、"测试工程师"或"重构专家"
- **安全性**：限制模式对敏感文件或命令的访问。例如，"审查模式"可以限制为只读操作
- **实验性**：安全地尝试不同的提示和配置，而不会影响其他模式
- **团队协作**：与团队共享自定义模式以标准化工作流程

<img src="/img/custom-modes/custom-modes.png" alt="自定义模式界面概览" width="600" />

_Kilo Code 创建和管理自定义模式的界面。_

## 自定义模式包含哪些内容？

自定义模式由几个关键属性定义。理解这些概念将帮助您有效地调整 Kilo 的行为。

| UI 字段 / YAML 属性                   | 概念描述                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Slug** (`slug`)                     | 模式的唯一内部标识符。Kilo Code 使用它来引用模式，特别是用于关联特定于模式的指令文件。             |
| **名称** (`name`)                     | 在 Kilo Code 用户界面中显示的模式名称。应该是人类可读且具有描述性的。                              |
| **描述** (`description`)              | 在模式选择器 UI 中显示的模式目的的简短、用户友好的摘要。保持简洁，并专注于该模式对用户的作用。     |
| **角色定义** (`roleDefinition`)       | 定义模式的核心身份和专业领域。此文本放置在系统提示的开头，并定义 Kilo 在此模式激活时的个性和行为。 |
| **可用工具** (`groups`)               | 定义模式允许的工具集和文件访问权限。对应于选择模式可以使用的工具的一般类别。                       |
| **使用时机** (`whenToUse`)            | _(可选)_ 为 Kilo 的自动化决策提供指导，特别是模式选择和任务编排。由协调器模式用于任务协调。        |
| **自定义指令** (`customInstructions`) | _(可选)_ 模式的特定行为准则或规则。添加在系统提示的末尾附近，以进一步细化 Kilo 的行为。            |

## 导入/导出模式

轻松共享、备份和模板化您的自定义模式。此功能允许您将任何模式及其关联规则导出到单个便携式 YAML 文件中，您可以将其导入到任何项目中。

### 主要功能

- **可共享设置**：将模式及其规则打包到一个文件中，轻松与团队共享
- **轻松备份**：保存您的自定义模式配置，这样您就不会丢失它们
- **项目模板**：为不同类型的项目创建标准化模式模板
- **简单迁移**：在全局设置和特定项目之间轻松移动模式
- **灵活的 Slug 更改**：在导出的文件中更改模式 slug，无需手动路径编辑

### 工作原理

**导出模式：**

1. 导航到模式视图
2. 选择您希望导出的模式
3. 点击导出模式按钮（下载图标）
4. 选择保存 `.yaml` 文件的位置
5. Kilo 将模式的配置和任何规则打包到 YAML 文件中

**导入模式：**

1. 在模式视图中点击导入模式按钮（上传图标）
2. 选择模式的 YAML 文件
3. 选择导入级别：
    - **项目**：仅在当前工作区中可用（保存到 `.kilocodemodes` 文件）
    - **全局**：在所有项目中可用（保存到全局设置）

### 导入时更改 Slug

导入模式时，您可以在导入之前更改导出的 YAML 文件中的 slug：

1. 导出一个 slug 为 `original-mode` 的模式
2. 编辑 YAML 文件并将 slug 更改为 `new-mode`
3. 导入文件 - 导入过程将自动更新规则文件路径以匹配新的 slug

## 创建和配置自定义模式的方法

您可以通过几种方式创建和配置自定义模式：

### 1. 询问 Kilo！（推荐）

您可以通过要求 Kilo Code 为您创建基本的自定义模式来快速创建。例如：

```
创建一个名为"文档编写者"的新模式。它应该只能读取文件和编写 Markdown 文件。
```

Kilo Code 将引导您完成此过程，提示必要的信息并使用首选的 YAML 格式创建模式。

### 2. 使用提示标签页

1. **打开提示标签页**：点击 Kilo Code 顶部菜单栏中的 <Codicon name="notebook" /> 图标
2. **创建新模式**：点击模式标题右侧的 <Codicon name="add" /> 按钮
3. **填写字段**：

<img src="/img/custom-modes/custom-modes-2.png" alt="提示标签页中的自定义模式创建界面" width="600" />

_自定义模式创建界面，显示名称、slug、描述、保存位置、角色定义、可用工具、自定义指令的字段。_

界面提供名称、Slug、描述、保存位置、角色定义、使用时机（可选）、可用工具和自定义指令的字段。填写这些字段后，点击"创建模式"按钮。Kilo Code 将以 YAML 格式保存新模式。

### 3. 手动配置（YAML 和 JSON）

您可以直接编辑配置文件来创建或修改自定义模式。此方法为您提供对所有属性的最大控制。Kilo Code 现在支持 YAML（首选）和 JSON 格式。

- **全局模式**：编辑 `custom_modes.yaml`（首选）或 `custom_modes.json` 文件。通过提示标签页 > <Codicon name="gear" />（"全局提示"旁的设置菜单图标）> "编辑全局模式" 访问
- **项目模式**：编辑项目根目录中的 `.kilocodemodes` 文件（可以是 YAML 或 JSON）。通过提示标签页 > <Codicon name="gear" />（"项目提示"旁的设置菜单图标）> "编辑项目模式" 访问

这些文件定义自定义模式的数组/列表。

## YAML 配置格式（首选）

YAML 现在是定义自定义模式的首选格式，因为它具有更好的可读性、注释支持和更清晰的多行字符串。

### YAML 示例

```yaml
customModes:
    - slug: docs-writer
      name: 📝 文档编写者
      description: 专门用于编写和编辑技术文档的模式。
      roleDefinition: 您是一位专门编写清晰文档的技术作家。
      whenToUse: 使用此模式编写和编辑文档。
      customInstructions: 专注于文档的清晰性和完整性。
      groups:
          - read
          - - edit # 元组的第一个元素
            - fileRegex: \.(md|mdx)$ # 第二个元素是选项对象
              description: 仅限 Markdown 文件
          - browser
    - slug: another-mode
      name: 另一个模式
      # ... 其他属性
```

### JSON 替代方案

```json
{
	"customModes": [
		{
			"slug": "docs-writer",
			"name": "📝 文档编写者",
			"description": "专门用于编写和编辑技术文档的模式。",
			"roleDefinition": "您是一位专门编写清晰文档的技术作家。",
			"whenToUse": "使用此模式编写和编辑文档。",
			"customInstructions": "专注于文档的清晰性和完整性。",
			"groups": [
				"read",
				["edit", { "fileRegex": "\\.(md|mdx)$", "description": "仅限 Markdown 文件" }],
				"browser"
			]
		}
	]
}
```

## YAML/JSON 属性详情

### `slug`

- **用途**：模式的唯一标识符
- **格式**：必须匹配模式 `/^[a-zA-Z0-9-]+$/`（仅字母、数字和连字符）
- **用法**：在内部使用以及模式特定规则的文件/目录名中使用（例如，`.kilo/rules-{slug}/`）
- **建议**：保持简短且具有描述性

**YAML 示例**：`slug: docs-writer`
**JSON 示例**：`"slug": "docs-writer"`

### `name`

- **用途**：在 Kilo Code UI 中显示的名称
- **格式**：可以包含空格和适当的大小写

**YAML 示例**：`name: 📝 文档编写者`
**JSON 示例**：`"name": "文档编写者"`

### `description`

- **用途**：在模式选择器 UI 中显示在模式名称下方的简短、用户友好的摘要
- **格式**：保持简洁，并专注于该模式对用户的作用
- **UI 显示**：此文本出现在重新设计的模式选择器中

**YAML 示例**：`description: 专门用于编写和编辑技术文档的模式。`
**JSON 示例**：`"description": "专门用于编写和编辑技术文档的模式。"`

### `roleDefinition`

- **用途**：模式角色、专业领域和个性的详细描述
- **位置**：当模式激活时，此文本放置在系统提示的开头

**YAML 示例（多行）**：

```yaml
roleDefinition: >-
    您是一位测试工程师，具有以下专业知识：
     - 编写全面的测试套件
     - 测试驱动开发
```

**JSON 示例**：`"roleDefinition": "您是一位专门编写清晰文档的技术作家。"`

### `groups`

- **用途**：定义模式可以访问的工具组和任何文件限制的数组/列表
- **可用工具组**：`"read"`、`"edit"`、`"browser"`、`"command"`、`"mcp"`
- **结构**：
    - 无限制访问的简单字符串：`"edit"`
    - 受限访问的元组（双元素数组）：`["edit", { fileRegex: "pattern", description: "optional" }]`

**"edit" 组的文件限制**：

- `fileRegex`：用于控制模式可以编辑哪些文件的正则表达式字符串
- 在 YAML 中，通常对正则特殊字符使用单个反斜杠（例如，`\.md$`）
- 在 JSON 中，反斜杠必须双转义（例如，`\\.md$`）
- `description`：描述限制的可选字符串

**YAML 示例**：

```yaml
groups:
    - read
    - - edit # 元组的第一个元素
      - fileRegex: \.(js|ts)$ # 第二个元素是选项对象
        description: 仅限 JS/TS 文件
    - command
```

**JSON 示例**：

```json
"groups": [
  "read",
  ["edit", { "fileRegex": "\\.(js|ts)$", "description": "仅限 JS/TS 文件" }],
  "command"
]
```

### `whenToUse`（可选）

- **用途**：为 Kilo 的自动化决策提供指导，特别是模式选择和任务编排
- **格式**：描述此模式的理想场景或任务类型的字符串
- **用法**：由 Kilo 用于自动化决策，不在模式选择器 UI 中显示

**YAML 示例**：`whenToUse: 此模式最适合重构 Python 代码。`
**JSON 示例**：`"whenToUse": "此模式最适合重构 Python 代码。"`

### `customInstructions`（可选）

- **用途**：包含模式附加行为准则的字符串
- **位置**：此文本添加在系统提示的末尾附近

**YAML 示例（多行）**：

```yaml
customInstructions: |-
    编写测试时：
     - 使用 describe/it 块
     - 包含有意义的描述
```

**JSON 示例**：`"customInstructions": "专注于解释概念并提供示例。"`

## YAML 格式的优势

YAML 现在是定义自定义模式的首选格式，因为它具有以下优势：

- **可读性**：YAML 基于缩进的结构更容易被人阅读和理解
- **注释**：YAML 允许注释（以 `#` 开头的行），可以为您的模式定义添加注释
- **多行字符串**：YAML 提供更清晰的多行字符串语法，使用 `|`（文字块）或 `>`（折叠块）
- **更少标点符号**：与 JSON 相比，YAML 通常需要更少的标点符号，减少语法错误
- **编辑器支持**：大多数现代代码编辑器为 YAML 文件提供出色的语法高亮和验证

虽然 JSON 仍然完全支持，但通过 UI 或询问 Kilo 创建的新模式将默认为 YAML。

## 迁移到 YAML 格式

### 全局模式

当以下情况发生时，会自动从 `custom_modes.json` 迁移到 `custom_modes.yaml`：

- Kilo Code 启动时
- 存在 `custom_modes.json` 文件
- 尚不存在 `custom_modes.yaml` 文件

迁移过程会保留原始 JSON 文件以备回滚。

### 项目模式（`.kilocodemodes`）

- 项目特定文件不会在启动时自动迁移
- Kilo Code 可以读取 YAML 或 JSON 格式的 `.kilocodemodes` 文件
- 通过 UI 编辑时，JSON 文件将转换为 YAML 格式
- 对于手动转换，您可以要求 Kilo 帮助重新格式化配置

## 通过文件/目录提供特定于模式的指令

您可以使用工作区内的专用文件或目录为自定义模式提供指令，从而实现更好的组织和版本控制。

### 首选方法：目录（`.kilo/rules-{mode-slug}/`）

```
.
├── .kilo/
│   └── rules-docs-writer/  # 模式 slug "docs-writer" 的示例
│       ├── 01-style-guide.md
│       └── 02-formatting.txt
└── ... (其他项目文件)
```

### 备用方法：单个文件（`.kilorules-{mode-slug}`）

```
.
├── .kilorules-docs-writer  # 模式 slug "docs-writer" 的示例
└── ... (其他项目文件)
```

**规则目录范围**：

- **全局模式**：规则存储在 `~/.kilo/rules-{slug}/`
- **项目模式**：规则存储在 `{workspace}/.kilo/rules-{slug}/`

如果目录存在且包含文件，则目录方法优先。目录中的文件按字母顺序递归读取并追加。

## 配置优先级

模式配置按以下顺序应用：

1. **项目级模式配置**（来自 `.kilocodemodes` - YAML 或 JSON）
2. **全局模式配置**（来自 `custom_modes.yaml`，如果未找到 YAML 则来自 `custom_modes.json`）
3. **默认模式配置**

**重要**：当 `.kilocodemodes` 和全局设置中存在相同 slug 的模式时，`.kilocodemodes` 版本会完全覆盖全局版本的所有属性。

## 覆盖默认模式

您可以通过创建具有相同 slug 的自定义模式来覆盖 Kilo Code 的内置模式（如 💻 代码、🪲 调试、❓ 询问、🏗️ 架构师、🪃 协调器）。

### 全局覆盖示例

```yaml
customModes:
    - slug: code # 匹配默认的 'code' 模式 slug
      name: 💻 代码（全局覆盖）
      roleDefinition: 您是一位具有全局特定约束的软件工程师。
      whenToUse: 此全局覆盖的代码模式用于 JS/TS 任务。
      customInstructions: 专注于项目特定的 JS/TS 开发。
      groups:
          - read
          - - edit
            - fileRegex: \.(js|ts)$
              description: 仅限 JS/TS 文件
```

### 项目特定覆盖示例

```yaml
customModes:
    - slug: code # 匹配默认的 'code' 模式 slug
      name: 💻 代码（项目特定）
      roleDefinition: 您是一位具有此项目特定约束的软件工程师。
      whenToUse: 此项目特定代码模式用于此项目中的 Python 任务。
      customInstructions: 遵循 PEP8 并使用类型提示。
      groups:
          - read
          - - edit
            - fileRegex: \.py$
              description: 仅限 Python 文件
          - command
```

## 理解自定义模式中的正则表达式

正则表达式（`fileRegex`）提供对文件编辑权限的细粒度控制。

:::tip
**让 Kilo 构建您的正则表达式模式**

不要手动编写复杂的正则表达式，询问 Kilo：

```
创建一个匹配 JavaScript 文件但排除测试文件的正则表达式模式
```

Kilo 将生成模式。请记住根据 YAML（通常单个反斜杠）或 JSON（双反斜杠）进行调整。
:::

### `fileRegex` 的重要规则

- **JSON 中的转义**：在 JSON 字符串中，反斜杠（`\`）必须双转义（例如，`\\.md$`）
- **YAML 中的转义**：在未加引号或单引号的 YAML 字符串中，单个反斜杠通常足以用于正则特殊字符（例如，`\.md$`）
- **路径匹配**：模式与工作区根目录的完整相对文件路径匹配
- **大小写敏感性**：正则表达式模式默认区分大小写
- **验证**：无效的正则表达式模式会被拒绝，并显示"无效的正则表达式模式"错误消息

### 常见模式示例

| 模式（类似 YAML）                | JSON fileRegex 值                   | 匹配                                      | 不匹配                             |
| -------------------------------- | ----------------------------------- | ----------------------------------------- | ---------------------------------- |
| `\.md$`                          | `"\\.md$"`                          | `readme.md`, `docs/guide.md`              | `script.js`, `readme.md.bak`       |
| `^src/.*`                        | `"^src/.*"`                         | `src/app.js`, `src/components/button.tsx` | `lib/utils.js`, `test/src/mock.js` |
| `\.(css\|scss)$`                 | `"\\.(css\|scss)$"`                 | `styles.css`, `theme.scss`                | `styles.less`, `styles.css.map`    |
| `docs/.*\.md$`                   | `"docs/.*\\.md$"`                   | `docs/guide.md`, `docs/api/reference.md`  | `guide.md`, `src/docs/notes.md`    |
| `^(?!.*(test\|spec))\.(js\|ts)$` | `"^(?!.*(test\|spec))\\.(js\|ts)$"` | `app.js`, `utils.ts`                      | `app.test.js`, `utils.spec.js`     |

### 关键正则构建块

- `\.`：匹配文字点（YAML：`\.`，JSON：`\\.`）
- `$`：匹配字符串末尾
- `^`：匹配字符串开头
- `.*`：匹配任何字符（换行符除外）零次或多次
- `(a|b)`：匹配"a"或"b"
- `(?!...)`：负向先行断言

## 错误处理

当模式尝试编辑不匹配其 `fileRegex` 模式的文件时，您会看到包含以下内容的 `FileRestrictionError`：

- 模式名称
- 允许的文件模式
- 描述（如果提供）
- 尝试的文件路径
- 被阻止的工具

## 配置示例

### 基本文档编写者（YAML）

```yaml
customModes:
    - slug: docs-writer
      name: 📝 文档编写者
      description: 专门用于编写和编辑技术文档
      roleDefinition: 您是一位专门编写清晰文档的技术作家
      groups:
          - read
          - - edit
            - fileRegex: \.md$
              description: 仅限 Markdown 文件
      customInstructions: 专注于清晰的解释和示例
```

### 带文件限制的测试工程师（YAML）

```yaml
customModes:
    - slug: test-engineer
      name: 🧪 测试工程师
      description: 专注于编写和维护测试套件
      roleDefinition: 您是一位专注于代码质量的测试工程师
      whenToUse: 用于编写测试、调试测试失败和提高测试覆盖率
      groups:
          - read
          - - edit
            - fileRegex: \.(test|spec)\.(js|ts)$
              description: 仅限测试文件
          - command
```

### 安全审查模式（YAML）

```yaml
customModes:
    - slug: security-review
      name: 🔒 安全审查员
      description: 只读安全分析和漏洞评估
      roleDefinition: 您是一位审查代码漏洞的安全专家
      whenToUse: 用于安全审查和漏洞评估
      customInstructions: |-
          关注：
          - 输入验证问题
          - 身份验证和授权缺陷
          - 数据暴露风险
          - 注入漏洞
      groups:
          - read
          - browser
```

## 故障排除

### 常见问题

- **模式未出现**：创建或导入模式后，您可能需要重新加载 VS Code 窗口
- **无效的正则表达式模式**：在应用之前使用在线正则表达式测试器测试您的模式
- **优先级混淆**：请记住，项目模式会完全覆盖具有相同 slug 的全局模式
- **YAML 语法错误**：使用正确的缩进（空格，不是制表符）并验证您的 YAML

### 使用 YAML 的技巧

- **缩进是关键**：YAML 使用缩进（空格，不是制表符）来定义结构
- **冒号用于键值对**：键后面必须跟一个冒号和一个空格（例如，`slug: my-mode`）
- **连字符用于列表项**：列表项以连字符和一个空格开头（例如，`- read`）
- **验证您的 YAML**：使用在线 YAML 验证器或编辑器的内置验证

## 社区画廊

准备好探索更多了吗？查看 [Show and Tell](https://github.com/Kilo-Org/kilocode/discussions/categories/show-and-tell) 来发现和分享社区创建的自定义模式！
