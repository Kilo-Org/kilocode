# Continue: Autocomplete & NextEdit Library

A focused TypeScript library extracted from [Continue](https://github.com/continuedev/continue) containing only the AI-powered autocomplete and NextEdit features. This library is integrated into the [Kilocode](https://github.com/kilocode/kilocode) monorepo as a service component.

## Overview

This library provides two core features from the Continue project:

- **Autocomplete**: Intelligent, context-aware code completion powered by LLMs
- **NextEdit**: Multi-location code edit predictions that understand your editing patterns

All other Continue functionality (GUI, chat, agents, tools, etc.) has been removed to create a focused, reusable codebase.

## Integration Context

This library is part of the **Kilocode monorepo** at `src/services/continuedev/`. It contains pure TypeScript source code without independent build configuration:

- **No package.json** - Dependencies managed by Kilocode's pnpm workspace
- **No build config** - Uses Kilocode's TypeScript and build tooling
- **Testing** - Integrated into Kilocode's vitest test suite
- **Purpose** - Provides autocomplete and edit prediction capabilities to Kilocode

For integration details, see [`INTEGRATION.md`](INTEGRATION.md).

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

### 🔧 Supporting Infrastructure

- **Multiple LLM providers**: OpenAI, Anthropic, Gemini, Azure, Bedrock, and more
- **Tree-sitter integration**: Accurate syntax-aware code analysis for multiple languages
- **Comprehensive testing**: 857 tests covering autocomplete, NextEdit, and integrations
- **TypeScript**: Full type safety and IntelliSense support

## Library Structure

```
src/services/continuedev/
├── core/                      # All autocomplete & NextEdit code
│   ├── autocomplete/          # Autocomplete feature
│   │   ├── CompletionProvider.ts
│   │   ├── MinimalConfig.ts
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
│   │   └── openai-adapters/  # OpenAI-compatible adapters
│   ├── diff/                 # Myers diff algorithm
│   ├── util/                 # Shared utilities
│   ├── indexing/             # Security checks & ignore patterns
│   ├── fetch/                # HTTP client with cert support
│   └── vscode-test-harness/  # VSCode integration example
├── tree-sitter/              # Tree-sitter query files
├── legacy_code_rewrite/      # Historical extraction documentation
├── API_REFERENCE.md          # Complete API documentation
├── ARCHITECTURE.md           # Technical architecture
├── EXAMPLES.md               # Usage examples
├── INTEGRATION.md            # Integration with Kilocode
└── LICENSE                   # Apache 2.0 license
```

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

## Documentation

For detailed usage and API information:

- **[`API_REFERENCE.md`](API_REFERENCE.md)** - Complete API documentation with method signatures and parameters
- **[`EXAMPLES.md`](EXAMPLES.md)** - Practical code examples for common use cases
- **[`ARCHITECTURE.md`](ARCHITECTURE.md)** - Technical architecture and design decisions
- **[`INTEGRATION.md`](INTEGRATION.md)** - Integration with Kilocode monorepo

The VSCode test harness at [`core/vscode-test-harness/`](core/vscode-test-harness/) provides a complete working integration example with 86 tests.

## Current State

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

### Statistics

- **857 passing tests** (autocomplete, NextEdit, integrations, dependencies)
- **TypeScript compiles cleanly** (zero type errors)
- **~50,000 lines of code** (down from ~112,000 - 55% reduction)
- **Single test framework** (Vitest only, Jest removed)
- **Consolidated structure** (all code in `core/`, no separate packages)

## Testing

Tests for this library are integrated into Kilocode's test suite. See [`INTEGRATION.md`](INTEGRATION.md) for details on running tests within the Kilocode project.

The library includes comprehensive test coverage:

- **Autocomplete tests**: Context gathering, filtering, generation, templating, caching
- **NextEdit tests**: Edit prediction, diff calculation, template engines, history tracking
- **Diff tests**: Myers algorithm, streaming diffs, line matching
- **Integration tests**: VSCode test harness with real-world usage scenarios
- **Dependency tests**: LRU cache, tree-sitter parsing, security filtering

## Integration into Your IDE

To integrate this library into your own IDE:

1. Implement the [`IDE` interface](core/index.d.ts)
2. Create [`CompletionProvider`](core/autocomplete/CompletionProvider.ts) instance
3. Create [`NextEditProvider`](core/nextEdit/NextEditProvider.ts) instance (optional)
4. See [`core/vscode-test-harness/`](core/vscode-test-harness/) for a complete VSCode example

## License & Credits

This library is extracted from [Continue](https://github.com/continuedev/continue), an open-source AI code assistant.

**Original Project**: https://github.com/continuedev/continue  
**Original Authors**: Continue Dev, Inc  
**License**: Apache-2.0

### Attribution

The autocomplete and NextEdit functionality in this library was developed by the Continue team. This extraction preserves the original code structure and functionality while providing a minimal, reusable library.

Key contributors to the original Continue project:

- The Continue team and community
- See the original repository for full contributor list

### Changes in This Version

This version removes everything except autocomplete and NextEdit:

- ❌ **Removed**: GUI, chat interface, agents, tools, CLI, IntelliJ extension
- ❌ **Removed**: Documentation site, media files, deployment scripts
- ❌ **Removed**: Complex YAML config system (replaced with minimal config)
- ❌ **Removed**: Package monorepo structure (consolidated into single root)
- ✅ **Retained**: All autocomplete functionality with comprehensive test coverage
- ✅ **Retained**: NextEdit feature with full test coverage
- ✅ **Retained**: LLM integrations (OpenAI, Anthropic, Gemini, etc.)
- ✅ **Retained**: Tree-sitter parsing and context gathering

## Documentation

- **[`README.md`](README.md)** - This file - Overview and integration
- **[`INTEGRATION.md`](INTEGRATION.md)** - Integration with Kilocode monorepo
- **[`ARCHITECTURE.md`](ARCHITECTURE.md)** - Technical architecture details
- **[`API_REFERENCE.md`](API_REFERENCE.md)** - Complete API documentation
- **[`EXAMPLES.md`](EXAMPLES.md)** - Comprehensive usage examples
- **[`legacy_code_rewrite/`](legacy_code_rewrite/)** - Historical extraction documentation (49 files)

## Links

- **Kilocode Project**: https://github.com/kilocode/kilocode
- **Original Continue Project**: https://github.com/continuedev/continue
- **Continue Documentation**: https://docs.continue.dev
- **Continue Discord**: https://discord.gg/continue

## Support

For questions about this library:

- Check the [`ARCHITECTURE.md`](ARCHITECTURE.md) for technical details
- Review [`EXAMPLES.md`](EXAMPLES.md) for usage patterns
- Examine the test harness in [`core/vscode-test-harness/`](core/vscode-test-harness/)
- See [`INTEGRATION.md`](INTEGRATION.md) for Kilocode integration details

For questions about the original Continue project:

- Visit https://docs.continue.dev
- Join the Discord: https://discord.gg/continue
- Open an issue: https://github.com/continuedev/continue/issues
