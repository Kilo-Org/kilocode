# read_file

`read_file`工具用于读取项目中的文件内容。它允许 Kilo Code 理解代码、配置文件和文档，以提供更好的协助。

## 参数

该工具接受以下参数：

- `path`（必需）：要读取的文件路径（相对于当前工作目录）
- `start_line`（可选）：开始读取的行号（从1开始）
- `end_line`（可选）：结束读取的行号（从1开始，包含该行）
- `auto_truncate`（可选）：当未指定行范围时，是否自动截断大文件（true/false）

## 功能

该工具读取指定文件的内容并返回带行号的结果，便于参考。它可以读取整个文件或特定部分，甚至能从PDF和Word文档中提取文本。

## 使用场景

- 当 Kilo Code 需要理解现有代码结构时
- 当 Kilo Code 需要分析配置文件时
- 当 Kilo Code 需要从文本文件中提取信息时
- 当 Kilo Code 在建议更改前需要查看代码时
- 当需要在讨论中引用特定行号时

## 主要特性

- 显示带行号的文件内容，便于参考
- 通过指定行范围读取文件的特定部分
- 从PDF和DOCX文件中提取可读文本
- 智能截断大文件以聚焦最相关部分
- 为大型代码文件提供带行范围的方法摘要
- 高效流式传输请求的行范围以获得更好性能
- 便于通过行号讨论代码的特定部分

## 限制

- 如果不使用行范围参数，可能无法高效处理极大的文件
- 对于二进制文件（除PDF和DOCX外），可能返回非人类可读的内容

## 工作原理

当调用`read_file`工具时，它遵循以下流程：

1. **参数验证**：验证必需的`path`参数和可选参数
2. **路径解析**：将相对路径解析为绝对路径
3. **读取策略选择**：
    - 工具使用严格的优先级层次（下文详细说明）
    - 在范围读取、自动截断或完整文件读取之间选择
4. **内容处理**：
    - 为内容添加行号（例如"1 | const x = 13"）
    - 对于截断文件，添加截断通知和方法定义
    - 对于特殊格式（PDF、DOCX、IPYNB），提取可读文本

## 读取策略优先级

工具使用明确的决策层次来确定如何读取文件：

1. **第一优先级：显式行范围**

    - 如果提供了`start_line`或`end_line`，工具始终执行范围读取
    - 实现高效流式传输仅请求的行，适合处理大文件
    - 此选项优先于所有其他选项

2. **第二优先级：大文件自动截断**

    - 仅在满足以下所有条件时应用：
        - 未指定`start_line`或`end_line`
        - `auto_truncate`参数设为`true`
        - 文件不是二进制文件
        - 文件超过配置的行阈值（通常500-1000行）
    - 当自动截断激活时，工具：
        - 仅读取文件开头部分（由maxReadFileLine设置决定）
        - 添加截断通知显示已显示行数与总行数
        - 提供带行范围的方法定义摘要

3. **默认行为：读取整个文件**
    - 如果不符合上述条件，则读取整个文件内容
    - 对于PDF、DOCX和IPYNB等特殊格式，使用专用提取器

## 使用示例

- 当要求解释或改进代码时，Kilo Code 首先读取相关文件以理解当前实现
- 当排查配置问题时，Kilo Code 读取配置文件以识别潜在问题
- 当处理文档时，Kilo Code 读取现有文档以理解当前内容再建议改进

## 用法示例

以下是几个展示`read_file`工具如何使用及可能收到的典型输出场景。

### 读取整个文件

读取文件的完整内容：

**输入：**

```xml
<read_file>
<path>src/app.js</path>
</read_file>
```

**模拟输出（小文件如`example_small.txt`）：**

```
1 | This is the first line.
2 | This is the second line.
3 | This is the third line.
```

_(输出会根据实际文件内容而变化)_

### 读取特定行

仅读取特定行范围（例如46-68行）：

**输入：**

```xml
<read_file>
<path>src/app.js</path>
<start_line>46</start_line>
<end_line>68</end_line>
</read_file>
```

**模拟输出（`example_five_lines.txt`的2-3行）：**

```
2 | Content of line two.
3 | Content of line three.
```

_(输出仅显示请求的行及其原始行号)_

### 读取大文件（自动截断）

当读取大文件且未指定行范围，且`auto_truncate`启用时（或根据设置默认为true）：

**输入：**

```xml
<read_file>
<path>src/large-module.js</path>
<auto_truncate>true</auto_truncate> <!-- 如果默认true则可选 -->
</read_file>
```

**模拟输出（`large_file.log`有1500行，限制1000行）：**

```
1 | Log entry 1...
2 | Log entry 2...
...
1000 | Log entry 1000...
[... truncated 500 lines ...]
```

_(输出限制为配置的最大行数，并带有截断通知)_

### 尝试读取不存在的文件

如果指定文件不存在：

**输入：**

```xml
<read_file>
<path>non_existent_file.txt</path>
</read_file>
```

**模拟输出（错误）：**

```
Error: File not found at path 'non_existent_file.txt'.
```

### 尝试读取被阻止的文件

如果文件被`.kilocodeignore`规则排除：

**输入：**

```xml
<read_file>
<path>.env</path>
</read_file>
```

**模拟输出（错误）：**

```
Error: Access denied to file '.env' due to .kilocodeignore rules.
```
