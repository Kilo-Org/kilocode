# use_mcp_tool

The `use_mcp_tool` tool enables interaction with external tools provided by connected Model Context Protocol (MCP) servers. It extends Kilo Code's capabilities with domain-specific functionality through a standardized protocol.

## Parameters

The tool accepts these parameters:

- `server_name` (required): The name of the MCP server providing the tool
- `tool_name` (required): The name of the tool to execute
- `arguments` (required/optional): A JSON object containing the tool's input parameters, following the tool's input schema. May be optional for tools that require no input.

## What It Does

This tool allows Kilo Code to access specialized functionality provided by external MCP servers. Each MCP server can offer multiple tools with unique capabilities, extending Kilo Code beyond its built-in functionality. The system validates arguments against schemas, manages server connections, and processes responses of various content types (text, image, resource).

## When is it used?

- When specialized functionality not available in core tools is needed
- When domain-specific operations are required
- When integration with external systems or services is needed
- When working with data that requires specific processing or analysis
- When accessing proprietary tools through a standardized interface

## Key Features

- Uses the standardized MCP protocol via the `@modelcontextprotocol/sdk` library
- Supports multiple transport mechanisms (StdioClientTransport and SSEClientTransport)
- Validates arguments using Zod schema validation on both client and server sides
- Processes multiple response content types: text, image, and resource references
- Manages server lifecycle with automatic restarts when server code changes
- Provides an "always allow" mechanism to bypass approval for trusted tools
- Works with the companion `access_mcp_resource` tool for resource retrieval
- Maintains proper error tracking and handling for failed operations
- Supports configurable timeouts (1-3600 seconds, default: 60 seconds)
- Allows file watchers to automatically detect and reload server changes

## Limitations

- Depends on external MCP servers being available and connected
- Limited to the tools provided by connected servers
- Tool capabilities vary between different MCP servers
- Network issues can affect reliability and performance
- Requires user approval before execution (unless in the "always allow" list)
- Cannot execute multiple MCP tool operations simultaneously

## Server Configuration

MCP servers can be configured globally or at the project level:

- **Global Configuration**: Managed through the Kilo Code extension settings in VS Code. These apply across all projects unless overridden.
- **Project-level Configuration**: Defined in a `.kilocode/mcp.json` file within your project's root directory.
- This allows project-specific server setups.
- Project-level servers take precedence over global servers if they share the same name.
- Since `.kilocode/mcp.json` can be committed to version control, it simplifies sharing configurations with your team.

## How It Works

When the `use_mcp_tool` tool is invoked, it follows this process:

1. **Initialization and Validation**:

    - The system verifies that the MCP hub is available
    - Confirms the specified server exists and is connected
    - Validates the requested tool exists on the server
    - Arguments are validated against the tool's schema definition
    - Timeout settings are extracted from server configuration (default: 60 seconds)

2. **Execution and Communication**:

    - The system selects the appropriate transport mechanism:
        - `StdioClientTransport`: For communicating with local processes via standard I/O
        - `SSEClientTransport`: For communicating with HTTP servers via Server-Sent Events
    - A request is sent with validated server name, tool name, and arguments
    - Communication uses the `@modelcontextprotocol/sdk` library for standardized interactions
    - Request execution is tracked with timeout handling to prevent hanging operations

3. **Response Processing**:

    - Responses can include multiple content types:
        - Text content: Plain text responses
        - Image content: Binary image data with MIME type information
        - Resource references: URIs to access server resources (works with `access_mcp_resource`)
    - The system checks the `isError` flag to determine if error handling is needed
    - Results are formatted for display in the Kilo Code interface

4. **Resource and Error Handling**:
    - The system uses WeakRef patterns to prevent memory leaks
    - A consecutive mistake counter tracks and manages errors
    - File watchers monitor for server code changes and trigger automatic restarts
    - The security model requires approval for tool execution unless in the "always allow" list

## Security and Permissions

The MCP architecture provides several security features:

- Users must approve tool usage before execution (by default)
- Specific tools can be marked for automatic approval in the "always allow" list
- Server configurations are validated with Zod schemas for integrity
- Configurable timeouts prevent hanging operations (1-3600 seconds)
- Server connections can be enabled or disabled through the UI

## Examples When Used

- Analyzing specialized data formats using server-side processing tools
- Generating images or other media through AI models hosted on external servers
- Executing complex domain-specific calculations without local implementation
- Accessing proprietary APIs or services through a controlled interface
- Retrieving data from specialized databases or data sources

## Usage Examples

Requesting weather forecast data with text response:

```
<use_mcp_tool>
<server_name>weather-server</server_name>
<tool_name>get_forecast</tool_name>
<arguments>
{
  "city": "San Francisco",
  "days": 5,
  "format": "text"
}
</arguments>
</use_mcp_tool>
```

Analyzing source code with a specialized tool that returns JSON:

```
<use_mcp_tool>
<server_name>code-analysis</server_name>
<tool_name>complexity_metrics</tool_name>
<arguments>
{
  "language": "typescript",
  "file_path": "src/app.ts",
  "include_functions": true,
  "metrics": ["cyclomatic", "cognitive"]
}
</arguments>
</use_mcp_tool>
```

Generating an image with specific parameters:

```
<use_mcp_tool>
<server_name>image-generation</server_name>
<tool_name>create_image</tool_name>
<arguments>
{
  "prompt": "A futuristic city with flying cars",
  "style": "photorealistic",
  "dimensions": {
    "width": 1024,
    "height": 768
  },
  "format": "webp"
}
</arguments>
</use_mcp_tool>
```

Accessing a resource through a tool that returns a resource reference:

```
<use_mcp_tool>
<server_name>database-connector</server_name>
<tool_name>query_and_store</tool_name>
<arguments>
{
  "database": "users",
  "type": "select",
  "fields": ["name", "email", "last_login"],
  "where": {
    "status": "active"
  },
  "store_as": "active_users"
}
</arguments>
</use_mcp_tool>
```

Tool with no required arguments:

```
<use_mcp_tool>
<server_name>system-monitor</server_name>
<tool_name>get_current_status</tool_name>
<arguments>
{}
</arguments>
</use_mcp_tool>
```
