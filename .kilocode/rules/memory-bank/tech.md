# Technology Stack

## Core Technologies
- **TypeScript**: Primary programming language (strict mode enabled)
- **Node.js**: v20.18.1 (specified in .nvmrc)
- **VSCode Extension API**: ^1.84.0 minimum version
- **Monorepo**: pnpm workspaces + Turborepo for build orchestration

## AI Provider Integrations
- **Anthropic SDK** (@anthropic-ai/sdk): Claude models integration
- **OpenAI SDK** (openai): GPT models integration
- **Google Generative AI** (@google/genai): Gemini models integration
- **Mistral AI** (@mistralai/mistralai): Mistral models integration
- **AWS Bedrock** (@aws-sdk/client-bedrock-runtime): AWS AI models
- **Vertex AI** (@anthropic-ai/vertex-sdk): Google Cloud AI platform
- **Local Models**: Ollama, LMStudio support

## Core Libraries

### Code Analysis & Parsing
- **Tree-sitter** (web-tree-sitter): Multi-language code parsing
- **Tree-sitter WASM parsers**: Support for 30+ programming languages
- **Ripgrep**: Fast file searching via external binary

### UI & Frontend
- **React**: Webview UI framework
- **Vite**: Frontend build tool
- **Monaco Editor**: Code editor component

### Browser Automation
- **Puppeteer Core**: Headless browser automation

## Development Tools

### Build & Bundle
- **esbuild**: Fast TypeScript/JavaScript bundler
- **Turborepo**: Monorepo build system
- **pnpm**: v10.8.1 package manager (IMPORTANT: Always use pnpm, never npm)

### Testing
- **Jest**: Unit testing framework
- **Vitest**: Modern test runner
- **Testing Library**: React component testing

### Running Tests
- **All Tests**: `pnpm test` - Runs all tests across the monorepo
- **Specific Package**: `pnpm test --filter=<package-name>` - Runs tests for a specific package
- **Individual Test File**: `pnpm test -- <path-to-test-file>` - Runs a specific test file
- **Watch Mode**: `pnpm test -- --watch` - Runs tests in watch mode
- **Coverage**: `pnpm test -- --coverage` - Runs tests with coverage reporting

## Development Requirements
- **Node.js**: v20.18.1 (exact version via .nvmrc)
- **pnpm**: v10.8.1 (enforced via preinstall script) - NEVER use npm for this project
- **VSCode**: Latest stable version
- **Git**: For version control
- **Operating System**: Cross-platform (Windows, macOS, Linux)

## Common Development Commands
- **Install Dependencies**: `pnpm install`
- **Build Project**: `pnpm build`
- **Dev Mode**: `pnpm dev`
- **Lint Code**: `pnpm lint`
- **Format Code**: `pnpm format`