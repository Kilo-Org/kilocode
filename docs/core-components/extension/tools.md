# Tools System

The tools system provides the AI assistant with capabilities to interact with the development
environment. It includes a comprehensive set of tools for file operations, command execution, code
analysis, and workspace management, along with validation, error handling, and repetition detection
mechanisms.

## Location

`src/core/tools/`

## Architecture Overview

### Tool Framework

The tools system is built around a standardized interface that all tools implement:

```typescript
interface ToolFunction {
	(
		cline: Task,
		block: ToolUse,
		askApproval: AskApproval,
		handleError: HandleError,
		pushToolResult: PushToolResult,
		removeClosingTag: RemoveClosingTag,
	): Promise<void>
}
```

### Core Components

#### Tool Validation (`validateToolUse.ts`)

Validates tool usage against current mode and configuration:

```typescript
export function validateToolUse(
	toolName: ToolName,
	mode: Mode,
	customModes?: ModeConfig[],
	toolRequirements?: Record<string, boolean>,
	toolParams?: Record<string, unknown>,
): void
```

**Features:**

- **Mode-based validation**: Ensures tools are allowed in current mode
- **Custom mode support**: Respects user-defined mode configurations
- **Parameter validation**: Validates tool parameters before execution
- **Requirement checking**: Verifies tool requirements are met

#### Tool Repetition Detection (`ToolRepetitionDetector.ts`)

Prevents infinite loops and repetitive tool usage:

```typescript
export class ToolRepetitionDetector {
	public check(currentToolCallBlock: ToolUse): {
		allowExecution: boolean
		askUser?: { messageKey: string; messageDetail: string }
	}
}
```

**Features:**

- **Identical call detection**: Compares tool calls using canonical JSON serialization
- **Configurable limits**: Adjustable repetition thresholds
- **Special handling**: Different limits for specific tools (e.g., browser actions)
- **Recovery mechanism**: Resets counters after user intervention

## Core Tools

### File Operations

#### Read File Tool (`readFileTool.ts`)

Reads file contents with support for multiple files and line ranges:

**Key Features:**

- **Multi-file support**: Read multiple files in a single operation
- **Line range selection**: Read specific line ranges from files
- **Binary file handling**: Support for extracting text from PDFs, DOCX, etc.
- **Size limitations**: Configurable limits to prevent token overflow
- **Batch approval**: Efficient approval process for multiple files

**Usage Examples:**

```xml
<!-- Single file -->
<read_file>
<path>src/main.ts</path>
</read_file>

<!-- Multiple files with line ranges -->
<read_file>
<args>
<file>
  <path>src/main.ts</path>
  <line_range>1-50</line_range>
</file>
<file>
  <path>src/utils.ts</path>
</file>
</args>
</read_file>
```

#### Write to File Tool (`writeToFileTool.ts`)

Creates new files or modifies existing files with comprehensive validation:

**Key Features:**

- **Streaming support**: Real-time content streaming during creation
- **Diff visualization**: Shows changes before applying them
- **Code omission detection**: Detects truncated or incomplete code
- **Line count validation**: Ensures complete content delivery
- **Protection checks**: Respects file protection settings

**Usage Example:**

```xml
<write_to_file>
<path>src/new-feature.ts</path>
<content>
export function newFeature() {
  return "Hello, World!"
}
</content>
<line_count>3</line_count>
</write_to_file>
```

#### Search and Replace Tool (`searchAndReplaceTool.ts`)

Performs targeted text replacements in files:

**Key Features:**

- **Pattern matching**: Support for exact string and regex patterns
- **Multi-occurrence handling**: Replace all or specific occurrences
- **Context preservation**: Maintains surrounding code context
- **Validation**: Ensures replacements are valid and safe

### Command Execution

#### Execute Command Tool (`executeCommandTool.ts`)

Executes shell commands with comprehensive monitoring:

**Key Features:**

- **Cross-platform support**: Works on Windows, macOS, and Linux
- **Real-time output**: Streams command output in real-time
- **Timeout handling**: Configurable command timeouts
- **Working directory**: Executes commands in specified directories
- **Environment variables**: Support for custom environment variables

**Usage Example:**

```xml
<execute_command>
<command>npm test</command>
</execute_command>
```

### Code Analysis

#### Codebase Search Tool (`codebaseSearchTool.ts`)

Searches across the entire codebase using various strategies:

**Key Features:**

- **Multiple search types**: Text search, regex, symbol search
- **File filtering**: Include/exclude patterns for targeted search
- **Context extraction**: Provides surrounding context for matches
- **Performance optimization**: Efficient indexing and caching

#### List Code Definition Names Tool (`listCodeDefinitionNamesTool.ts`)

