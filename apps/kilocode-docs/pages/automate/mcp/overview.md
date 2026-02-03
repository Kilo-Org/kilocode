---
title: "MCP Overview"
description: "Overview of the Model Context Protocol"
---

# Model Context Protocol (MCP)

The Model Context Protocol (MCP) is a standard for extending Kilo Code's capabilities by connecting to external tools and services. MCP servers provide additional tools and resources that help Kilo Code accomplish tasks beyond its built-in capabilities, such as accessing databases, custom APIs, and specialized functionality.

## MCP Documentation

This documentation is organized into several sections:

- [**Using MCP in Kilo Code**](using-in-kilo-code) - Comprehensive guide to configuring, enabling, and managing MCP servers with Kilo Code. Includes server settings, tool approval, and troubleshooting.

- [**What is MCP?**](what-is-mcp) - Clear explanation of the Model Context Protocol, its client-server architecture, and how it enables AI systems to interact with external tools.

- [**STDIO & SSE Transports**](server-transports) - Detailed comparison of local (STDIO) and remote (SSE) transport mechanisms with deployment considerations for each approach.

- [**MCP vs API**](mcp-vs-api) - Analysis of the fundamental distinction between MCP and REST APIs, explaining how they operate at different layers of abstraction for AI systems.

## Contributing to the Marketplace

Have you created an MCP server that others might find useful? Share it with the community by contributing to the [Kilo Marketplace](https://github.com/Kilo-Org/kilo-marketplace)!

### How to Submit Your MCP Server

1. **Develop your server**: Create an MCP server following the [MCP specification](https://github.com/modelcontextprotocol/)
2. **Test thoroughly**: Ensure your server works correctly with Kilo Code and handles edge cases gracefully
3. **Fork the marketplace repository**: Visit [github.com/Kilo-Org/kilo-marketplace](https://github.com/Kilo-Org/kilo-marketplace) and create a fork
4. **Add your server**: Include your server configuration and documentation following the repository's structure
5. **Submit a pull request**: Create a PR with a clear description of what your server does and its requirements

### Submission Guidelines

- Document all available tools and resources your server provides
- Include example configurations for both STDIO and SSE transports if applicable
- Specify any required environment variables or API keys
- Note any platform-specific requirements (Windows, macOS, Linux)
- Follow the [contribution guidelines](https://github.com/Kilo-Org/kilo-marketplace/blob/main/CONTRIBUTING.md) in the marketplace repository

For more details on contributing to Kilo Code, see the [Contributing Guide](/docs/contributing).
