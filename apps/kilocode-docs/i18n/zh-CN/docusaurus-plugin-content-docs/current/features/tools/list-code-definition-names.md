# list_code_definition_names

`list_code_definition_names` 工具通过列出指定目录顶层源代码文件中的代码定义，为您的代码库提供结构化概览。它通过显示行号和定义片段，帮助 Kilo Code 理解代码架构。

## 参数

该工具接受以下参数：

- `path`（必填）：要列出顶层源代码定义的目录路径，相对于当前工作目录

## 功能

该工具扫描指定目录顶层的源代码文件，并提取类、函数和接口等代码定义。它显示每个定义的行号和实际代码，以便快速映射代码库的重要组件。

## 使用场景

- 当 Kilo Code 需要快速理解您的代码库架构时
- 当 Kilo Code 需要定位多个文件中的重要代码结构时
- 在计划重构或扩展现有代码时
- 在使用其他工具深入研究实现细节之前
- 在识别代码库不同部分之间的关系时

## 主要特性

- 从源代码文件中提取类、函数、方法、接口等定义
- 显示每个定义的行号和实际源代码
- 支持多种编程语言，包括 JavaScript、TypeScript、Python、Rust、Go、C++、C、C#、Ruby、Java、PHP、Swift 和 Kotlin
- 仅处理指定目录顶层的文件（不包括子目录）
- 为提升性能，最多处理 50 个文件
- 专注于顶层定义，避免过多细节
- 帮助识别项目中的代码组织模式
- 创建代码库架构的思维导图
- 与其他工具（如 `read_file`）结合使用，进行更深入的分析

## 限制

- 仅识别顶层定义，不包括嵌套定义
- 仅处理指定目录顶层的文件，不包括子目录
- 每次请求最多处理 50 个文件
- 依赖于语言特定的解析器，检测质量可能有所不同
- 对于语法复杂的语言，可能无法识别所有定义
- 不能替代阅读代码以了解实现细节
- 无法检测运行时模式或动态代码关系
- 不提供有关定义使用情况的信息
- 对于高度动态或元编程的代码，准确性可能降低
- 仅限于 Tree-sitter 解析器支持的语言

## 工作原理

当调用 `list_code_definitions_names` 工具时，它会遵循以下流程：

1. **参数验证**：验证必填的 `path` 参数
2. **路径解析**：将相对路径解析为绝对路径
3. **目录扫描**：仅扫描指定目录顶层的源代码文件（非递归）
4. **文件过滤**：最多处理 50 个文件
5. **语言检测**：根据文件扩展名识别文件类型（.js、.jsx、.ts、.tsx、.py、.rs、.go、.cpp、.hpp、.c、.h、.cs、.rb、.java、.php、.swift、.kt、.kts）
6. **代码解析**：使用 Tree-sitter 解析代码并通过以下步骤提取定义：
    - 将文件内容解析为抽象语法树 (AST)
    - 使用语言特定的查询字符串创建查询
    - 按文件中的位置对捕获进行排序
7. **结果格式化**：输出定义及其行号和实际源代码

## 输出格式

输出显示文件路径，后跟定义的行号和实际源代码。例如：

```
src/utils.js:
0--0 | export class HttpClient {
5--5 | formatDate() {
10--10 | function parseConfig(data) {

src/models/User.js:
0--0 | interface UserProfile {
10--10 | export class User {
20--20 | function createUser(data) {
```

每行显示：

- 定义的起始和结束行号
- 分隔符（|）
- 定义的实际源代码

这种输出格式帮助您快速查看定义在文件中的位置及其实现细节。

## 使用示例

- 当开始新任务时，Kilo Code 首先列出关键代码定义以了解项目的整体结构。
- 当计划重构工作时，Kilo Code 使用此工具识别可能受影响的类和函数。
- 在探索不熟悉的代码库时，Kilo Code 在深入研究实现细节之前映射重要代码结构。
- 当添加新功能时，Kilo Code 识别现有模式和相关的代码定义以保持一致性。
- 当排查错误时，Kilo Code 映射代码库结构以定位问题的潜在来源。
- 当计划架构更改时，Kilo Code 识别所有受影响的组件。

## 用法示例

列出当前目录中的代码定义：

```
<list_code_definition_names>
<path>.</path>
</list_code_definition_names>
```

检查特定模块的结构：

```
<list_code_definition_names>
<path>src/components</path>
</list_code_definition_names>
```

探索工具库：

```
<list_code_definition_names>
<path>lib/utils</path>
</list_code_definition_names>
```
