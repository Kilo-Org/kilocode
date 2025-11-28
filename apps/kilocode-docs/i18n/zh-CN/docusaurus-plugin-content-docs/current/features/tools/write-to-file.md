# write_to_file

`write_to_file` 工具用于创建新文件或完全替换现有文件内容，并通过交互式审批流程提供变更的差异视图。

## 参数

该工具接受以下参数：

- `path`（必填）：要写入的文件路径，相对于当前工作目录
- `content`（必填）：要写入文件的完整内容
- `line_count`（必填）：文件中的行数，包括空行

## 功能

该工具将内容写入指定文件，如果文件不存在则创建新文件，如果文件存在则完全覆盖现有内容。所有变更都需要通过差异视图界面进行显式用户审批，用户可以在应用变更之前查看甚至编辑建议的内容。

## 使用场景

- 当 Kilo Code 需要从头创建新文件时
- 当 Kilo Code 需要完全重写现有文件时
- 当为新项目创建多个文件时
- 当生成配置文件、文档或源代码时
- 当需要在应用变更之前查看变更时

## 关键特性

- 交互式审批：在差异视图中显示变更，需要显式批准才能应用
- 用户编辑支持：允许在最终批准之前编辑建议的内容
- 安全措施：检测代码遗漏、验证路径并防止内容截断
- 编辑器集成：打开差异视图并自动滚动到第一个差异
- 内容预处理：处理不同 AI 模型的输出，确保内容干净
- 访问控制：在更改之前验证 `.kilocodeignore` 限制
- 父目录：可能通过系统依赖处理目录创建
- 完全替换：在单个操作中提供完全转换的文件

## 限制

- 不适用于现有文件：对于修改现有文件，比 `apply_diff` 效率低得多
- 大文件性能：文件较大时操作速度显著变慢
- 完全覆盖：替换整个文件内容，无法保留原始内容
- 需要行数：需要准确的行数以检测潜在的内容截断
- 审批开销：审批流程比直接编辑增加了额外步骤
- 仅限交互式：无法在需要非交互式执行的自动化工作流中使用

## 工作原理

当调用 `write_to_file` 工具时，它会遵循以下过程：

1. **参数验证**：验证必需的参数和权限

    - 检查是否提供了 `path`、`content` 和 `line_count`
    - 验证文件是否允许（不受 `.kilocodeignore` 限制）
    - 确保路径在工作区范围内
    - 跟踪缺失参数的连续错误计数
    - 为每个验证失败显示具体的错误消息

2. **内容预处理**：

    - 删除可能由 AI 模型添加的代码块标记
    - 处理转义的 HTML 实体（特别是非 Claude 模型）
    - 如果内容中意外包含行号，则去除行号
    - 针对不同的 AI 提供者执行模型特定的处理

3. **差异视图生成**：

    - 在编辑器中打开差异视图，显示建议的变更
    - 添加 300 毫秒的延迟以确保 UI 响应能力
    - 自动滚动到第一个差异
    - 高亮显示变更以便于查看

4. **用户审批流程**：

    - 等待用户显式批准以继续
    - 允许用户在差异视图中编辑内容
    - 捕获用户的任何编辑以用于最终内容
    - 提供完全拒绝变更的选项
    - 检测并合并用户修改到最终结果中

5. **安全验证**：

    - 通过与提供的行数比较，检测潜在的内容截断
    - 如果内容看起来不完整，则显示警告
    - 验证文件路径和访问权限
    - 特别检查文件是否在工作区外，使用 `isOutsideWorkspace` 标志

6. **文件写入**：
    - 将批准的内容（包括用户的任何编辑）写入文件
    - 提供成功写入的确认
    - 成功时重置连续错误计数器

## 使用时的示例

- 创建新项目时，Kilo Code 会生成多个文件，但会让您在提交更改前查看每个文件。
- 设置配置文件时，Kilo Code 会在差异视图中显示建议的配置以供批准。
- 生成文档时，Kilo Code 会创建 Markdown 文件，但允许您在差异视图中进行最终调整。
- 开发原型时，Kilo Code 会在差异视图中显示完整的源文件，您可以在保存前进行微调。

## 使用示例

创建新的 JSON 配置文件：

```
<write_to_file>
<path>config/settings.json</path>
<content>
{
  "apiEndpoint": "https://api.example.com",
  "theme": {
    "primaryColor": "#007bff",
    "secondaryColor": "#6c757d",
    "fontFamily": "Arial, sans-serif"
  },
  "features": {
    "darkMode": true,
    "notifications": true,
    "analytics": false
  },
  "version": "1.0.0"
}
</content>
<line_count>14</line_count>
</write_to_file>
```

创建简单的 HTML 文件：

```
<write_to_file>
<path>src/index.html</path>
<content>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Application</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app"></div>
  <script src="app.js"></script>
</body>
</html>
</content>
<line_count>13</line_count>
</write_to_file>
```

创建 JavaScript 模块：

```
<write_to_file>
<path>src/utils/helpers.js</path>
<content>
/**
 * 应用程序的实用工具函数
 */

export function formatDate(date) {
  return new Date(date).toLocaleDateString();
}

export function calculateTotal(items) {
  return items.reduce((sum, item) => sum + item.price, 0);
}

export function debounce(func, delay) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), delay);
  };
}
</content>
<line_count>18</line_count>
</write_to_file>
```
