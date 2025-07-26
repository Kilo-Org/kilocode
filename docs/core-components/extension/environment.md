# Environment Setup and Detection

The environment system provides comprehensive detection and configuration of the development
environment, including VS Code context, terminal state, file system information, and workspace
details. This system ensures the AI assistant has complete situational awareness of the current
development context.

## Location

`src/core/environment/`

## Core Components

### getEnvironmentDetails.ts

The main environment detection function that gathers comprehensive context information for the AI assistant.

**Key Function:**

```typescript
export async function getEnvironmentDetails(cline: Task, includeFileDetails: boolean = false): Promise<string>
```

### Environment Information Gathered

#### 1. VS Code Context

**Visible Files**: Currently visible files in VS Code editors

```typescript
const visibleFilePaths = vscode.window.visibleTextEditors
	?.map((editor) => editor.document?.uri?.fsPath)
	.filter(Boolean)
	.map((absolutePath) => path.relative(cline.cwd, absolutePath))
```

**Open Tabs**: All open tabs across tab groups

```typescript
const openTabPaths = vscode.window.tabGroups.all
	.flatMap((group) => group.tabs)
	.map((tab) => (tab.input as vscode.TabInputText)?.uri?.fsPath)
```

#### 2. Terminal State Management

**Active Terminals**: Currently running terminal processes

- Working directory information
- Original command executed
- Real-time output capture
- Process status monitoring

**Inactive Terminals**: Completed processes with output

- Command history
- Output from completed processes
- Process cleanup and queue management

**Terminal Output Processing**:

```typescript
// Wait for terminals to cool down
await pWaitFor(() => busyTerminals.every((t) => !TerminalRegistry.isProcessHot(t.id)), {
	interval: 100,
	timeout: 5_000,
})

// Compress output for context efficiency
newOutput = Terminal.compressTerminalOutput(newOutput, terminalOutputLineLimit)
```

#### 3. File System Context

**Recently Modified Files**: Files changed since last access

```typescript
const recentlyModifiedFiles = cline.fileContextTracker.getAndClearRecentlyModifiedFiles()
```

**Workspace Files**: Complete workspace file listing (when requested)

- Configurable file limits
- RooIgnore filtering
- Desktop protection (prevents permission popups)

#### 4. Temporal Context

**Current Time Information**:

```typescript
const now = new Date()
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
details += `Current time in ISO 8601 UTC format: ${now.toISOString()}`
details += `User time zone: ${timeZone}, UTC${timeZoneOffsetStr}`
```

#### 5. Cost and Usage Tracking

**API Metrics**:

```typescript
const { contextTokens, totalCost } = getApiMetrics(cline.clineMessages)
details += `Current Cost: ${totalCost !== null ? totalCost.toFixed(2) : "(Not available)"}`
```

#### 6. Mode and Configuration

**Current Mode Information**:

```typescript
const modeDetails = await getFullModeDetails(mode ?? defaultModeSlug, customModes, customModePrompts, {
	cwd: cline.cwd,
	globalCustomInstructions,
	language: language ?? formatLanguage(vscode.env.language),
})
```

### reminder.ts

Formats todo list reminders for the AI assistant to maintain task awareness.

**Key Function:**

```typescript
export function formatReminderSection(todoList?: TodoItem[]): string
```

**Features:**

- **Status tracking**: Pending, In Progress, Completed status
- **Markdown formatting**: Clean table format for readability
- **Progress guidance**: Instructions for updating todo status
- **Empty state handling**: Guidance when no todos exist

**Output Format**:

```markdown
====

REMINDERS

Below is your current list of reminders for this task. Keep them updated as you progress.

| #   | Content                       | Status      |
| --- | ----------------------------- | ----------- |
| 1   | Implement user authentication | In Progress |
| 2   | Add error handling            | Pending     |
| 3   | Write unit tests              | Completed   |

IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.
```

## Integration Points

### Task Integration

Environment details are automatically included in system prompts:

