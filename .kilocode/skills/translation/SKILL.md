---
name: translation
description: Guidelines for translating and localizing the Kilo Code extension, including language-specific rules for German, Simplified Chinese, and Traditional Chinese.
---

# Translation Guidelines

This file provides guidance to agents when working with translations in this repository.

For the translation workflow, use the `/add-missing-translations` command or see `.kilocode/workflows/add-missing-translations.md`.

---

# 1. SUPPORTED LANGUAGES AND LOCATION

- Localize all strings into the following locale files: ar, ca, cs, de, en, es, fr, hi, id, it, ja, ko, nl, pl, pt-BR, ru, th, tr, uk, vi, zh-CN, zh-TW
- The VSCode extension has two main areas that require localization:
    - Core Extension: src/i18n/locales/, src/package.nls.json, src/package.nls.<locale>.json (extension backend)
    - WebView UI: webview-ui/src/i18n/locales/ (user interface)

# 2. VOICE, STYLE AND TONE

- Always use informal speech (e.g., "du" instead of "Sie" in German) for all translations
- Maintain a direct and concise style that mirrors the tone of the original text
- Carefully account for colloquialisms and idiomatic expressions in both source and target languages
- Aim for culturally relevant and meaningful translations rather than literal translations
- Preserve the personality and voice of the original content
- Use natural-sounding language that feels native to speakers of the target language
- Don't translate the word "token" as it means something specific in English that all languages will understand
- Don't translate domain-specific words (especially technical terms like "Prompt") that are commonly used in English in the target language

# 3. CORE EXTENSION LOCALIZATION (src/)

- Located in src/i18n/locales/
- NOT ALL strings in core source need internationalization - only user-facing messages
- Internal error messages, debugging logs, and developer-facing messages should remain in English
- The t() function is used with namespaces like 'core:errors.missingToolParameter'
- Be careful when modifying interpolation variables; they must remain consistent across all translations
- Some strings in formatResponse.ts are intentionally not internationalized since they're internal
- When updating strings in core.json, maintain all existing interpolation variables
- Check string usages in the codebase before making changes to ensure you're not breaking functionality

# 4. WEBVIEW UI LOCALIZATION (webview-ui/src/)

- Located in webview-ui/src/i18n/locales/
- Uses standard React i18next patterns with the useTranslation hook
- All user interface strings should be internationalized
- Always use the Trans component with named components for text with embedded components

<Trans> example:

`"changeSettings": "You can always change this at the bottom of the <settingsLink>settings</settingsLink>",`

```
  <Trans
    i18nKey="welcome:telemetry.changeSettings"
    components={{
      settingsLink: <VSCodeLink href="#" onClick={handleOpenSettings} />
    }}
  />
```

# 5. TECHNICAL IMPLEMENTATION

- Use namespaces to organize translations logically
- Handle pluralization using i18next's built-in capabilities
- Implement proper interpolation for variables using {{variable}} syntax
- Don't include defaultValue. The `en` translations are the fallback
- Always use apply_diff instead of write_to_file when editing existing translation files (much faster and more reliable)
- When using apply_diff, carefully identify the exact JSON structure to edit to avoid syntax errors
- Placeholders (like {{variable}}) must remain exactly identical to the English source to maintain code integration and prevent syntax errors

# 6. WORKFLOW AND APPROACH

- First add or modify English strings, then ask for confirmation before translating to all other languages
- Use this process for each localization task:
    1. Identify where the string appears in the UI/codebase
    2. Understand the context and purpose of the string
    3. Update English translation first
    4. Use the `<search_files>` tool to find JSON keys that are near new keys in English translations but do not yet exist in the other language files for `<apply_diff>` SEARCH context
    5. Create appropriate translations for all other supported languages utilizing the `search_files` result using `<apply_diff>` without reading every file.
    6. Do not output the translated text into the chat, just modify the files.
    7. Validate your changes with the missing translations script
- Flag or comment if an English source string is incomplete ("please see this...") to avoid truncated or unclear translations
- For UI elements, distinguish between:
    - Button labels: Use short imperative commands ("Save", "Cancel")
    - Tooltip text: Can be slightly more descriptive
- Preserve the original perspective: If text is a user command directed at the software, ensure the translation maintains this direction, avoiding language that makes it sound like an instruction from the system to the user

