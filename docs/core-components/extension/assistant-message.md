# Assistant Message System

The assistant message system handles parsing and presenting AI assistant responses, including tool use detection
and content formatting. This system is crucial for interpreting structured responses from language models and
converting them into actionable tool calls.

## Location

`src/core/assistant-message/`

## Core Components

### parseAssistantMessage.ts

Parses raw assistant messages into structured content blocks, handling both text content and tool use instructions.

**Key Functions:**

- `parseAssistantMessage(assistantMessage: string): AssistantMessageContent[]`

**Features:**

- Parses XML-like tool use tags from assistant responses
- Handles partial/streaming messages during real-time parsing
- Supports nested parameter extraction for tool calls
- Manages special cases for file content that might contain closing tags

**Example Usage:**

```typescript
import { parseAssistantMessage } from "./parseAssistantMessage"

const response = `Here's the analysis:

<read_file>
<path>src/main.ts</path>
</read_file>

The file contains...`

const contentBlocks = parseAssistantMessage(response)
// Returns array of TextContent and ToolUse objects
```

### presentAssistantMessage.ts

Formats parsed assistant message content for display in the webview UI.

**Key Functions:**

- `presentAssistantMessage(content: AssistantMessageContent[]): string`

**Features:**

- Converts structured content blocks back to readable format
- Handles tool use presentation with proper formatting
- Manages partial content display during streaming

### Types

#### AssistantMessageContent

Union type representing different types of content in assistant messages:

```typescript
export type AssistantMessageContent = TextContent | ToolUse

interface TextContent {
	type: "text"
	content: string
	partial: boolean
}

interface ToolUse {
	type: "tool_use"
	name: ToolName
	params: Record<string, string>
	partial: boolean
}
```

## Integration Points

### Task Class Integration

The assistant message system is tightly integrated with the `Task` class:

```typescript
// In Task.ts
this.assistantMessageContent = parseAssistantMessage(streamingContent)
await presentAssistantMessage(this.assistantMessageContent)
```

### Streaming Support

The system supports real-time parsing of streaming responses:

- Handles partial tool use tags
- Manages incomplete parameter values
- Provides progressive content updates

### Tool Parameter Handling

Special handling for different parameter types:

- **Content parameters**: Preserve newlines and formatting
- **Command parameters**: Handle XML encoding (e.g., `&amp;` → `&`)
- **Path parameters**: Standard trimming and validation

## Error Handling

### Malformed XML

- Graceful handling of incomplete or malformed tool use tags
- Fallback to text content when parsing fails
- Preservation of partial content during streaming

### Special Cases

- **File content conflicts**: Handles cases where file content contains tool closing tags
- **Nested parameters**: Proper parsing of complex parameter structures
- **Encoding issues**: Automatic handling of XML entity encoding

## Configuration

The assistant message system respects global configuration settings:

- Tool availability based on provider settings
- Parameter validation based on tool definitions
- Content filtering based on workspace rules

## Testing

The system includes comprehensive tests for:

- Basic message parsing scenarios
- Streaming/partial message handling
- Edge cases with malformed content
- Tool parameter extraction
- Special character handling

## Performance Considerations

- **Streaming optimization**: Incremental parsing without full re-parsing
- **Memory efficiency**: Minimal object creation during parsing
- **Content caching**: Reuse of parsed content blocks where possible

## Future Enhancements

- Support for additional content types (images, files)
- Enhanced error recovery for malformed messages
- Performance optimizations for large message parsing
- Extended tool parameter validation
