# Changelog

All notable changes to the `@roo-code/cli` package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.45] - 2026-01-08

### Changed

- **Major Refactor**: Extracted ~1400 lines from [`App.tsx`](src/ui/App.tsx) into reusable hooks and utilities for better maintainability:

    - [`useExtensionHost`](src/ui/hooks/useExtensionHost.ts) - Extension host connection and lifecycle management
    - [`useMessageHandlers`](src/ui/hooks/useMessageHandlers.ts) - Message processing and state updates
    - [`useTaskSubmit`](src/ui/hooks/useTaskSubmit.ts) - Task submission logic
    - [`useGlobalInput`](src/ui/hooks/useGlobalInput.ts) - Global keyboard shortcut handling
    - [`useFollowupCountdown`](src/ui/hooks/useFollowupCountdown.ts) - Auto-approval countdown logic
    - [`useFocusManagement`](src/ui/hooks/useFocusManagement.ts) - Input focus state management
    - [`usePickerHandlers`](src/ui/hooks/usePickerHandlers.ts) - Picker component event handling
    - [`uiStateStore`](src/ui/stores/uiStateStore.ts) - UI-specific state (showExitHint, countdown, etc.)
    - Tool data utilities ([`extractToolData`](src/ui/utils/toolDataUtils.ts), `formatToolOutput`, etc.)
    - [`HorizontalLine`](src/ui/components/HorizontalLine.tsx) component

- **Performance Optimizations**:

    - Added RAF-style scroll throttling to reduce state updates
    - Stabilized `useExtensionHost` hook return values with `useCallback`/`useMemo`
    - Added streaming message debouncing to batch rapid partial updates
    - Added shallow array equality checks to prevent unnecessary re-renders

- Simplified [`ModeTool`](src/ui/components/tools/ModeTool.tsx) layout to horizontal with mode suffix
- Simplified logging by removing verbose debug output and adding first/last partial message logging pattern
- Updated Nerd Font icon codepoints in [`Icon`](src/ui/components/Icon.tsx) component

### Added

- `#` shortcut in help trigger for quick access to task history autocomplete

### Fixed

- Fixed a crash in message handling
- Added protected file warning in tool approval prompts
- Enabled `alwaysAllowWriteProtected` for non-interactive mode

### Removed

- Removed unused `renderLogger.ts` utility file

### Tests

- Updated extension-host tests to expect `[Tool Request]` format
- Updated Icon tests to expect single-char Nerd Font icons

## [0.0.44] - 2026-01-08

### Added

- **Tool Renderer Components**: Specialized renderers for displaying tool outputs with optimized formatting for each tool type. Each renderer provides a focused view of its data structure.

    - [`FileReadTool`](src/ui/components/tools/FileReadTool.tsx) - Display file read operations with syntax highlighting
    - [`FileWriteTool`](src/ui/components/tools/FileWriteTool.tsx) - Show file write/edit operations with diff views
    - [`SearchTool`](src/ui/components/tools/SearchTool.tsx) - Render search results with context
    - [`CommandTool`](src/ui/components/tools/CommandTool.tsx) - Display command execution with output
    - [`BrowserTool`](src/ui/components/tools/BrowserTool.tsx) - Show browser automation actions
    - [`ModeTool`](src/ui/components/tools/ModeTool.tsx) - Display mode switching operations
    - [`CompletionTool`](src/ui/components/tools/CompletionTool.tsx) - Show task completion status
    - [`GenericTool`](src/ui/components/tools/GenericTool.tsx) - Fallback renderer for other tools

- **History Trigger**: New `#` trigger for task history autocomplete with fuzzy search support. Type `#` at the start of a line to browse and resume previous tasks.

    - [`HistoryTrigger.tsx`](src/ui/components/autocomplete/triggers/HistoryTrigger.tsx) - Trigger implementation with fuzzy filtering
    - Shows task status, mode, and relative timestamps
    - Supports keyboard navigation for quick task selection

- **Release Confirmation Prompt**: The release script now prompts for confirmation before creating a release.

### Fixed

- Task history picker selection and navigation issues
- Mode switcher keyboard handling bug

### Changed

- Reorganized test files into `__tests__` directories for better project structure
- Refactored utility modules into dedicated `utils/` directory

## [0.0.43] - 2026-01-07

### Added

- **Toast Notification System**: New toast notifications for user feedback with support for info, success, warning, and error types. Toasts auto-dismiss after a configurable duration and are managed via Zustand store.

    - New [`ToastDisplay`](src/ui/components/ToastDisplay.tsx) component for rendering toast messages
    - New [`useToast`](src/ui/hooks/useToast.ts) hook for managing toast state and displaying notifications

- **Global Input Sequences Registry**: Centralized system for handling keyboard shortcuts at the application level, preventing conflicts with input components.

    - New [`globalInputSequences.ts`](src/ui/utils/globalInputSequences.ts) utility module
    - Support for Kitty keyboard protocol (CSI u encoding) for better terminal compatibility
    - Built-in sequences for `Ctrl+C` (exit) and `Ctrl+M` (mode cycling)

- **Local Tarball Installation**: The install script now supports installing from a local tarball via the `ROO_LOCAL_TARBALL` environment variable, useful for offline installation or testing pre-release builds.

### Changed

- **MultilineTextInput**: Updated to respect global input sequences, preventing the component from consuming shortcuts meant for application-level handling.

### Tests

- Added comprehensive tests for the toast notification system
- Added tests for global input sequence matching

## [0.0.42] - 2025-01-07

The cli is alive!