# 7. COMMON PITFALLS TO AVOID

- Switching between formal and informal addressing styles - always stay informal ("du" not "Sie")
- Translating or altering technical terms and brand names that should remain in English
- Modifying or removing placeholders like {{variable}} - these must remain identical
- Translating domain-specific terms that are commonly used in English in the target language
- Changing the meaning or nuance of instructions or error messages
- Forgetting to maintain consistent terminology throughout the translation

# 8. QUALITY ASSURANCE

- Maintain consistent terminology across all translations
- Respect the JSON structure of translation files
- Watch for placeholders and preserve them in translations
- Be mindful of text length in UI elements when translating to languages that might require more characters
- Use context-aware translations when the same string has different meanings
- Always validate your translation work by running the missing translations script:
    ```
    node scripts/find-missing-translations.js
    ```
- Address any missing translations identified by the script to ensure complete coverage across all locales

# 9. TRANSLATOR'S CHECKLIST

- ✓ Used informal tone consistently ("du" not "Sie")
- ✓ Preserved all placeholders exactly as in the English source
- ✓ Maintained consistent terminology with existing translations
- ✓ Kept technical terms and brand names unchanged where appropriate
- ✓ Preserved the original perspective (user→system vs system→user)
- ✓ Adapted the text appropriately for UI context (buttons vs tooltips)

---

# Language-Specific Guidelines

## German (de) Translation Guidelines

**Key Rule:** Always use informal speech ("du" form) in all German translations without exception.

### Quick Reference

| Category    | Formal (Avoid)            | Informal (Use)      | Example           |
| ----------- | ------------------------- | ------------------- | ----------------- |
| Pronouns    | Sie                       | du                  | you               |
| Possessives | Ihr/Ihre/Ihrem            | dein/deine/deinem   | your              |
| Verbs       | können Sie, müssen Sie    | kannst du, musst du | you can, you must |
| Imperatives | Geben Sie ein, Wählen Sie | Gib ein, Wähle      | Enter, Choose     |

**Technical terms** like "API", "token", "prompt" should not be translated.

---

## Simplified Chinese (zh-CN) Translation Guidelines

### Key Terminology

| English Term          | Preferred (zh-CN) | Avoid        | Context/Notes |
| --------------------- | ----------------- | ------------ | ------------- |
| API Cost              | API 费用          | API 成本     | 财务相关术语  |
| Tokens                | Token             | Tokens/令牌  | 保留抽象术语  |
| Token Usage           | Token 使用量      | Token 用量   | 技术计量单位  |
| Cache                 | 缓存              | 高速缓存     | 简洁优先      |
| Context               | 上下文            |              | 保留抽象术语  |
| Context Menu          | 右键菜单          | 上下文菜单   | 技术术语准确  |
| Context Window        | 上下文窗口        |              | 技术术语准确  |
| Proceed While Running | 强制继续          | 运行时继续   | 操作命令      |
| Enhance Prompt        | 增强提示词        | 优化提示     | AI相关功能    |
| Auto-approve          | 自动批准          | 始终批准     | 权限相关术语  |
| Checkpoint            | 存档点            | 检查点/快照  | 技术概念统一  |
| MCP Server            | MCP 服务          | MCP 服务器   | 技术组件      |
| Human Relay           | 人工辅助模式      | 人工中继     | 功能描述清晰  |
| Network Timeout       | 请求超时          | 网络超时     | 更准确描述    |
| Terminal              | 终端              | 命令行       | 技术术语统一  |
| diff                  | 差异更新          | 差分/补丁    | 代码变更      |
| prompt caching        | 提示词缓存        | 提示缓存     | AI功能        |
| computer use          | 计算机交互        | 计算机使用   | 技术能力      |
| rate limit            | API 请求频率限制  | 速率限制     | API控制       |
| Browser Session       | 浏览器会话        | 浏览器进程   | 技术概念      |
| Run Command           | 运行命令          | 执行命令     | 操作动词      |
| power steering mode   | 增强导向模式      | 动力转向模式 | 避免直译      |
| Boomerang Tasks       | 任务拆分          | 回旋镖任务   | 避免直译      |

### Formatting Rules

