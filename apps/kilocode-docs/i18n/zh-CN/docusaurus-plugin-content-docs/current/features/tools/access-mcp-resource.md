# access_mcp_resource

`access_mcp_resource` 工具用于从连接的 Model Context Protocol (MCP) 服务器中检索资源数据。它允许 Kilo Code 访问文件、API 响应、文档或系统信息，为任务提供额外的上下文。

## 参数

该工具接受以下参数：

- `server_name` (必填): 提供资源的 MCP 服务器名称
- `uri` (必填): 标识要访问的特定资源的 URI

## 功能

该工具连接到 MCP 服务器并从其暴露的资源中获取数据。与 `use_mcp_tool` 执行操作不同，该工具专门检索为任务提供上下文的信息。

## 使用场景

- 当 Kilo Code 需要从外部系统获取额外上下文时
- 当 Kilo Code 需要从专门的 MCP 服务器访问领域特定数据时
- 当 Kilo Code 需要检索由 MCP 服务器托管的参考文档时
- 当 Kilo Code 需要通过 MCP 从外部 API 集成实时数据时

## 主要特性

- 从 MCP 资源中检索文本和图像数据
- 在执行资源访问前需要用户批准
- 使用基于 URI 的寻址来精确定位资源
- 与 Model Context Protocol SDK 集成
- 根据内容类型适当显示资源内容
- 支持超时以确保网络操作的可靠性
- 处理服务器连接状态（已连接、连接中、断开连接）
- 发现来自连接服务器的可用资源
- 处理带有元数据的结构化响应数据
- 特殊处理图像内容的渲染

## 限制

- 依赖于外部 MCP 服务器的可用性和连接性
- 仅限于连接服务器提供的资源
- 无法访问已禁用服务器的资源
- 网络问题可能影响可靠性和性能
- 资源访问受配置的超时限制
- URI 格式由特定的 MCP 服务器实现决定
- 没有离线或缓存的资源访问能力

## 工作原理

当调用 `access_mcp_resource` 工具时，它会遵循以下流程：

1. **连接验证**:

    - 验证 MCP 中心是否可用且已初始化
    - 确认指定的服务器存在于连接列表中
    - 检查服务器是否被禁用（如果被禁用则返回错误）

2. **用户批准**:

    - 向用户呈现资源访问请求以获取批准
    - 提供服务器名称和资源 URI 以供用户验证
    - 仅在用户批准资源访问后继续

3. **资源请求**:

    - 使用 Model Context Protocol SDK 与服务器通信
    - 通过 MCP 中心向服务器发出 `resources/read` 请求
    - 应用配置的超时以防止服务器无响应时挂起

4. **响应处理**:
    - 接收带有元数据和内容数组的结构化响应
    - 处理文本内容以供用户显示
    - 特殊处理图像数据以适当显示
    - 将处理后的资源数据返回给 Kilo Code 以用于当前任务

## 资源类型

MCP 服务器可以提供两种主要类型的资源：

1. **标准资源**:

    - 具有特定 URI 的固定资源
    - 定义名称、描述和 MIME 类型
    - 无需参数的直接访问
    - 通常表示静态数据或实时信息

2. **资源模板**:
    - 具有 URI 中占位符值的参数化资源
    - 允许基于提供的参数动态生成资源
    - 可以表示查询或数据过滤视图
    - 更灵活但需要额外的 URI 格式化

## 使用示例

- 在帮助开发 API 时，Kilo Code 从 MCP 资源中检索端点规范以确保正确实现。
- 在协助数据可视化时，Kilo Code 从连接的 MCP 服务器访问当前数据样本。
- 在特定领域工作时，Kilo Code 检索技术文档以提供准确的指导。
- 在生成行业特定代码时，Kilo Code 参考文档中的合规要求。

## 使用示例

访问当前的天气数据：

```
<access_mcp_resource>
<server_name>weather-server</server_name>
<uri>weather://san-francisco/current</uri>
</access_mcp_resource>
```

检索 API 文档：

```
<access_mcp_resource>
<server_name>api-docs</server_name>
<uri>docs://payment-service/endpoints</uri>
</access_mcp_resource>
```

访问领域特定知识：

```
<access_mcp_resource>
<server_name>knowledge-base</server_name>
<uri>kb://medical/terminology/common</uri>
</access_mcp_resource>
```

获取系统配置：

```
<access_mcp_resource>
<server_name>infra-monitor</server_name>
<uri>config://production/database</uri>
</access_mcp_resource>
```
