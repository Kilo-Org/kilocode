---
title: What is MCP?
sidebar_label: What is MCP?
---

# What is MCP?

MCP (Model Context Protocol) is a standardized communication protocol for LLM systems to interact with external tools and services. It functions as a universal adapter between AI assistants and various data sources or applications.

## How It Works

MCP uses a client-server architecture:

1. The AI assistant (client) connects to MCP servers
2. Each server provides specific capabilities (file access, database queries, API integrations)
3. The AI uses these capabilities through a standardized interface
4. Communication occurs via JSON-RPC 2.0 messages

Think of MCP as similar to a USB-C port in the sense that any compatible LLM can connect to any MCP server to access its functionality. This standardization eliminates the need to build custom integrations for each tool and service.

For example, an AI using MCP can perform tasks like "search our company database and generate a report" without requiring specialized code for each database system.

## Common Questions

- **Is MCP a cloud service?** MCP servers can run locally on your computer or remotely as cloud services, depending on the use case and security requirements.

- **Does MCP replace other integration methods?** No. MCP complements existing tools like API plugins and retrieval-augmented generation. It provides a standardized protocol for tool interaction but doesn't replace specialized integration approaches.

- **How is security handled?** Users control which MCP servers they connect to and what permissions those servers have. As with any tool that accesses data or services, use trusted sources and configure appropriate access controls.

## MCP in Kilo Code

Kilo Code implements the Model Context Protocol to:

- Connect to both local and remote MCP servers
- Provide a consistent interface for accessing tools
- Extend functionality without core modifications
- Enable specialized capabilities on demand

MCP provides a standardized way for AI systems to interact with external tools and services, making complex integrations more accessible and consistent.

## Learn More About MCP

Ready to dig deeper? Check out these guides:

- [MCP Overview](/features/mcp/overview) - A quick glance at the MCP documentation structure
- [Using MCP in Kilo Code](/features/mcp/using-mcp-in-kilo-code) - Get started with MCP in Kilo Code, including creating simple servers
- [MCP vs API](/features/mcp/mcp-vs-api) - Technical advantages compared to traditional APIs
- [STDIO & SSE Transports](/features/mcp/server-transports) - Local vs. hosted deployment models