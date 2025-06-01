# System Architecture

## Overall Architecture
Kilo Code is structured as a monorepo-based VSCode extension using pnpm workspaces and Turborepo. The architecture follows a modular design with clear separation of concerns between the core extension, webview UI, and various services.

## Key Components

### Core Extension (`src/`)
- **Extension Entry Point**: Manages activation and initialization
- **Core Modules**: Message handling, context management, diff processing, tool implementations

### API Layer (`src/api/`)
- **Provider System**: Extensible architecture supporting 25+ AI providers
  - Anthropic (Claude), OpenAI, Google (Gemini), Mistral, DeepSeek
  - Local providers: Ollama, LMStudio
  - Cloud providers: Bedrock, Vertex AI, Fireworks
  - Router providers: OpenRouter, LiteLLM
- **Transform Layer**: Handles format conversions between different AI model APIs

### Services (`src/services/`)
- **Browser Automation**: Puppeteer integration for web tasks
- **Code Analysis**: Tree-sitter based parsing for 30+ languages
- **Search**: Ripgrep integration for fast file searching
- **MCP (Model Context Protocol)**: Server management and hub
- **Checkpoints**: Shadow checkpoint system for safe code modifications

### Webview UI (`webview-ui/`)
- React-based frontend for the extension interface

### Integration Layer (`src/integrations/`)
- **Editor Integration**: Decoration controller, diff viewer
- **Terminal Integration**: Command execution and monitoring
- **File System**: Safe file operations with checkpoint support

## Design Patterns
- **Provider Pattern**: Base provider classes with specialized extensions
- **Command Pattern**: VSCode command registration and handling
- **Observer Pattern**: File system watching, terminal output monitoring
- **Factory Pattern**: Dynamic tool creation based on mode
- **Strategy Pattern**: Multiple caching strategies for different use cases

## Integration Points
- **VSCode APIs**: Extension API, Language Server Protocol, Webview API
- **External Services**: AI provider APIs, MCP servers, Browser automation
- **File System**: Safe file operations with checkpoint support

## Critical Implementation Paths
- **Task Execution Pipeline**: Context gathering, mode-specific processing, tool execution
- **Memory Bank System**: Automatic file discovery, context injection, persistence across sessions
- **Safety Mechanisms**: Shadow checkpoint system, file restriction enforcement per mode