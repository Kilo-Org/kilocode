# typed-llm-stream

A TypeScript library for building type-safe, composable LLM tool systems with streaming XML response parsing. Perfect for creating structured AI interactions with full type safety and real-time processing.

## Key Features

- 🛠️ **Tool-based architecture**: Define LLM tools with schema, prompt generation, and response handling
- 🔧 **Fully composable**: Mix and match any tools for different LLM use cases  
- ⚡ **Type-safe**: End-to-end TypeScript + Zod validation for LLM responses
- 📡 **Streaming**: Real-time XML response parsing as chunks arrive from LLMs
- 🧪 **Testable**: Each component can be tested in isolation
- 🤖 **LLM-optimized**: Built specifically for Large Language Model interactions

The library handles all the generic aspects (XML parsing, tool orchestration, prompt composition) while allowing you to focus on defining your specific LLM tools.

## Installation

```bash
npm install @roo-code/typed-llm-stream
```

Or if installing from source:

```bash
npm install sax zod
npm install --save-dev @types/sax
```

## Basic Usage

```typescript
import { LLMToolSystem, BaseLLMTool, z } from '@roo-code/typed-llm-stream';

// Define a simple tool
class GreetingTool extends BaseLLMTool {
  constructor() {
    super({
      id: 'greeting',
      name: 'Greeting Generator', 
      description: 'Generates personalized greetings',
      schema: z.object({
        name: z.string(),
        style: z.enum(['formal', 'casual', 'friendly']),
        message: z.string()
      }),
      xmlTag: 'greeting'
    });
  }

  generatePromptSection(context) {
    return this.buildXMLPromptSection(
      'GREETING - Generate a personalized greeting',
      '<greeting><name>person_name</name><style>formal|casual|friendly</style><message>greeting_text</message></greeting>',
      ['Generate appropriate greetings based on context', 'Consider the relationship and setting'],
      1
    );
  }

  async handleResponse(data, context) {
    console.log(`Generated greeting: ${data.message} (${data.style} style for ${data.name})`);
  }
}

// Use the tool system
const toolSystem = new LLMToolSystem({
  tools: [new GreetingTool()],
  globalContext: { user: 'developer' }
});

const systemPrompt = toolSystem.generateSystemPrompt();
console.log(systemPrompt);

// Process AI response
const response = '<greeting><name>Alice</name><style>friendly</style><message>Hey Alice, hope you\'re doing well!</message></greeting>';
const results = await toolSystem.processCompleteResponse(response);
```

## Documentation

For more detailed documentation, examples, and advanced usage, see the [examples](./src/examples) directory.

## License

MIT