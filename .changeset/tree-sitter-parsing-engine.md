---
"kilo-code": major
---

Implement comprehensive Tree-sitter Based Parsing Engine with multi-language support and Odoo-specific optimizations.

## Features Added

### Core Parser Architecture

- **ParserService**: High-performance parsing service with multi-language support
- **SymbolExtractor Interface**: Base abstraction for language-specific extractors
- **BaseSymbolExtractor**: Common functionality for all language extractors
- **IncrementalParsingService**: Integration with file watcher for real-time parsing

### Language Support

- **PythonSymbolExtractor**: Full Python AST parsing with Odoo pattern detection
    - Class definitions with `_name`, `_inherit`, `_description` extraction
    - Function/method detection with `@api` decorator recognition
    - Import statement tracking
    - Inheritance relationship mapping
- **JavaScriptSymbolExtractor**: JS/TS parsing with class and method extraction
    - ES6 class syntax support
    - Function and arrow function detection
    - Import/export tracking
    - Inheritance chain analysis
- **XmlSymbolExtractor**: XML parsing with Odoo view definition support
    - Record tag detection with model attributes
    - XML attribute extraction
    - Parent-child element relationships
    - Odoo-specific record-to-model relationships
- **JsonSymbolExtractor**: JSON structure parsing for configuration files
    - Object and array structure extraction
    - Property type detection
    - External reference identification
    - Nested relationship mapping

### Odoo-Specific Optimizations

- **Model Detection**: Automatic识别 of Odoo models via `_name` and `_inherit`
- **API Decorator Recognition**: `@api` decorator extraction for method classification
- **View Record Linking**: XML record tags linked to Python model classes
- **Inheritance Chain Tracking**: Complete Odoo inheritance hierarchy analysis

### Database Integration

- **SQLite Storage**: Direct integration with existing DatabaseManager
- **Symbol Persistence**: Automatic upsert of symbols, relationships, and dependencies
- **Relationship Mapping**: CALLS, INHERITS, IMPORTS, REFERENCES relationships
- **Orphaned Record Cleanup**: Automatic cleanup of deleted file references

### Agent-Facing APIs

- **getSymbols(filePath)**: Returns flat list of symbols in a file
- **getScope(filePath, line)**: Returns current class/function context for cursor position
- **getDependencies(filePath)**: Returns imported modules and inherited classes
- **explainStructure(file)**: Simplified tree map for architectural reasoning

### Performance Features

- **Incremental Parsing**: Real-time parsing on file changes via file watcher integration
- **Parse Caching**: In-memory caching to avoid redundant parsing
- **Batch Processing**: Efficient handling of multiple file changes
- **Debounced Operations**: 500ms debounce to prevent excessive parsing
- **Async Operations**: Non-blocking parsing throughout

### Error Handling & Telemetry

- **Graceful Error Recovery**: Malformed code handling without indexer crashes
- **Comprehensive Logging**: Detailed parsing progress and error reporting
- **Telemetry Integration**: Performance metrics and error tracking
- **Type Safety**: Full TypeScript coverage with strict typing

## Architecture Integration

- **Tree-sitter Integration**: Uses existing web-tree-sitter WASM parsers
- **File Watcher Integration**: Seamless integration with existing FileWatcher events
- **Database Layer**: Direct integration with SQLite hybrid storage system
- **Service Factory**: Compatible with existing service factory pattern

## Language Coverage

- **Python**: Full AST parsing with Odoo extensions
- **JavaScript/TypeScript**: Modern JS/TS syntax support
- **XML**: Odoo view and record definition parsing
- **JSON**: Configuration and data structure parsing

## Breaking Changes

- New parser service dependencies added
- Enhanced database schema utilization
- Extended file watcher event handling
- Additional telemetry events for parsing operations
