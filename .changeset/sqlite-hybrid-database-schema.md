---
"kilo-code": major
---

Implement comprehensive SQLite-based hybrid database schema for codebase indexing with vector support, symbol relationships, and Odoo-specific optimizations.

## Features Added

### Database Schema

- **SQLite database** with WAL mode for concurrent performance
- **Files table**: Track file paths, content hashes, and metadata
- **Symbols table**: Store AST-parsed symbols with parent-child hierarchies
- **Relationships table**: Map code dependencies (CALLS, INHERITS, IMPORTS, REFERENCES)
- **Code chunks table**: Store code snippets with 1536-dimensional vector embeddings

### Core Components

- **DatabaseManager**: Handles all database operations with proper indexing
- **SQLiteVectorStore**: Vector store implementation compatible with existing IVectorStore interface
- **CodebaseContextAPI**: Agent-facing API with methods like getSymbolContext, findImpactedFiles, searchVectorContext
- **HybridIndexServiceFactory**: Integrates SQLite storage with existing indexing system

### Odoo Optimizations

- Special metadata fields for `_name`, `_inherit`, `_description`
- Odoo model inheritance chain tracking
- Abstract and transient model detection

### Performance Features

- WAL mode for concurrent read/write operations
- Comprehensive database indexing on name, path, and relationship columns
- Async/non-blocking operations throughout
- Orphaned record cleanup with cascade deletes

### Agent Tools Integration

- Symbol context with inheritance chains
- Impact analysis for code changes
- Semantic vector search capabilities
- Codebase statistics and health monitoring

## Database Location

- Workspace-local SQLite databases in `.kilocode-index/` directory
- Automatic database initialization and migration handling
- Proper cleanup and optimization utilities

## Breaking Changes

- New SQLite dependencies added (sqlite3, sqlite)
- Enhanced indexing capabilities require database initialization
- Vector embeddings stored as BLOB for optimal performance