1. **中英文混排**

    - 添加空格：在中文和英文/数字之间添加空格，如"API 费用"（不是"API费用"）
    - 单位格式：时间单位统一为"15秒"、"1分钟"（不是"15 seconds"、"1 minute"）
    - 数字范围："已使用: {{used}} / {{total}}"
    - 技术符号保留原样："{{amount}} tokens"→"{{amount}}"

2. **标点符号**

    - 使用中文全角标点
    - 列表项使用中文顿号："创建、编辑文件"

3. **UI文本优化**

    - 按钮文本：使用简洁动词，如"展开"优于"查看更多"
    - 操作说明：使用步骤式说明（1. 2. 3.）替代长段落
    - 错误提示：使用"确认删除？此操作不可逆"替代"Are you sure...?"
    - 操作说明要简洁："Shift+拖拽文件"优于长描述
    - 按钮文本控制在2-4个汉字："展开"优于"查看更多"

4. **技术描述**

    - 保留英文缩写：如"MCP"不翻译
    - 统一术语：整个系统中相同概念使用相同译法
    - 长句拆分为短句
    - 被动语态转为主动语态
    - 功能名称统一："计算机交互"优于"计算机使用"
    - 参数说明："差异更新"优于"差分/补丁"

5. **变量占位符**
    - 保持原格式：`{{variable}}`
    - 中文说明放在变量外："Token 使用量: {{used}}"

### UI Element Translation Standards

1. **按钮(Buttons)**

    - 确认类：确定/取消/应用/保存
    - 操作类：添加/删除/编辑/导出
    - 状态类：启用/禁用/展开/收起
    - 长度限制：2-4个汉字

2. **菜单(Menus)**

    - 主菜单：文件/编辑/视图/帮助
    - 子菜单：使用">"连接，如"文件>打开"
    - 快捷键：保留英文，如"Ctrl+S"

3. **标签(Labels)**

    - 设置项：描述功能，如"自动保存间隔"
    - 状态提示：简洁明确，如"正在处理..."
    - 单位说明：放在括号内，如"超时时间(秒)"

4. **工具提示(Tooltips)**

    - 功能说明：简洁描述，如"复制选中内容"
    - 操作指引：步骤明确，如"双击编辑单元格"
    - 长度限制：不超过50个汉字

5. **对话框(Dialogs)**
    - 标题：说明对话框用途
    - 正文：分段落说明
    - 按钮：使用动词，如"确认删除"

### Contextual Translation Principles

1. **根据UI位置调整**

    - 按钮文本：简洁动词 (如"展开", "收起")
    - 设置项：描述性 (如"自动批准写入操作")
    - 帮助文本：完整说明 (如"开启后自动创建任务存档点，方便回溯修改")

2. **技术文档风格**

    - 使用主动语态：如"自动创建和编辑文件"
    - 避免口语化表达
    - 复杂功能使用分点说明
    - 说明操作结果：如"无需二次确认"
    - 参数说明清晰：如"延迟一段时间再自动批准写入"

3. **品牌/产品名称**

    - 保留英文品牌名
    - 技术术语保持一致性
    - 保留英文专有名词：如"Amazon Bedrock ARN"

4. **用户操作**
    - 操作动词统一：
        - "Click"→"点击"
        - "Type"→"输入"
        - "Scroll"→"滚动"
    - 按钮状态：
        - "Enabled"→"已启用"
        - "Disabled"→"已禁用"

### Technical Documentation Guidelines

1. **技术术语**

    - 统一使用"Token"而非"令牌"
    - 保留英文专有名词：如"Model Context Protocol"
    - 功能名称统一：如"计算机功能调用"优于"计算机使用"

2. **API文档**

    - 端点(Endpoint)：保留原始路径
    - 参数说明：表格形式展示
    - 示例：保留代码格式
    - 参数标签：
        - 单位明确：如"最大输出 Token 数"
        - 范围说明完整：如"模型可以处理的总 Token 数"

3. **代码相关翻译**

    - 代码注释：
        - 保留技术术语：如"// Initialize MCP client"
        - 简短说明：如"检查文件是否存在"
    - 错误信息：
        - 包含错误代码：如"Error 404: 文件未找到"
        - 提供解决方案：如"请检查文件权限"
    - 命令行：
        - 保留原生命令：如"git commit -m 'message'"
        - 参数说明：如"-v: 显示详细输出"

