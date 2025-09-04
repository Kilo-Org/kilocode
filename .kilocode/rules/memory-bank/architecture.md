# System Architecture

## Overall Architecture

Kilo Code is structured as a monorepo-based VSCode extension using pnpm workspaces and Turborepo. The JetBrains plugin acts as a wrapper around the VSCode extension, communicating via RPC over socket connections.

## Key Components

- **Core Extension** (`src/`): Extension entry point, message handling, tool implementations
- **API Layer** (`src/api/`): 25+ AI providers with format transformation layer
- **Services** (`src/services/`): Browser automation, code analysis, MCP servers, checkpoints
- **Commit Message Service** (`src/services/commit-message/`): Git integration and AI-powered commit generation
- **Webview UI** (`webview-ui/`): React-based frontend
- **Integration Layer** (`src/integrations/`): Editor, terminal, file system integration
- **JetBrains Plugin** (`jetbrains/plugin/`): Kotlin-based wrapper with RPC communication

## Git Commit Message Architecture

### VSCode Extension Components

- **CommitMessageProvider** (`src/services/commit-message/CommitMessageProvider.ts`): Main orchestrator for AI-powered commit message generation
- **GitExtensionService** (`src/services/commit-message/GitExtensionService.ts`): Git operations using direct shell commands
- **Support Infrastructure**: Single completion handler, prompt templates, exclusion utils

### JetBrains Plugin Components

- **GitCommitMessageAction**: Action for triggering commit message generation
- **CommitMessageGenerator**: Service for RPC communication with VSCode extension
- **CommitMessageHandler**: Integration with JetBrains commit dialog
- **Settings Management**: User preferences and configuration

## Integration Pattern

### RPC Communication Flow

1. **JetBrains Action Trigger**: User clicks generate button or uses keyboard shortcut
2. **Parameter Collection**: Gather workspace path and staging information
3. **RPC Call**: Send `kilo-code.generateCommitMessageForExternal` command to VSCode extension
4. **VSCode Processing**: Extension analyzes Git changes and generates message using AI
5. **Response Handling**: JetBrains plugin receives generated message and displays in commit dialog

### External Command Interface

```typescript
// VSCode Extension Command
'kilo-code.generateCommitMessageForExternal'

// Parameters
{
  workspacePath: string,  // Absolute path to Git repository
  staged?: boolean        // Whether to analyze staged (true) or unstaged (false) changes
}

// Response
{
  message: string,        // Generated commit message
  error?: string         // Error message if generation failed
}
```

## Mode System

- **Architect Mode**: Can only edit `.md` files - for documentation and planning
- **Code Mode**: Full file access - primary implementation mode
- **Test Mode**: Focused on test files and testing workflows
- **Debug Mode**: For investigating issues and failures
- **Translate Mode**: Specialized for i18n/localization work
- **Orchestrator Mode**: For coordinating multi-phase implementations

## Communication Architecture

### Socket-Based IPC

- **Windows**: TCP socket communication
- **Unix/Linux/macOS**: Unix Domain Socket (UDS) communication
- **Protocol**: JSON-RPC for command execution and data exchange
- **Service Registry**: `ServiceProxyRegistry` manages RPC proxy objects

### Error Handling Strategy

- **Network Failures**: Graceful degradation with user feedback
- **Git Repository Issues**: Clear error messages for invalid repositories
- **AI Provider Failures**: Fallback mechanisms and retry logic
- **UI Integration**: Progress indicators and cancellation support
