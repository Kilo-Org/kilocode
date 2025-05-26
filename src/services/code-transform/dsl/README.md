# Code Transformation DSL

This module provides a domain-specific language (DSL) for defining code transformation operations in a structured, JSON-based format. The DSL enables precise specification of refactoring operations like renaming symbols and moving code between files.

> **IMPORTANT**: Always prefer symbol-based selectors (identifier or AST) over line-based selectors. Line numbers are brittle and can easily break when code changes. Symbol-based operations are more resilient to code changes and provide better refactoring results.

## Overview

The Code Transformation DSL allows you to:

- Define transformation operations with clear semantics
- Select code elements using different selection strategies (by location, identifier, or AST)
- Validate commands before execution
- Get detailed error messages when validation fails
- Use helper functions to create well-formed commands

## Supported Operations

Currently, the DSL supports the following operations:

### Rename

Renames symbols (variables, functions, classes, etc.) throughout their scope:

```json
{
  "schemaVersion": "1.0",
  "operation": "rename",
  "selector": {
    "type": "identifier",
    "name": "oldName",
    "filePath": "src/app.ts",
    "kind": "function"
  },
  "type": "rename",
  "newName": "newName",
  "acrossFiles": true
}
```

### Move

Moves code elements from one file to another:

```json
{
  "schemaVersion": "1.0",
  "operation": "move",
  "selector": {
    "type": "identifier",
    "name": "processUserData",
    "filePath": "src/app.ts",
    "kind": "function"
  },
  "type": "move",
  "targetFilePath": "src/utils.ts",
  "addExports": true,
  "addImports": true
}
```

> **Note**: Code will be placed at an appropriate position in the target file based on code structure. The system will find a valid insertion point that respects syntax and organization.

## Selector Types

The DSL supports three types of selectors to identify code elements:

### Identifier Selector

Selects code by identifier name:

```json
{
  "type": "identifier",
  "name": "functionName",
  "filePath": "path/to/file.ts",
  "kind": "function",
  "global": false
}
```

### AST Selector

Selects code by abstract syntax tree (AST) structure:

```json
{
  "type": "ast",
  "filePath": "path/to/file.ts",
  "nodeType": "ClassDeclaration",
  "constraints": {
    "properties": {
      "name": "MyClass"
    }
  }
}
```


```json
{
  "type": "ast",
  "filePath": "path/to/file.ts",
  "nodeType": "ClassDeclaration",
  "constraints": {
    "properties": {
      "name": "MyClass"
    },
    "position": {
      "startLine": 10,
      "endLine": 50
    }
  }
}
```

## Usage

### Parsing and Validating DSL Commands

Use the `parseDslCommand` function to parse and validate a JSON string containing a DSL command:

```typescript
import { parseDslCommand } from './services/code-transform/dsl';

try {
  const command = parseDslCommand(jsonString);
  // Command is now validated and ready to use
  console.log(`Operation: ${command.operation}`);
} catch (error) {
  console.error(`Validation failed: ${error.message}`);
}
```

### Creating Commands with Helper Functions

Helper functions make it easier to create well-formed commands:

```typescript
import { 
  createRenameCommand, 
  createMoveCommand 
} from './services/code-transform/dsl';

// Create a rename command
const renameCommand = createRenameCommand(
  { 
    type: 'identifier', 
    name: 'oldName',
    filePath: 'src/file.ts'
  },
  'newName',
  true // acrossFiles
);

// Create a move command
const moveCommand = createMoveCommand(
  {
    type: 'location',
    filePath: 'src/app.ts',
    startLine: 10,
    endLine: 20
  },
  'src/utils.ts', // targetFilePath
  0, // targetLine (0 means append)
  false, // insertBefore
  true // addExports
);
```

## Error Handling

The parser provides detailed error messages for different validation failures:

- JSON syntax errors
- Missing required fields
- Invalid field values
- Unsupported operations
- Incompatible selectors for operations

## Integration

To integrate the DSL with a transformation service:

```typescript
import { parseDslCommand } from './services/code-transform/dsl';
import { RenameOperation, MoveOperation } from './services/code-transform/dsl';

class TransformationService {
  executeCommand(input: string) {
    try {
      const command = parseDslCommand(input);
      
      switch (command.operation) {
        case 'rename':
          return this.executeRename(command.selector, command.operationDetails as RenameOperation);
        case 'move':
          return this.executeMove(command.selector, command.operationDetails as MoveOperation);
        default:
          throw new Error(`Unsupported operation: ${command.operation}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  // Implementation methods...
}
```

## Extending the DSL

To add new operations:

1. Add new types in `types.ts`
2. Update the parser schemas in `parser.ts`
3. Create helper functions in `index.ts`
4. Add example usage in `example-usage.ts`
5. Write tests for the new functionality