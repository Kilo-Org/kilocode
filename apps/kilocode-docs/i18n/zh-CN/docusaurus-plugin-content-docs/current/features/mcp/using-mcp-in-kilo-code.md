---
title: 在Kilo Code中使用MCP
sidebar_label: 在Kilo Code中使用MCP
---

# 在Kilo Code中使用MCP

模型上下文协议（MCP）通过连接外部工具和服务扩展了Kilo Code的功能。本指南涵盖了在Kilo Code中使用MCP所需了解的所有内容。

<YouTubeEmbed
  url="https://youtu.be/6O9RQoQRX8A"
  caption="演示Kilo Code中的MCP安装"
/>

## 配置MCP服务器

MCP服务器配置可以在两个级别进行管理：

1. **全局配置**：存储在`mcp_settings.json`文件中，可通过VS Code设置访问（见下文）。这些设置适用于所有工作区，除非被项目级配置覆盖。
2. **项目级配置**：在项目根目录的`.kilocode/mcp.json`文件中定义。这允许你设置项目特定的服务器，并通过将文件提交到版本控制与团队共享配置。如果存在，Kilo Code会自动检测并加载此文件。

**优先级**：如果服务器名称同时存在于全局和项目配置中，则**项目级配置优先**。

### 编辑MCP设置文件

你可以直接从Kilo Code MCP设置视图编辑全局和项目级MCP配置文件：

1.  单击 Kilo Code 窗格顶部导航栏中的 <Codicon name="gear" /> 图标以打开 `Settings`。
2.  单击左侧的 `MCP Servers` 选项卡
3.  选择 `Installed` 服务器
4.  单击相应的按钮：
    - **`Edit Global MCP`**：打开全局 `mcp_settings.json` 文件。
    - **`Edit Project MCP`**：打开项目特定的 `.kilocode/mcp.json` 文件。如果此文件不存在，Kilo Code 将为您创建它。

  <img src="/docs/img/using-mcp-in-kilo-code/mcp-installed-config.png" alt="编辑全局 MCP 和编辑项目 MCP 按钮" width="600" />

两个文件都使用JSON格式，其中包含一个`mcpServers`对象，包含命名的服务器配置：

```json
{
	"mcpServers": {
		"server1": {
			"command": "python",
			"args": ["/path/to/server.py"],
			"env": {
				"API_KEY": "your_api_key"
			},
			"alwaysAllow": ["tool1", "tool2"],
			"disabled": false
		}
	}
}
```

_Kilo Code中的MCP服务器配置示例（STDIO传输）_

### 理解传输类型

MCP支持两种服务器通信的传输类型：

#### STDIO传输

用于在本地机器上运行的服务器：

- 通过标准输入/输出流通信
- 延迟更低（无网络开销）
- 安全性更好（无网络暴露）
- 设置更简单（不需要HTTP服务器）
- 作为本地机器上的子进程运行