```typescript
// In Task.ts
const environmentDetails = await getEnvironmentDetails(this, includeFileDetails)
systemPrompt += environmentDetails
```

### Terminal Integration

Deep integration with terminal management:

- **Process monitoring**: Real-time tracking of terminal processes
- **Output capture**: Automatic capture of command output
- **State synchronization**: Coordination with file changes

### File System Integration

Comprehensive file system awareness:

- **Change tracking**: Monitors file modifications
- **Access control**: Respects RooIgnore and protection settings
- **Performance optimization**: Configurable limits and caching

### Configuration Integration

Respects user configuration settings:

- **Output limits**: Configurable terminal output line limits
- **File limits**: Maximum workspace files to include
- **Context limits**: Maximum open tabs to process

## Performance Optimizations

### Async Operations

```typescript
// Parallel processing of environment data
const [files, didHitLimit] = await listFiles(cline.cwd, true, maxFiles)
```

### Caching and Filtering

- **Path filtering**: Efficient filtering through RooIgnoreController
- **Output compression**: Terminal output compression for context efficiency
- **Selective inclusion**: Only include relevant information

### Resource Management

- **Terminal cooldown**: Wait for processes to complete before capturing output
- **File limits**: Prevent overwhelming context with too many files
- **Memory efficiency**: Clean up completed process queues

## Error Handling

### Permission Handling

```typescript
const isDesktop = arePathsEqual(cline.cwd, path.join(os.homedir(), "Desktop"))
if (isDesktop) {
	details += "(Desktop files not shown automatically. Use list_files to explore if needed.)"
}
```

### API Error Handling

```typescript
if (cline.api instanceof OpenRouterHandler) {
	try {
		await cline.api.fetchModel()
	} catch (e) {
		TelemetryService.instance.captureException(e, { context: "getEnvironmentDetails" })
		await cline.say("error", t("kilocode:notLoggedInError", { error: e.message }))
	}
}
```

### Graceful Degradation

- **Missing data**: Handles missing or inaccessible information gracefully
- **Timeout handling**: Prevents hanging on slow operations
- **Fallback values**: Provides defaults when data unavailable

## Configuration Options

### User-Configurable Settings

- `terminalOutputLineLimit`: Maximum lines of terminal output (default: 500)
- `maxWorkspaceFiles`: Maximum workspace files to include (default: 200)
- `maxOpenTabsContext`: Maximum open tabs to process (default: 20)
- `showRooIgnoredFiles`: Whether to show ignored files in listings

### Mode-Specific Behavior

Different modes can affect environment detection:

- **Development mode**: Full context including all files and terminals
- **Review mode**: Limited context focusing on changed files
- **Debug mode**: Enhanced terminal and error information

## Security Considerations

### Access Control

- **RooIgnore filtering**: Respects workspace ignore rules
- **Path validation**: Prevents access outside workspace boundaries
- **Permission checks**: Handles file system permissions gracefully

### Data Privacy

- **Sensitive data filtering**: Automatic filtering of sensitive information
- **Output sanitization**: Cleans terminal output of sensitive data
- **Audit logging**: Tracks environment data access

## Testing

### Mock Environment

Testing uses mock VS Code environment:

```typescript
const mockVscode = {
	window: {
		visibleTextEditors: mockEditors,
		tabGroups: mockTabGroups,
	},
}
```

### Test Coverage

- **Context gathering**: Verify all environment data is collected
- **Error scenarios**: Test handling of missing or inaccessible data
- **Performance**: Ensure environment detection doesn't block operations
- **Configuration**: Test various configuration combinations

## Future Enhancements

- **Smart context**: AI-driven selection of relevant environment information
- **Performance monitoring**: Real-time performance metrics for environment detection
- **Enhanced filtering**: More sophisticated filtering of environment data
- **Predictive context**: Anticipate needed environment information
- **Cross-platform optimization**: Platform-specific optimizations for environment detection
