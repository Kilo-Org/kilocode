# Git Commit Message Generation Implementation Tasks

## Phase 1: VSCode Extension Integration (Week 1)

### Task 1.1: Register External Commit Message Command

- **File**: `src/extension.ts` (around line 29)
- **Action**: Add command registration for `kilo-code.generateCommitMessageForExternal`
- **Details**: Register command that accepts `{ workspacePath: string, staged?: boolean }` parameters

### Task 1.2: Extend CommitMessageProvider for External Calls

- **File**: `src/services/commit-message/CommitMessageProvider.ts` (add method around line 285)
- **Action**: Add `generateCommitMessageForExternal()` method
- **Details**:
    - Accept workspace path and staged parameters
    - Return `{ message: string, error?: string }` instead of setting VSCode UI
    - Handle external workspace configuration

### Task 1.3: Update GitExtensionService for External Workspace Support

- **File**: `src/services/commit-message/GitExtensionService.ts` (modify `configureRepositoryContext` method)
- **Action**: Enhance repository context configuration for external workspaces
- **Details**: Support external workspace paths from JetBrains plugin

## Phase 2: JetBrains Plugin Git Integration (Week 2)

### Task 2.1: Create Git Commit Message Action

- **File**: `jetbrains/plugin/src/main/kotlin/ai/kilocode/jetbrains/actions/GitCommitMessageAction.kt`
- **Action**: Create new action class for triggering commit message generation
- **Details**: Integrate with JetBrains action system and change detection

### Task 2.2: Implement Commit Message Generator Service

- **File**: `jetbrains/plugin/src/main/kotlin/ai/kilocode/jetbrains/git/CommitMessageGenerator.kt`
- **Action**: Create service for RPC communication with VSCode extension
- **Details**: Handle progress reporting, error handling, and result parsing

### Task 2.3: Update Action Constants

- **File**: `jetbrains/plugin/src/main/kotlin/ai/kilocode/jetbrains/actions/ActionConstants.kt`
- **Action**: Add Git-specific command IDs and action names
- **Details**: Add `GENERATE_COMMIT_MESSAGE` constants

## Phase 3: Commit Dialog Integration (Week 3)

### Task 3.1: Create Commit Handler Factory

- **File**: `jetbrains/plugin/src/main/kotlin/ai/kilocode/jetbrains/git/CommitMessageHandlerFactory.kt`
- **Action**: Implement CheckinHandlerFactory for commit dialog integration
- **Details**: Follow JetBrains VCS integration patterns

### Task 3.2: Implement Commit Handler

- **File**: `jetbrains/plugin/src/main/kotlin/ai/kilocode/jetbrains/git/CommitMessageHandler.kt`
- **Action**: Create CheckinHandler with UI components
- **Details**: Add generate button and auto-generate checkbox to commit dialog

### Task 3.3: Update Plugin Configuration

- **File**: `jetbrains/plugin/src/main/resources/META-INF/plugin.xml`
- **Action**: Register commit handler factory and actions
- **Details**: Add VCS integration extensions and keyboard shortcuts

## Phase 4: Enhanced Features (Week 4)

### Task 4.1: Create Settings Configuration

- **File**: `jetbrains/plugin/src/main/kotlin/ai/kilocode/jetbrains/git/CommitMessageSettings.kt`
- **Action**: Implement persistent settings for user preferences
- **Details**: Auto-generate options, format preferences, message length limits

### Task 4.2: Add Toolbar Integration

- **File**: Update `jetbrains/plugin/src/main/kotlin/ai/kilocode/jetbrains/actions/VSCodeCommandActions.kt`
- **Action**: Add toolbar action for commit message generation
- **Details**: Integrate with existing toolbar action system

### Task 4.3: Comprehensive Testing

- **Files**: Various test files
- **Action**: Create unit tests, integration tests, and manual testing procedures
- **Details**: Test RPC communication, Git integration, UI components, and error handling

## Testing Strategy

### Unit Tests

- VSCode extension external command handling
- JetBrains Git integration components
- RPC communication layer

### Integration Tests

- End-to-end commit message generation flow
- Error handling and edge cases
- Multiple repository scenarios

### Manual Testing

- Different Git repository states
- Various file change types
- UI responsiveness and user feedback