有关STDIO传输工作原理的深入信息，请参见[STDIO传输](/features/mcp/server-transports#stdio传输)。

STDIO配置示例：

```json
{
	"mcpServers": {
		"local-server": {
			"command": "node",
			"args": ["/path/to/server.js"],
			"env": {
				"API_KEY": "your_api_key"
			},
			"alwaysAllow": ["tool1", "tool2"],
			"disabled": false
		}
	}
}
```

#### SSE传输

用于通过HTTP/HTTPS访问的远程服务器：

- 通过服务器发送事件协议通信
- 可以托管在不同的机器上
- 支持多个客户端连接
- 需要网络访问
- 允许集中部署和管理

有关SSE传输工作原理的深入信息，请参见[SSE传输](/features/mcp/server-transports#sse传输)。

SSE配置示例：

```json
{
	"mcpServers": {
		"remote-server": {
			"url": "https://your-server-url.com/mcp",
			"headers": {
				"Authorization": "Bearer your-token"
			},
			"alwaysAllow": ["tool3"],
			"disabled": false
		}
	}
}
```

### 删除服务器

1. 点击要删除的MCP服务器旁边的<Codicon name="trash" />
2. 在确认框中点击`删除`按钮

 <img src="/docs/img/using-mcp-in-kilo-code/using-mcp-in-kilo-code-5.png" alt="删除确认框" width="400" />

### 重启服务器

1. 点击要重启的MCP服务器旁边的<Codicon name="refresh" />按钮

### 启用或禁用服务器

1. 点击MCP服务器旁边的<Codicon name="activate" />切换开关以启用/禁用

### 网络超时

设置调用MCP服务器工具后等待响应的最长时间：

1. 点击单个MCP服务器配置框底部的`网络超时`下拉菜单并更改时间。默认值为1分钟，但可以设置为30秒到5分钟之间。

<img src="/docs/img/using-mcp-in-kilo-code/using-mcp-in-kilo-code-6.png" alt="网络超时下拉菜单" width="400" />

### 自动批准工具

MCP工具自动批准按工具进行，默认禁用。要配置自动批准：

1. 首先在[自动批准操作](/features/auto-approving-actions)中启用全局"使用MCP服务器"自动批准选项
2. 在MCP服务器设置中，定位要自动批准的特定工具
3. 勾选工具名称旁边的`始终允许`复选框

<img src="/docs/img/using-mcp-in-kilo-code/using-mcp-in-kilo-code-7.png" alt="MCP工具的始终允许复选框" width="120" />

启用后，Kilo Code将自动批准此特定工具而无需提示。请注意，全局"使用MCP服务器"设置优先 - 如果它被禁用，则不会自动批准任何MCP工具。

## 查找和安装MCP服务器

Kilo Code不附带任何预安装的MCP服务器。你需要单独查找并安装它们。

- **社区仓库**：在GitHub上查看社区维护的MCP服务器列表
- **询问Kilo Code**：你可以请Kilo Code帮助你查找甚至创建MCP服务器
- **自行构建**：使用SDK创建自定义MCP服务器，使用你自己的工具扩展Kilo Code

有关完整的SDK文档，请访问[MCP GitHub仓库](https://github.com/modelcontextprotocol/)。

## 在工作流中使用MCP工具

配置MCP服务器后，Kilo Code将自动检测可用的工具和资源。要使用它们：

1. 在Kilo Code聊天界面中输入你的请求
2. Kilo Code将识别何时MCP工具可以帮助完成任务
3. 在提示时批准工具使用（或使用自动批准）

示例："分析我的API性能"可能会使用一个测试API端点的MCP工具。

## 故障排除MCP服务器

常见问题及解决方案：

- **服务器无响应**：检查服务器进程是否正在运行并验证网络连接
- **权限错误**：确保在`mcp_settings.json`（用于全局设置）或`.kilocode/mcp.json`（用于项目设置）中配置了正确的API密钥和凭据。
- **工具不可用**：确认服务器是否正确实现了该工具且未在设置中禁用
- **性能缓慢**：尝试调整特定MCP服务器的网络超时值

## 平台特定的MCP配置示例

### Windows配置示例

在Windows上设置MCP服务器时，你需要使用Windows命令提示符（`cmd`）来执行命令。以下是在Windows上配置Puppeteer MCP服务器的示例：

```json
{
	"mcpServers": {
		"puppeteer": {
			"command": "cmd",
			"args": ["/c", "npx", "-y", "@modelcontextprotocol/server-puppeteer"]
		}
	}
}
```

此Windows特定配置：

- 使用`cmd`命令访问Windows命令提示符
- 使用`/c`告诉cmd执行命令然后终止
- 使用`npx`运行包而无需永久安装
- `-y`标志在安装期间自动回答"是"任何提示
- 运行提供浏览器自动化功能的`@modelcontextprotocol/server-puppeteer`包

:::note
对于macOS或Linux，你将使用不同的配置：

```json
{
	"mcpServers": {
		"puppeteer": {
			"command": "npx",
			"args": ["-y", "@modelcontextprotocol/server-puppeteer"]
		}
	}
}
```

:::

相同的方法可以用于Windows上的其他MCP服务器，根据需要调整包名称以匹配不同的服务器类型。