4. **配置指南**
    - 设置项命名：如"Enable prompt caching"→"启用提示词缓存"
    - 价格描述：
        - 单位统一：如"每百万 Token 的成本"
        - 说明影响：如"这会影响生成内容和补全的成本"
    - 操作说明：
        - 使用编号步骤：如"1. 注册Google Cloud账号"
        - 步骤动词一致：如"安装配置Google Cloud CLI工具"

### Common Patterns

| Original                        | Avoid                                                         | Preferred                                            |
| ------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| `"dragFiles"`                   | `"按住shift拖动文件"`                                         | `"Shift+拖拽文件"`                                   |
| `"description"`                 | `"启用后，Kilo Code 将能够与 MCP 服务器交互以获取高级功能。"` | `"启用后 Kilo Code 可与 MCP 服务交互获取高级功能。"` |
| `"cannotUndo"`                  | `"此操作无法撤消。"`                                          | `"此操作不可逆。"`                                   |
| `"hold shift to drag in files"` | `"按住shift拖动文件"`                                         | `"Shift+拖拽文件"`                                   |
| `"Double click to edit"`        | `"双击进行编辑"`                                              | `"双击编辑"`                                         |

### Common Pitfalls

1. 避免过度直译导致生硬

    - ✗ "Do more with Boomerang Tasks" → "使用回旋镖任务完成更多工作"
    - ✓ "Do more with Boomerang Tasks" → "允许任务拆分"

2. 保持功能描述准确

    - ✗ "Enhance prompt with additional context" → "使用附加上下文增强提示"
    - ✓ "Enhance prompt with additional context" → "增强提示词"

3. 操作指引清晰

    - ✗ "hold shift to drag in files" → "按住shift拖动文件"
    - ✓ "hold shift to drag in files" → "Shift+拖拽文件"

4. 确保术语一致性

    - ✗ 同一文档中混用"Token"/"令牌"/"代币"
    - ✓ 统一使用"Token"作为技术术语

5. 注意文化适应性

    - ✗ "Kill the process" → "杀死进程"(过于暴力)
    - ✓ "Kill the process" → "终止进程"

6. 技术文档特殊处理
    - 代码示例中的注释：
      ✗ 翻译后破坏代码结构
      ✓ 保持代码注释原样或仅翻译说明部分
    - 命令行参数：
      ✗ 翻译参数名称导致无法使用
      ✓ 保持参数名称英文，仅翻译说明

### Best Practices

1. **翻译工作流程**

    - 通读全文理解上下文
    - 标记并统一技术术语
    - 分段翻译并检查一致性
    - 最终整体审校

2. **质量检查要点**

    - 术语一致性
    - 功能描述准确性
    - UI元素长度适配性
    - 文化适应性

3. **工具使用建议**

    - 建立项目术语库
    - 使用翻译记忆工具
    - 维护风格指南
    - 定期更新翻译资源

4. **审校流程**
    - 初翻 → 技术审校 → 语言润色 → 最终确认
    - 重点关注技术准确性、语言流畅度和UI显示效果

### Quality Checklist

1. 术语是否全文一致？
2. 是否符合中文技术文档习惯？
3. UI控件文本是否简洁明确？
4. 长句是否已合理拆分？
5. 变量占位符是否保留原格式？
6. 技术描述是否准确无误？
7. 文化表达是否恰当？
8. 是否保持了原文的精确含义？
9. 特殊格式(如变量、代码)是否正确保留？

---

## Traditional Chinese (zh-TW) Translation Guidelines

### Key Terminology

| English Term  | Use (zh-TW) | Avoid (Mainland) |
| ------------- | ----------- | ---------------- |
| file          | 檔案        | 文件             |
| task          | 工作        | 任務             |
| project       | 專案        | 項目             |
| configuration | 設定        | 配置             |
| server        | 伺服器      | 服務器           |
| import/export | 匯入/匯出   | 導入/導出        |

### Formatting Rules

- Add spaces between Chinese and English/numbers: "AI 驅動" (not "AI驅動")
- Use Traditional Chinese quotation marks: 「範例文字」(not "範例文字")
- Use Taiwanese computing conventions rather than mainland terminology