Extracts code definitions and symbols from files:

**Key Features:**

- **Language support**: Supports multiple programming languages
- **Symbol extraction**: Functions, classes, interfaces, types
- **Tree-sitter integration**: Uses tree-sitter for accurate parsing
- **Hierarchical output**: Organized by symbol type and scope

### Browser Integration

#### Browser Action Tool (`browserActionTool.ts`)

Controls browser automation for web-related tasks:

**Key Features:**

- **Page navigation**: Navigate to URLs and interact with pages
- **Element interaction**: Click, type, scroll, and other interactions
- **Content extraction**: Extract text and data from web pages
- **Screenshot capture**: Take screenshots for visual verification

### Specialized Tools

#### Apply Diff Tool (`applyDiffTool.ts`)

Applies code diffs to existing files:

**Key Features:**

- **Unified diff format**: Standard diff format support
- **Fuzzy matching**: Handles minor context differences
- **Multi-file diffs**: Apply changes across multiple files
- **Conflict resolution**: Handles merge conflicts gracefully

#### MCP Tool Integration (`useMcpToolTool.ts`)

Integrates with Model Context Protocol (MCP) tools:

**Key Features:**

- **Dynamic tool discovery**: Automatically discovers available MCP tools
- **Parameter forwarding**: Passes parameters to MCP tools
- **Result processing**: Handles MCP tool responses
- **Error handling**: Graceful handling of MCP tool failures

## Tool Execution Flow

### 1. Validation Phase

```typescript
// Validate tool usage against current mode
validateToolUse(toolName, mode, customModes, toolRequirements, toolParams)

// Check for repetitive usage
const { allowExecution, askUser } = toolRepetitionDetector.check(toolUse)
```

### 2. Permission Phase

```typescript
// Request user approval for tool execution
const didApprove = await askApproval("tool", message, undefined, isProtected)
```

### 3. Execution Phase

```typescript
// Execute the tool with error handling
try {
	await toolFunction(cline, block, askApproval, handleError, pushToolResult, removeClosingTag)
} catch (error) {
	await handleError("tool execution", error)
}
```

### 4. Result Processing

```typescript
// Push results back to the conversation
pushToolResult(formattedResult)
```

## Error Handling

### Parameter Validation

```typescript
if (!requiredParam) {
	cline.consecutiveMistakeCount++
	cline.recordToolError(toolName)
	pushToolResult(await cline.sayAndCreateMissingParamError(toolName, "paramName"))
	return
}
```

### Access Control

```typescript
const accessAllowed = cline.rooIgnoreController?.validateAccess(filePath)
if (!accessAllowed) {
	await cline.say("rooignore_error", filePath)
	pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(filePath)))
	return
}
```

### Execution Errors

```typescript
try {
	// Tool execution
} catch (error) {
	await handleError("operation description", error)
	pushToolResult(formatResponse.toolError(error.message))
	return
}
```

## Performance Optimizations

### Caching

- **File content caching**: Avoid repeated file reads
- **Search result caching**: Cache search results for repeated queries
- **Symbol parsing caching**: Cache parsed code symbols

### Streaming

- **Real-time updates**: Stream tool output as it becomes available
- **Progressive results**: Show partial results during long operations
- **Cancellation support**: Allow users to cancel long-running operations

### Batch Operations

- **Multi-file operations**: Process multiple files in single operations
- **Bulk approvals**: Efficient approval process for multiple actions
- **Parallel execution**: Execute independent operations concurrently

## Security Considerations

### File Access Control

- **RooIgnore integration**: Respects .rooignore file restrictions
- **Path validation**: Prevents access outside workspace boundaries
- **Permission checks**: Validates file permissions before operations

### Command Execution Safety

- **Command validation**: Validates commands before execution
- **Environment isolation**: Executes commands in controlled environment
- **Resource limits**: Prevents resource exhaustion attacks

### Data Protection

- **Sensitive data detection**: Automatically detects and protects sensitive data
- **Audit logging**: Comprehensive logging of all tool operations
- **User consent**: Requires explicit user approval for sensitive operations

## Testing

### Unit Tests

Each tool includes comprehensive unit tests covering:

- Parameter validation
- Error handling scenarios
- Edge cases and boundary conditions
- Performance characteristics

### Integration Tests

End-to-end tests verify:

- Tool interaction with file system
- Command execution in various environments
- Error recovery and user interaction
- Performance under realistic conditions

## Future Enhancements

- **Plugin system**: Extensible tool architecture for custom tools
- **Advanced caching**: More sophisticated caching strategies
- **Parallel execution**: Concurrent tool execution capabilities
- **Enhanced validation**: More comprehensive parameter validation
- **Performance monitoring**: Real-time performance metrics and optimization
