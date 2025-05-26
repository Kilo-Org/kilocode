import { ToolArgs } from "./types"

// kilocode_change start
export function getRefactorCodeDescription(_args: ToolArgs): string {
	return `## refactor_code
Description: Request to perform batch code refactoring operations on TypeScript/JavaScript files using an AST-based approach. This tool provides automated refactoring capabilities for moving code between files and renaming symbols across all references.

IMPORTANT: This tool ONLY accepts batch operations. All operations must be provided as an array, even for single operations.

Parameters:
- operations: (required) A JSON string containing an array of refactoring operations.

Basic Structure:
[
  {
    "operation": <string>,       // Required: "move", "rename", or "remove"
    "selector": <object>,        // Required: Identifies the code to refactor
    // Additional fields depend on operation type
  },
  // ... more operations
]

Selector Format (REQUIRED for all operations):
{
  "type": "identifier",        // Always use "identifier" type
  "name": <string>,           // The name of the symbol (function, class, etc.)
  "kind": <string>,           // Optional: "function", "class", "variable", etc.
  "filePath": <string>        // The source file path
}

For "move" operations:
{
  "operation": "move",
  "selector": {
    "type": "identifier",
    "name": "MyClass",
    "kind": "class",
    "filePath": "src/main.ts"
  },
  "targetFilePath": "src/models/MyClass.ts"  // Required: destination file
}

For "rename" operations:
{
  "operation": "rename",
  "selector": {
    "type": "identifier",
    "name": "oldFunctionName",
    "kind": "function",
    "filePath": "src/utils.ts"
  },
  "newName": "newFunctionName"  // Required: new name for the symbol
}

For "remove" operations:
{
  "operation": "remove",
  "selector": {
    "type": "identifier",
    "name": "unusedFunction",
    "kind": "function",
    "filePath": "src/utils.ts"
  }
}

Usage:
<refactor_code>
<operations>
[
  {
    "operation": "move",
    "selector": {
      "type": "identifier",
      "name": "DataProcessor",
      "kind": "class",
      "filePath": "src/main.ts"
    },
    "targetFilePath": "src/processor.ts"
  }
]
</operations>
</refactor_code>

Examples:

1. Move multiple constants to a new file:
<refactor_code>
<operations>
[
  {
    "operation": "move",
    "selector": {
      "type": "identifier",
      "name": "API_URL",
      "kind": "variable",
      "filePath": "src/config.ts"
    },
    "targetFilePath": "src/constants.ts"
  },
  {
    "operation": "move",
    "selector": {
      "type": "identifier",
      "name": "MAX_RETRIES",
      "kind": "variable",
      "filePath": "src/config.ts"
    },
    "targetFilePath": "src/constants.ts"
  },
  {
    "operation": "move",
    "selector": {
      "type": "identifier",
      "name": "TIMEOUT_MS",
      "kind": "variable",
      "filePath": "src/config.ts"
    },
    "targetFilePath": "src/constants.ts"
  }
]
</operations>
</refactor_code>

2. Move a single class (still requires array format):
<refactor_code>
<operations>
[
  {
    "operation": "move",
    "selector": {
      "type": "identifier",
      "name": "UserProfile",
      "kind": "class",
      "filePath": "src/components/index.ts"
    },
    "targetFilePath": "src/components/UserProfile.ts"
  }
]
</operations>
</refactor_code>

3. Rename multiple functions:
<refactor_code>
<operations>
[
  {
    "operation": "rename",
    "selector": {
      "type": "identifier",
      "name": "getUserData",
      "kind": "function",
      "filePath": "src/api/users.ts"
    },
    "newName": "fetchUserData"
  },
  {
    "operation": "rename",
    "selector": {
      "type": "identifier",
      "name": "saveUserData",
      "kind": "function",
      "filePath": "src/api/users.ts"
    },
    "newName": "updateUserData"
  }
]
</operations>
</refactor_code>

4. Mixed operations (move and rename):
<refactor_code>
<operations>
[
  {
    "operation": "move",
    "selector": {
      "type": "identifier",
      "name": "formatDate",
      "kind": "function",
      "filePath": "src/utils/helpers.ts"
    },
    "targetFilePath": "src/utils/formatting.ts"
  },
  {
    "operation": "rename",
    "selector": {
      "type": "identifier",
      "name": "parseDate",
      "kind": "function",
      "filePath": "src/utils/helpers.ts"
    },
    "newName": "parseDateString"
  }
]
</operations>
</refactor_code>

5. Remove unused functions:
<refactor_code>
<operations>
[
  {
    "operation": "remove",
    "selector": {
      "type": "identifier",
      "name": "deprecatedFunction",
      "kind": "function",
      "filePath": "src/utils/helpers.ts"
    }
  },
  {
    "operation": "remove",
    "selector": {
      "type": "identifier",
      "name": "unusedHelper",
      "kind": "function",
      "filePath": "src/utils/helpers.ts"
    }
  }
]
</operations>
</refactor_code>

6. Move multiple classes from different files:
<refactor_code>
<operations>
[
  {
    "operation": "move",
    "selector": {
      "type": "identifier",
      "name": "BaseModel",
      "filePath": "src/models/index.ts"
    },
    "targetFilePath": "src/models/base.ts"
  },
  {
    "operation": "move",
    "selector": {
      "type": "identifier",
      "name": "UserModel",
      "filePath": "src/models/user.ts"
    },
    "targetFilePath": "src/models/entities/user.ts"
  },
  {
    "operation": "move",
    "selector": {
      "type": "identifier",
      "name": "ProductModel",
      "filePath": "src/models/product.ts"
    },
    "targetFilePath": "src/models/entities/product.ts"
  }
]
</operations>
</refactor_code>

Important Notes:
- ALL operations MUST be provided in an array, even single operations
- Each operation in the array is processed independently
- If any operation fails, the entire batch will be rolled back
- The tool will automatically handle imports/exports when moving code
- The tool uses AST analysis for precise, safe refactoring
- Line numbers are NOT supported - use symbol names instead
- Target files will be created if they don't exist for move operations`
}
// kilocode_change end