# list_files

`list_files` 工具显示指定位置中的文件和目录。它帮助 Kilo Code 理解您的项目结构并有效地导航代码库。

## 参数

该工具接受以下参数：

- `path`（必填）：要列出内容的目录路径，相对于当前工作目录
- `recursive`（可选）：是否递归列出文件。使用 `true` 进行递归列出，`false` 或省略则仅列出顶层内容。

## 功能

该工具列出指定位置中的所有文件和目录，提供项目结构的清晰概览。它可以仅显示顶层内容，也可以递归探索子目录。

## 使用场景

- 当 Kilo Code 需要理解您的项目结构时
- 当 Kilo Code 在读取特定文件之前探索可用文件时
- 当 Kilo Code 映射代码库以更好地理解其组织方式时
- 在使用更针对性的工具（如 `read_file` 或 `search_files`）之前
- 当 Kilo Code 需要检查项目中特定类型的文件（如配置文件）时

## 主要特性

- 列出文件和目录，并明确标记目录
- 提供递归和非递归两种列出模式
- 在递归模式下，智能忽略常见的大型目录（如 `node_modules` 和 `.git`）
- 在递归模式下，遵循 `.gitignore` 规则
- 当启用 `showKiloCodeIgnoredFiles` 时，用锁符号（🔒）标记被 `.kilocodeignore` 忽略的文件
- 通过逐级目录遍历优化性能
- 排序结果，先显示目录及其内容，保持逻辑层次结构
- 以干净、有组织的方式呈现结果
- 自动创建项目结构的思维导图

## 限制

- 默认情况下，文件列出上限约为 200 个，以防止性能问题
- 目录遍历有 10 秒的超时限制，以防止在复杂目录结构中挂起
- 当达到文件限制时，会添加注释建议对特定子目录使用 `list_files`
- 不能用于确认您刚刚创建的文件是否存在
- 在非常大的目录结构中，性能可能降低
- 出于安全原因，无法列出根目录或主目录中的文件

## 工作原理

当调用 `list_files` 工具时，它会遵循以下流程：

1. **参数验证**：验证必填的 `path` 参数和可选的 `recursive` 参数
2. **路径解析**：将相对路径解析为绝对路径
3. **安全检查**：防止列出根目录或主目录等敏感位置中的文件
4. **目录扫描**：
    - 对于非递归模式：仅列出顶层内容
    - 对于递归模式：逐级遍历目录结构，超时时间为 10 秒
    - 如果超时，则返回已收集的部分结果
5. **结果过滤**：
    - 在递归模式下，跳过常见的大型目录，如 `node_modules`、`.git` 等
    - 在递归模式下，遵循 `.gitignore` 规则
    - 处理 `.kilocodeignore` 规则，要么隐藏文件，要么用锁符号标记
6. **格式化**：
    - 用斜杠（`/`）标记目录
    - 排序结果，先显示目录及其内容，保持逻辑层次结构
    - 当启用 `showKiloCodeIgnored` 时，用锁符号（🔒）标记被忽略的文件
    - 默认情况下，结果上限为 200 个文件，并提示使用子目录
    - 组织结果以提高可读性

## 文件列出格式

文件列出结果包括：

- 每个文件路径显示在其自己的行上
- 目录用斜杠（`/`）标记
- 当启用 `showKiloCodeIgnored` 时，被 `.kilocodeignore` 忽略的文件用锁符号（🔒）标记
- 结果按逻辑排序，先显示目录及其内容
- 当达到文件限制时，会出现一条消息，建议对特定子目录使用 `list_files`

示例输出格式：

```
src/
src/components/
src/components/Button.tsx
src/components/Header.tsx
src/utils/
src/utils/helpers.ts
src/index.ts
...
文件列出已截断（显示 200 个文件中的 543 个）。请对特定子目录使用 list_files 以获取更多详细信息。
```

当使用 `.kilocodeignore` 文件并启用 `showKiloCodeIgnored` 时：

```
src/
src/components/
src/components/Button.tsx
src/components/Header.tsx
🔒 src/secrets.json
src/utils/
src/utils/helpers.ts
src/index.ts
```

## 使用示例

- 当开始新任务时，Kilo Code 可能会列出项目文件以了解其结构，然后再深入研究特定代码。
- 当被要求查找特定类型的文件（如所有 JavaScript 文件）时，Kilo Code 首先列出目录以知道在哪里查找。
- 当提供代码组织建议时，Kilo Code 首先检查当前项目结构。
- 当设置新功能时，Kilo Code 列出相关目录以了解项目约定。

## 用法示例

列出当前目录中的顶层文件：

```
<list_files>
<path>.</path>
</list_files>
```

递归列出源目录中的所有文件：

```
<list_files>
<path>src</path>
<recursive>true</recursive>
</list_files>
```

检查特定项目的子目录：

```
<list_files>
<path>src/components</path>
<recursive>false</recursive>
</list_files>
```
