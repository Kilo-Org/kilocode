# Typed LLM Stream: Architecture and Roadmap

This document outlines the current architecture of the `typed-llm-stream` library, recent improvements, and potential future enhancements.

## Current Architecture

The `typed-llm-stream` library provides a type-safe, functional approach to handling streaming responses from LLMs, with a focus on XML parsing for structured tool output.

### Core Components

1. **Tools**: Definition of capabilities with schemas, XML tags, and handlers
2. **Tool System**: Orchestrates multiple tools and manages their lifecycles
3. **XML Parser**: Processes streaming XML content to extract structured data
4. **Validators**: Ensures data conforms to the expected schemas

### Data Flow

1. LLM generates XML content that is streamed in chunks
2. Chunks are buffered until complete tool tags are found
3. Complete tags are parsed and validated against schemas
4. Validated data is passed to tool handlers
5. Results are made available through the tool system

## Recent Improvements

### XML Parsing Enhancements

We improved the XML parsing logic to properly handle nested structures:

1. **Root Tag Prioritization**: The parser now specifically looks for root-level tags first (`code-snippet`, `data-analysis`, etc.) rather than processing all tags indiscriminately.

2. **Nested Content Processing**: Enhanced the recursive processing of nested content to handle arrays and complex nested structures.

3. **Improved Validation**: Better error handling and validation of XML against Zod schemas.

4. **Comprehensive Logging**: Added detailed logging throughout the parsing process to aid in debugging.

### Implementation Details

```typescript
function findCompleteTags(xml: string): Array<{ tag: string; content: string }> {
  // Look for root-level tags that match expected tool tags
  const rootTagRegex = /<(code-snippet|data-analysis)>([\s\S]*?)<\/\1>/g;
  let match;
  const result = [];
  
  while ((match = rootTagRegex.exec(xml)) !== null) {
    result.push({
      tag: match[1],
      content: match[2],
    });
  }

  // Fallback to generic tag search if needed
  if (result.length === 0) {
    const tagRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
    while ((match = tagRegex.exec(xml)) !== null) {
      if (["code-snippet", "data-analysis"].includes(match[1])) {
        result.push({
          tag: match[1],
          content: match[2],
        });
      }
    }
  }

  return result;
}
```

## Future Architecture Directions

### Declarative Tools API

We've discussed moving toward a more declarative API that better separates concerns:

```typescript
// Tools only define their structure, not behavior
const weatherTool = defineTool({
  id: "weather",
  name: "Weather Tool",
  xmlTag: "weather_forecast",
  schema: z.object({
    location: z.string(),
    temperature: z.number(),
    conditions: z.string()
  })
});

// Create system with tool definitions
const system = createToolSystem([weatherTool, newsTool]);

// Register handlers separately
system.onToolComplete("weather", (data) => {
  updateWeatherWidget(data.location, data.temperature, data.conditions);
});
```

### Benefits of Declarative Approach

1. **Separation of Concerns**:
   - Tools define structure (schema and XML tags)
   - System handles parsing and callbacks
   - Handlers define behavior

2. **Simplified API Surface**:
   - Clear, focused responsibilities
   - Easier to understand and use
   - More maintainable

3. **Testability**:
   - Tools can be tested in isolation
   - Handlers can be tested with mock data
   - System can be tested with mock tools

## Hierarchical Streaming (Future Consideration)

We've explored the concept of hierarchical streaming for more advanced use cases:

### Concept

Enable incremental processing of nested content within tools, allowing:
- Processing of partial tool responses
- UI updates as parts of a response arrive
- Delegation to specialized subtools

### Potential Approaches

#### 1. Subtool Registration

```typescript
const fileTool = createSubtool({
  id: "file",
  xmlPath: "file", // The XML tag this subtool handles
  schema: fileSchema,
});

const projectTool = createTool({
  id: "project",
  xmlTag: "project",
  schema: projectSchema,
  subtools: [fileTool], // Declaratively register subtools
});
```

#### 2. Path-Based Callbacks

```typescript
system
  .onPath("code-generator.project.files.file", (data, context) => {
    // Called for each file as it's parsed
    updateFileInEditor(data.path, data.content);
  });
```

#### 3. Context Propagation

```typescript
system
  .provideContext("project", (data) => {
    // Context passed to child handlers
    return {
      projectName: data.name,
      projectType: data.language
    };
  });
```

## Implementation Considerations

### Streaming Parser Architecture

To support hierarchical streaming, we would need:

1. **Incremental Parsing**: Parse XML as it arrives rather than waiting for complete tags
2. **Path Tracking**: Maintain awareness of the current position in the XML hierarchy
3. **Partial State**: Store and update partial objects as they're built
4. **Callback Resolution**: Match XML paths to registered callbacks

### Balancing Complexity

A key challenge is maintaining a simple API for common cases while supporting advanced streaming for those who need it:

1. **Default Simplicity**: Most users should be able to work with complete tools
2. **Progressive Complexity**: Advanced features should be opt-in
3. **Composition**: Build complex behavior from simple primitives

## Next Steps

1. **Refactor Current Implementation**: Move to the declarative tools API
2. **Improve Testing**: Add comprehensive tests for complex nested structures
3. **Documentation**: Update documentation to reflect new patterns
4. **Explore Hierarchical Streaming**: Prototype simple implementation to evaluate complexity

## Conclusion

The typed-llm-stream library has evolved to better handle complex nested XML structures. Future work will focus on simplifying the API through a more declarative approach, with potential expansion to support hierarchical streaming for advanced use cases.