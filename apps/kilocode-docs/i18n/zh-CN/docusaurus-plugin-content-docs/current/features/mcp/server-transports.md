---
title: MCP服务器传输机制
sidebar_label: STDIO与SSE传输
---

# MCP服务器传输机制：STDIO与SSE

模型上下文协议（MCP）支持两种主要的传输机制用于Kilo Code与MCP服务器之间的通信：标准输入/输出（STDIO）和服务器发送事件（SSE）。每种机制都有其独特的特点、优势和适用场景。

## STDIO传输

STDIO传输在本地机器上运行，通过标准输入/输出流进行通信。

### STDIO传输工作原理

1. 客户端（Kilo Code）将MCP服务器作为子进程启动
2. 通信通过进程流进行：客户端写入服务器的STDIN，服务器响应到STDOUT
3. 每个消息以换行符分隔
4. 消息格式为JSON-RPC 2.0

```
Client                    Server
  |                         |
  |---- JSON message ------>| (via STDIN)
  |                         | (processes request)
  |<---- JSON message ------| (via STDOUT)
  |                         |
```

### STDIO特点

- **本地性**：与Kilo Code在同一台机器上运行
- **性能**：延迟和开销非常低（不涉及网络栈）
- **简单性**：直接进程通信，无需网络配置
- **关系**：客户端与服务器之间的一对一关系
- **安全性**：本质上更安全，因为不暴露网络

### 使用STDIO的场景

STDIO传输适用于：

- 本地集成和工具
- 安全敏感操作
- 低延迟要求
- 单客户端场景（每个服务器一个Kilo Code实例）
- 命令行工具或IDE扩展

### STDIO实现示例

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"

const server = new Server({ name: "local-server", version: "1.0.0" })
// 注册工具...

// 使用STDIO传输
const transport = new StdioServerTransport(server)
transport.listen()
```

## SSE传输

服务器发送事件（SSE）传输在远程服务器上运行，通过HTTP/HTTPS进行通信。

### SSE传输工作原理

1. 客户端（Kilo Code）通过HTTP GET请求连接到服务器的SSE端点
2. 建立持久连接，服务器可以向客户端推送事件
3. 对于客户端到服务器的通信，客户端向单独的端点发送HTTP POST请求
4. 通信通过两个通道进行：
    - 事件流（GET）：服务器到客户端更新
    - 消息端点（POST）：客户端到服务器请求

```
Client                             Server
  |                                  |
  |---- HTTP GET /events ----------->| (establish SSE connection)
  |<---- SSE event stream -----------| (persistent connection)
  |                                  |
  |---- HTTP POST /message --------->| (client request)
  |<---- SSE event with response ----| (server response)
  |                                  |
```

### SSE特点

- **远程访问**：可以托管在与Kilo Code不同的机器上
- **可扩展性**：支持多个客户端并发连接
- **协议**：基于标准HTTP（无需特殊协议）
- **持久性**：维护服务器到客户端消息的持久连接
- **认证**：可以使用标准HTTP认证机制

### 使用SSE的场景

SSE传输更适合：

- 跨网络远程访问
- 多客户端场景
- 公共服务
- 许多用户需要访问的集中式工具
- 与Web服务集成

### SSE实现示例

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import express from "express"

const app = express()
const server = new Server({ name: "remote-server", version: "1.0.0" })
// 注册工具...

// 使用SSE传输
const transport = new SSEServerTransport(server)
app.use("/mcp", transport.requestHandler())
app.listen(3000, () => {
	console.log("MCP server listening on port 3000")
})
```

## 本地 vs. 托管：部署考虑

选择STDIO还是SSE传输将直接影响MCP服务器的部署和管理方式。

### STDIO：本地部署模式

STDIO服务器与Kilo Code在同一台机器上运行，这有几个重要影响：

- **安装**：必须在每个用户的机器上安装服务器可执行文件
- **分发**：需要为不同操作系统提供安装包
- **更新**：每个实例必须单独更新
- **资源**：使用本地机器的CPU、内存和磁盘
- **访问控制**：依赖于本地机器的文件系统权限
- **集成**：易于与本地系统资源（文件、进程）集成
- **执行**：随Kilo Code启动和停止（子进程生命周期）
- **依赖**：任何依赖项都必须安装在用户机器上

#### 实际示例

一个本地文件搜索工具使用STDIO会：

- 在用户机器上运行
- 直接访问本地文件系统
- 在Kilo Code需要时启动
- 不需要网络配置
- 需要与Kilo Code一起安装或通过包管理器安装

### SSE：托管部署模式

SSE服务器可以部署到远程服务器并通过网络访问：

- **安装**：在服务器上安装一次，供多个用户访问
- **分发**：单一部署服务多个客户端
- **更新**：集中更新立即影响所有用户
- **资源**：使用服务器资源，而非本地机器资源
- **访问控制**：通过认证和授权系统管理
- **集成**：与用户特定资源的集成更复杂
- **执行**：作为独立服务运行（通常持续运行）
- **依赖**：在服务器上管理，而非用户机器

#### 实际示例

一个数据库查询工具使用SSE会：

- 在中央服务器上运行
- 使用服务器端凭据连接数据库
- 持续可用，供多个用户使用
- 需要正确的网络安全配置
- 使用容器或云技术部署

### 混合方法

某些场景受益于混合方法：

1. **带网络访问的STDIO**：本地STDIO服务器充当远程服务的代理
2. **带本地命令的SSE**：远程SSE服务器可以通过回调触发客户端机器上的操作
3. **网关模式**：本地操作的STDIO服务器连接到专用功能的SSE服务器

## 选择STDIO还是SSE

| 考虑因素       | STDIO          | SSE                      |
| -------------- | -------------- | ------------------------ |
| **位置**       | 仅限本地机器   | 本地或远程               |
| **客户端**     | 单客户端       | 多客户端                 |
| **性能**       | 延迟更低       | 延迟更高（网络开销）     |
| **设置复杂性** | 更简单         | 更复杂（需要HTTP服务器） |
| **安全性**     | 本质上更安全   | 需要明确的安全措施       |
| **网络访问**   | 不需要         | 需要                     |
| **可扩展性**   | 限于本地机器   | 可以在网络上分布         |
| **部署**       | 每用户安装     | 集中安装                 |
| **更新**       | 分布式更新     | 集中更新                 |
| **资源使用**   | 使用客户端资源 | 使用服务器资源           |
| **依赖**       | 客户端依赖     | 服务器依赖               |

## 在Kilo Code中配置传输

有关在Kilo Code中配置STDIO和SSE传输的详细信息，包括示例配置，请参见[理解传输类型](/features/mcp/using-mcp-in-kilo-code#understanding-transport-types)部分。
