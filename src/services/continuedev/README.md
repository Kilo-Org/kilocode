# Continue: Autocomplete & NextEdit Only

A streamlined version of [Continue](https://github.com/continuedev/continue) containing only the AI-powered autocomplete and NextEdit features, with all other functionality removed.

## Overview

This repository contains only the autocomplete and NextEdit features from Continue, with all other functionality (GUI, chat, agents, tools, etc.) removed. It provides two core features:

- **Autocomplete**: Intelligent, context-aware code completion powered by LLMs
- **NextEdit**: Multi-location code edit predictions that understand your editing patterns

All GUI components, chat functionality, CLI tools, and other features have been removed to create a focused codebase for these two features only.

## Features

### 🎯 Autocomplete

- **Context-aware completions**: Analyzes surrounding code, imports, and recently edited files
- **Multi-line support**: Generates complete code blocks, not just single lines
- **Smart filtering**: Removes invalid completions using AST analysis and bracket matching
- **Caching**: LRU cache for improved performance
- **Debouncing**: Prevents excessive LLM calls during rapid typing
- **Tree-sitter integration**: Accurate syntax-aware code analysis

### ✨ NextEdit

- **Predictive edits**: Suggests edits across multiple locations based on your changes
- **Full-file and partial-file diffs**: Flexible edit region calculation
- **Multiple model support**: Built-in support for Instinct and MercuryCoder models
- **Visual feedback**: Jump navigation between edit regions
- **Cursor positioning**: Intelligent cursor placement after edits

### 🔧 Additional Features

- **Multiple LLM providers**: OpenAI, Anthropic, Gemini, Azure, Bedrock, and more
- **Tree-sitter integration**: Accurate syntax-aware code analysis for multiple languages
- **Comprehensive testing**: 778 tests covering autocomplete, NextEdit, and integrations
- **TypeScript**: Full type safety and IntelliSense support

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd continue

# Install dependencies
npm install

# Run tests to verify installation
npm test
```

## Current State

This repository now contains **only** the autocomplete and NextEdit features. All other Continue functionality has been removed:

### What's Included ✅

- **Autocomplete**: Full tab autocomplete with context gathering, filtering, and LLM generation
- **NextEdit**: Multi-location edit prediction with diff calculation
- **LLM Integrations**: OpenAI, Anthropic, Gemini, Azure, Bedrock, and 15+ other providers
- **Tree-sitter**: Multi-language syntax parsing for context extraction
- **Test Harness**: VSCode integration example with 86 integration tests
- **All Dependencies**: fetch, diff utilities, security checks, logging, analytics

### What's Removed ❌

- GUI/Webview interface
- Chat functionality
- Agent/tool system
- CLI extension
- IntelliJ extension
- Documentation site
- Media assets
- Deployment scripts
- Complex YAML configuration (replaced with minimal config)
- Package monorepo structure (consolidated to single root)

### Project Statistics

- **778 passing tests** (autocomplete, NextEdit, integrations, dependencies)
- **TypeScript compiles cleanly** (zero type errors)
- **~50,000 lines of code** (down from ~112,000 - 55% reduction)
- **Single test framework** (Vitest only, Jest removed)
- **Consolidated structure** (all code in `core/`, no separate packages)

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────┐
│         IDE Integration Layer           │
│  (VSCode, JetBrains, or Custom IDE)     │
└─────────────┬───────────────────────────┘
              │
              ├──────────────────┬─────────────────┐
              │                  │                 │
┌─────────────▼──────────┐  ┌───▼────────────┐  ┌▼─────────────┐
│  CompletionProvider    │  │ NextEditProvider│  │ MinimalConfig│
│  (Autocomplete)        │  │ (NextEdit)      │  │ Provider     │
└────────┬───────────────┘  └────┬───────────┘  └──────────────┘
         │                        │
         │  ┌─────────────────────┤
         │  │                     │
    ┌────▼──▼────┐          ┌────▼──────────┐
    │  LLM Layer │          │ Tree-sitter   │
    │  (OpenAI,  │          │ (AST parsing) │
    │   Ollama)  │          └───────────────┘
    └────────────┘
```

### Core Components

- **[`CompletionProvider`](core/autocomplete/CompletionProvider.ts)**: Main autocomplete engine
- **[`NextEditProvider`](core/nextEdit/NextEditProvider.ts)**: NextEdit prediction engine
- **[`MinimalConfigProvider`](core/autocomplete/MinimalConfig.ts)**: Configuration management
- **IDE Interface**: Abstraction for editor integration
- **ILLM Interface**: Abstraction for LLM providers

### Repository Structure

```
continue/
├── core/                      # All autocomplete & NextEdit code
│   ├── autocomplete/          # Autocomplete feature
│   │   ├── CompletionProvider.ts
│   │   ├── MinimalConfig.ts
│   │   ├── classification/    # Multiline detection
│   │   ├── context/          # Context gathering (tree-sitter based)
│   │   ├── filtering/        # Bracket matching, stream transforms
│   │   ├── generation/       # LLM completion streaming
│   │   ├── postprocessing/   # Clean up completions
│   │   ├── snippets/         # Code snippet retrieval
│   │   └── templating/       # Prompt construction
│   ├── nextEdit/             # NextEdit feature
│   │   ├── NextEditProvider.ts
│   │   ├── providers/        # Model-specific providers
│   │   ├── context/          # Edit aggregation & context
│   │   ├── diff/             # Diff calculation
│   │   └── templating/       # NextEdit prompt engines
│   ├── llm/                  # LLM integration
│   │   ├── llms/             # Provider implementations
│   │   ├── openai-adapters/  # OpenAI-compatible adapters
│   │   └── model-info/       # Model metadata
│   ├── diff/                 # Myers diff algorithm
│   ├── util/                 # Shared utilities
│   ├── indexing/             # Security checks & ignore patterns
│   ├── fetch/                # HTTP client with cert support
│   └── vscode-test-harness/  # VSCode integration tests
├── tree-sitter/              # Tree-sitter query files
├── legacy_code_rewrite/      # Cleanup documentation
├── package.json              # Root package configuration
└── knip.json                 # Dead code analysis config
```

## API Reference

For detailed API documentation, see [`API_REFERENCE.md`](API_REFERENCE.md).

Quick reference for main exports:

### Autocomplete

- [`CompletionProvider`](core/autocomplete/CompletionProvider.ts) - Main autocomplete class
- [`MinimalConfigProvider`](core/autocomplete/MinimalConfig.ts) - Configuration provider
- Types: `AutocompleteInput`, `AutocompleteOutcome`, `TabAutocompleteOptions`

### NextEdit

- [`NextEditProvider`](core/nextEdit/NextEditProvider.ts) - Main NextEdit class
- [`NextEditProviderFactory`](core/nextEdit/NextEditProviderFactory.ts) - Creates model-specific providers
- Types: `NextEditOutcome`, `ModelSpecificContext`, `EditableRegion`

### Core Interfaces

- [`IDE`](core/index.d.ts) - Interface for IDE integration
- [`ILLM`](core/index.d.ts) - Interface for LLM providers
- [`Position`, `Range`, `RangeInFile`](core/index.d.ts) - Common types

## Integration

## Quick Start Examples

### Basic Autocomplete Usage

```typescript
import { CompletionProvider } from "./core/autocomplete/CompletionProvider";
import { MinimalConfigProvider } from "./core/autocomplete/MinimalConfig";
import { IDE, ILLM } from "./core/index.d";
import { OpenAI } from "./core/llm/llms/OpenAI";

// 1. Create minimal configuration
const configProvider = new MinimalConfigProvider({
  tabAutocompleteOptions: {
    debounceDelay: 150,
    maxPromptTokens: 1024,
  },
});

// 2. Implement IDE interface (see core/vscode-test-harness/src/VsCodeIde.ts for full example)
const ide: IDE = {
  readFile: async (filepath) => {
    /* read file */
  },
  getWorkspaceDirs: async () => ["/path/to/workspace"],
  // ... other required methods
};

// 3. Create LLM provider function
const getLlm = async (): Promise<ILLM> => {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    model: "gpt-4",
  });
};

// 4. Create completion provider
const completionProvider = new CompletionProvider(
  configProvider,
  ide,
  getLlm,
  (error) => console.error("Autocomplete error:", error),
);

// 5. Request completion
const outcome = await completionProvider.provideInlineCompletionItems(
  {
    filepath: "/path/to/file.ts",
    pos: { line: 10, character: 5 },
    completionId: "unique-id",
  },
  abortSignal,
);

if (outcome) {
  console.log("Completion:", outcome.completion);

  // Mark as displayed
  completionProvider.markDisplayed("unique-id", outcome);

  // On user acceptance
  completionProvider.accept("unique-id");
}
```

### Basic NextEdit Usage

```typescript
import { NextEditProvider } from "./core/nextEdit/NextEditProvider";

// Create NextEdit provider (uses same config and IDE as autocomplete)
const nextEditProvider = NextEditProvider.getInstance(
  configProvider,
  ide,
  getLlm,
  (error) => console.error("NextEdit error:", error),
);

// Request next edit prediction
const outcome = await nextEditProvider.getNextEditPrediction({
  filepath: "/path/to/file.ts",
  pos: { line: 15, character: 0 },
  fileContents: currentFileContents,
  // ... other context
});

if (outcome) {
  console.log("Predicted edits:", outcome.diffLines);
  console.log("Regions to edit:", outcome.editableRegions);
  console.log("New cursor position:", outcome.finalCursorPosition);
}
```

### More Examples

For complete examples and API documentation, see:

- [`EXAMPLES.md`](EXAMPLES.md) - Comprehensive usage examples
- [`API_REFERENCE.md`](API_REFERENCE.md) - Detailed API documentation
- [`core/vscode-test-harness/`](core/vscode-test-harness/) - Full VSCode integration

The VSCode test harness provides a complete working example:

- [`VsCodeIde.ts`](core/vscode-test-harness/src/VsCodeIde.ts) - IDE interface implementation
- [`completionProvider.ts`](core/vscode-test-harness/src/autocomplete/completionProvider.ts) - Autocomplete integration
- [`NextEditWindowManager.ts`](core/vscode-test-harness/src/activation/NextEditWindowManager.ts) - NextEdit UI
- 86 integration tests in [`test/`](core/vscode-test-harness/test/)

## Testing

### Running Tests

```bash
# Run all tests (778 tests)
npm test

# Watch mode
npm run test:watch

# Type checking
npm run typecheck

# Type checking in watch mode
npm run tsc:watch
```

### Test Coverage

The repository includes **778 passing tests** across:

- **Autocomplete tests**: Context gathering, filtering, generation, templating, caching
- **NextEdit tests**: Edit prediction, diff calculation, template engines, history tracking
- **Diff tests**: Myers algorithm, streaming diffs, line matching
- **Integration tests**: VSCode test harness with real-world usage scenarios
- **Dependency tests**: LRU cache, tree-sitter parsing, security filtering

## Development

### Type Checking

```bash
npm run typecheck
npm run tsc:watch  # Watch mode
```

### Linting

```bash
npm run lint
npm run lint:fix
```

### Formatting

```bash
npm run format        # Format all files
npm run format:check  # Check formatting only
```

### Contributing

This is a streamlined version of Continue containing only autocomplete and NextEdit. To contribute:

1. Ensure all tests pass: `npm test`
2. Add tests for new features
3. Follow existing code style and TypeScript patterns
4. Update documentation as needed

## License & Credits

This library is extracted from [Continue](https://github.com/continuedev/continue), an open-source AI code assistant.

**Original Project**: https://github.com/continuedev/continue  
**Original Authors**: Continue Dev, Inc  
**License**: Apache-2.0

### Attribution

The autocomplete and NextEdit functionality in this library was developed by the Continue team. This extraction preserves the original code structure and functionality while providing a minimal, reusable package.

Key contributors to the original Continue project:

- The Continue team and community
- See the original repository for full contributor list

### Changes in This Version

This version removes everything except autocomplete and NextEdit:

- ❌ **Removed**: GUI, chat interface, agents, tools, CLI, IntelliJ extension
- ❌ **Removed**: Documentation site, media files, deployment scripts
- ❌ **Removed**: Complex YAML config system (replaced with minimal config)
- ❌ **Removed**: Package monorepo structure (consolidated into single root)
- ✅ **Retained**: All autocomplete functionality with 778 passing tests
- ✅ **Retained**: NextEdit feature with full test coverage
- ✅ **Retained**: LLM integrations (OpenAI, Anthropic, Gemini, etc.)
- ✅ **Retained**: Tree-sitter parsing and context gathering

## Links

- **Original Continue Project**: https://github.com/continuedev/continue
- **Continue Documentation**: https://docs.continue.dev
- **Continue Discord**: https://discord.gg/continue
- **Architecture Documentation**: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **API Reference**: [`API_REFERENCE.md`](API_REFERENCE.md)
- **Examples**: [`EXAMPLES.md`](EXAMPLES.md)

## Support

For questions about this extraction:

- Check the [`ARCHITECTURE.md`](ARCHITECTURE.md) for technical details
- Review [`EXAMPLES.md`](EXAMPLES.md) for usage patterns
- Examine the test harness in [`core/vscode-test-harness/`](core/vscode-test-harness/)

For questions about the original Continue project:

- Visit https://docs.continue.dev
- Join the Discord: https://discord.gg/continue
- Open an issue: https://github.com/continuedev/continue/issues
