# Multi-File Diff and Auto-Navigation System

**Overview**: A comprehensive VSCode extension system that enables AI agents to programmatically open multiple files, display inline diff overlays with color coding, and provide accept/reject mechanisms.

## Features

### User Story 1: Basic Diff Visualization and Interaction
- **Inline Diff Overlays**: Color-coded visualization of additions (green) and deletions (red)
- **Accept/Reject Mechanisms**: Individual change approval through UI controls
- **Shadow Buffers**: Non-destructive modification state management
- **Diff Engine**: Myers algorithm implementation for accurate diff computation

### User Story 2: Multi-File Management and Auto-Navigation
- **Multi-File Coordination**: Simultaneous file opening and tab management
- **Session State Persistence**: Cross-session state management using VSCode Memento API
- **File Type Detection**: Automatic language detection for 40+ file types
- **Tab Organization**: Grid layout and tab group management

### User Story 3: Performance and Large File Handling
- **Streaming Processing**: Non-blocking chunked processing for large files
- **Memory Management**: Automatic memory monitoring and cleanup
- **Background Processing**: Task queue system for non-blocking operations
- **Performance Monitoring**: Real-time metrics and threshold warnings

## Architecture

### Core Services
- **Diff Engine** (`src/services/diff/`): Core diff computation and overlay management
- **File Management** (`src/services/file-management/`): File opening, tab coordination, type detection
- **Session Management** (`src/services/session/`): State persistence and multi-file coordination
- **Performance** (`src/services/performance/`): Memory management, background processing, monitoring
- **Integration** (`src/services/integration/`): VSCode API integration layer

### Type System
- **Diff Types** (`src/types/diff-types.ts`): Core interfaces for diff operations
- **Session Types** (`src/types/session-types.ts`): Session state and file state definitions

## Configuration

### Settings
- **Auto-save**: Configurable automatic saving behavior
- **Color Schemes**: VSCode, custom, high-contrast themes
- **Performance Tuning**: Chunk sizes, concurrency limits, memory thresholds
- **File Size Limits**: Configurable maximum file sizes for streaming

### Commands
- `diffSystem.acceptCurrent`: Accept current diff
- `diffSystem.rejectCurrent`: Reject current diff
- `diffSystem.acceptAll`: Accept all diffs in current file
- `diffSystem.rejectAll`: Reject all diffs in current file
- `diffSystem.clearSession`: Clear all diff state

## Performance

### Benchmarks
- **UI Response Time**: Sub-200ms for typical operations
- **File Handling**: Support for 10MB+ files with streaming
- **Concurrent Operations**: 10+ simultaneous file diffs
- **Memory Efficiency**: Automatic cleanup and threshold management

### Supported File Types
- **Web Technologies**: JavaScript, TypeScript, HTML, CSS, JSON, XML
- **Backend Languages**: Python, Java, C/C++, C#, Go, Rust, PHP, Ruby
- **Configuration**: YAML, TOML, Dockerfile, .env files
- **Documentation**: Markdown with preview support

## Integration

### VSCode Extension APIs
- **Text Document API**: For file content manipulation
- **Window API**: For tab management and editor control
- **Workspace API**: For file system operations
- **Commands API**: For custom command registration

### Event System
- **Diff Events**: Created, accepted, rejected notifications
- **File Events**: Opened, closed, modified tracking
- **Session Events**: State changes and lifecycle management
- **Performance Events**: Threshold warnings and metrics updates

## Usage

### Basic Workflow
1. AI agent generates code changes for multiple files
2. System automatically opens files in tab layout
3. Diff overlays display with color coding
4. User reviews and accepts/rejects individual changes
5. System applies changes and updates session state

### Advanced Features
- **Batch Operations**: Accept/reject all changes across files
- **Navigation**: Quick switching between modified files
- **History**: Session persistence with undo/redo capability
- **Export**: Diff export in various formats

## Development

### Building
```bash
pnpm install
pnpm build
```

### Testing
```bash
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:e2e
```

### Linting
```bash
pnpm lint
pnpm check-types
```

## Troubleshooting

### Common Issues
- **Large File Performance**: Enable streaming mode for files > 1MB
- **Memory Usage**: Monitor performance metrics and adjust thresholds
- **Tab Management**: Use grid layout for multiple files
- **Diff Accuracy**: Check file encoding and line ending settings

### Debug Mode
Enable verbose logging for development:
```json
{
  "diffSystem.debug": true,
  "diffSystem.logLevel": "debug"
}
```

## Contributing

### Code Style
- **TypeScript**: Strict type checking enabled
- **ESLint**: Follow project linting rules
- **Prettier**: Use project formatting configuration
- **Documentation**: JSDoc comments for all public APIs

### Testing Requirements
- **Unit Tests**: 90%+ coverage for core services
- **Integration Tests**: Multi-file workflow scenarios
- **Performance Tests**: Large file handling benchmarks
- **E2E Tests**: Complete user journey validation

## License

This extension is part of the Kilo Code project and follows the same licensing terms.
