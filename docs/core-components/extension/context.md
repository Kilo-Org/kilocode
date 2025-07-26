# Context Management

The context management system handles workspace-specific rules, workflows, and instructions that guide the AI
assistant's behavior. This system provides dynamic configuration based on project context and user-defined rules.

## Location

`src/core/context/`

## Core Components

### Instructions System

Located in `src/core/context/instructions/`, this subsystem manages rule-based instructions and workflows.

#### workflows.ts

Manages workflow-specific rules and toggles for both global and workspace-local contexts.

**Key Functions:**

- `refreshWorkflowToggles(context, workingDirectory)`: Synchronizes workflow toggles
- `refreshLocalWorkflowToggles()`: Updates workspace-specific workflow rules
- `refreshGlobalWorkflowToggles()`: Updates global workflow rules

**Features:**

- **Dual-scope management**: Handles both global and workspace-local workflows
- **Toggle synchronization**: Keeps rule toggles in sync with file system
- **Dynamic loading**: Automatically discovers and loads workflow files

#### kilo-rules.ts

Manages Kilo-specific rules and rule toggles for customizing assistant behavior.

**Key Functions:**

- `ensureLocalKilorulesDirExists()`: Creates local rules directory structure
- Rule toggle management and synchronization

#### rule-helpers.ts

Provides utility functions for rule management and synchronization.

**Key Functions:**

- `synchronizeRuleToggles(rulesDir, currentToggles)`: Syncs rule states with filesystem

## Context Tracking

### FileContextTracker

Tracks file access patterns and context usage for optimization and analytics.

**Location**: `src/core/context-tracking/FileContextTracker.ts`

**Key Features:**

- **Access tracking**: Records when files are read or modified
- **Context optimization**: Helps optimize context window usage
- **Analytics**: Provides insights into file usage patterns

#### Types

```typescript
interface FileContextTrackerTypes {
	RecordSource: "read_tool" | "write_tool" | "search_tool" | "manual"
	// ... other tracking types
}
```

## Workflow Management

### Workflow Structure

Workflows are organized in a hierarchical structure:

```bash
.kilo/workflows/          # Local workspace workflows
~/workflows/              # Global user workflows
```

### Workflow Toggles

Each workflow can be enabled/disabled through toggles:

```typescript
interface ClineRulesToggles {
	[workflowName: string]: boolean
}
```

### Toggle Synchronization

The system automatically synchronizes toggles with the filesystem:

1. **Discovery**: Scans workflow directories for available workflows
2. **Comparison**: Compares current toggles with discovered workflows
3. **Update**: Adds new workflows and removes deleted ones
4. **Persistence**: Saves updated toggles to appropriate storage

## Rule System

### Rule Types

- **Global Rules**: Apply across all workspaces
- **Local Rules**: Specific to current workspace
- **Workflow Rules**: Part of specific workflows

### Rule Loading

Rules are loaded dynamically based on:

- Current workspace context
- Active workflow toggles
- Global rule settings

### Rule Application

Rules are applied in order of precedence:

1. Local workspace rules (highest priority)
2. Active workflow rules
3. Global rules (lowest priority)

## Integration Points

### Task Integration

Context management integrates with the Task system:

```typescript
// In Task.ts
const { globalWorkflowToggles, localWorkflowToggles } = await refreshWorkflowToggles(context, workingDirectory)
```

### Configuration Integration

Works with the configuration system to persist rule states:

```typescript
// Global workflow toggles stored in global state
await proxy.updateGlobalState("globalWorkflowToggles", updatedToggles)

// Local workflow toggles stored in workspace state
await proxy.updateWorkspaceState(context, "localWorkflowToggles", updatedToggles)
```

### Webview Integration

Rule toggles are exposed to the webview for user control:

- Toggle switches for enabling/disabling workflows
- Real-time updates when rules change
- Visual indicators for active rules

## File System Integration

### Directory Structure

The system expects specific directory structures:

```
workspace/
├── .kilo/
│   ├── workflows/
│   │   ├── workflow1.md
│   │   └── workflow2.md
│   └── rules/
│       ├── rule1.md
│       └── rule2.md
└── ...
```

### File Watching

The system can watch for changes to rule files and automatically reload them.

### Automatic Creation

Missing directories are automatically created when needed:

```typescript
await ensureLocalKilorulesDirExists(workingDirectory)
```

## Error Handling

### Missing Directories

Graceful handling when workflow/rule directories don't exist:

- Automatic directory creation
- Fallback to empty rule sets
- User notification of missing configurations

### Invalid Rules

Handling of malformed or invalid rule files:

- Validation of rule syntax
- Error reporting to user
- Fallback to default behavior

### Permission Issues

Handling of file system permission problems:

- Graceful degradation
- User notification
- Fallback to read-only mode

## Performance Considerations

### Caching

- **Rule caching**: Parsed rules cached in memory
- **Toggle caching**: Toggle states cached to avoid repeated file system access
- **Lazy loading**: Rules loaded only when needed

### Optimization

- **Batch operations**: Multiple rule updates batched together
- **Incremental updates**: Only changed rules are reprocessed
- **Background loading**: Non-blocking rule loading where possible

## Security Considerations

### File Access

- **Sandboxing**: Rules limited to workspace boundaries
- **Validation**: Rule content validated before execution
- **Permission checks**: File system access properly validated

### Rule Execution

- **Safe evaluation**: Rules executed in controlled environment
- **Resource limits**: Prevent resource exhaustion from complex rules
- **Error isolation**: Rule errors don't crash the extension

## Testing

### Mock File System

Testing uses mock file system for rule management:

```typescript
const mockFs = {
	readdir: jest.fn(),
	readFile: jest.fn(),
	writeFile: jest.fn(),
}
```

### Rule Validation

Tests cover:

- Rule parsing and validation
- Toggle synchronization
- Error handling scenarios
- Performance edge cases

## Future Enhancements

- **Rule templates**: Pre-defined rule templates for common scenarios
- **Rule sharing**: Ability to share rules between workspaces
- **Advanced conditions**: More sophisticated rule condition evaluation
- **Performance monitoring**: Metrics for rule execution performance
- **Visual rule editor**: GUI for creating and editing rules
