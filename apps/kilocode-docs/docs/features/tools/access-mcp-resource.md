# access_mcp_resource

The `access_mcp_resource` tool retrieves data from resources exposed by connected Model Context Protocol (MCP) servers. It allows Kilo Code to access files, API responses, documentation, or system information that provides additional context for tasks.

## Parameters

The tool accepts these parameters:

- `server_name` (required): The name of the MCP server providing the resource
- `uri` (required): The URI identifying the specific resource to access

## What It Does

This tool connects to MCP servers and fetches data from their exposed resources. Unlike `use_mcp_tool` which executes actions, this tool specifically retrieves information that serves as context for tasks.

## When is it used?

- When Kilo Code needs additional context from external systems
- When Kilo Code needs to access domain-specific data from specialized MCP servers
- When Kilo Code needs to retrieve reference documentation hosted by MCP servers
- When Kilo Code needs to integrate real-time data from external APIs via MCP

## Key Features

- Retrieves both text and image data from MCP resources
- Requires user approval before executing resource access
- Uses URI-based addressing to precisely identify resources
- Integrates with the Model Context Protocol SDK
- Displays resource content appropriately based on content type
- Supports timeouts for reliable network operations
- Handles server connection states (connected, connecting, disconnected)
- Discovers available resources from connected servers
- Processes structured response data with metadata
- Handles image content special rendering

## Limitations

- Depends on external MCP servers being available and connected
- Limited to the resources provided by connected servers
- Cannot access resources from disabled servers
- Network issues can affect reliability and performance
- Resource access subject to configured timeouts
- URI formats are determined by the specific MCP server implementation
- No offline or cached resource access capabilities

## How It Works

When the `access_mcp_resource` tool is invoked, it follows this process:

1. **Connection Validation**:
   - Verifies that an MCP hub is available and initialized
   - Confirms the specified server exists in the connection list
   - Checks if the server is disabled (returns an error if it is)

2. **User Approval**:
   - Presents the resource access request to the user for approval
   - Provides server name and resource URI for user verification
   - Proceeds only if the user approves the resource access

3. **Resource Request**:
   - Uses the Model Context Protocol SDK to communicate with servers
   - Makes a `resources/read` request to the server through the MCP hub
   - Applies configured timeouts to prevent hanging on unresponsive servers

4. **Response Processing**:
   - Receives a structured response with metadata and content arrays
   - Processes text content for display to the user
   - Handles image data specially for appropriate display
   - Returns the processed resource data to Kilo Code for use in the current task

## Resource Types

MCP servers can provide two main types of resources:

1. **Standard Resources**:
   - Fixed resources with specific URIs
   - Defined name, description, and MIME type
   - Direct access without parameters
   - Typically represent static data or real-time information

2. **Resource Templates**:
   - Parameterized resources with placeholder values in URIs
   - Allow dynamic resource generation based on provided parameters
   - Can represent queries or filtered views of data
   - More flexible but require additional URI formatting

## Examples When Used

- When helping with API development, Kilo Code retrieves endpoint specifications from MCP resources to ensure correct implementation.
- When assisting with data visualization, Kilo Code accesses current data samples from connected MCP servers.
- When working in specialized domains, Kilo Code retrieves technical documentation to provide accurate guidance.
- When generating industry-specific code, Kilo Code references compliance requirements from documentation resources.

## Usage Examples

Accessing current weather data:
```
<access_mcp_resource>
<server_name>weather-server</server_name>
<uri>weather://san-francisco/current</uri>
</access_mcp_resource>
```

Retrieving API documentation:
```
<access_mcp_resource>
<server_name>api-docs</server_name>
<uri>docs://payment-service/endpoints</uri>
</access_mcp_resource>
```

Accessing domain-specific knowledge:
```
<access_mcp_resource>
<server_name>knowledge-base</server_name>
<uri>kb://medical/terminology/common</uri>
</access_mcp_resource>
```

Fetching system configuration:
```
<access_mcp_resource>
<server_name>infra-monitor</server_name>
<uri>config://production/database</uri>
</access_mcp_resource>
```
