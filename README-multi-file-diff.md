# Multi-File Diff and Auto-Navigation System

A comprehensive VSCode extension system that enables AI agents to programmatically open multiple files, display inline diff overlays with color coding, and provide accept/reject mechanisms.

## Quick Start

### Installation

This system is integrated into Kilo Code as part of the core extension. No additional installation required.

### Basic Usage

1. **AI-Generated Changes**: When Kilo Code generates modifications across multiple files, they automatically open in a tab layout
2. **Diff Visualization**: Changes appear as colored overlays (green for additions, red for deletions)
3. **Review Changes**: Use the accept/reject controls to approve or discard individual changes
4. **Batch Operations**: Use commands to accept/reject all changes at once

### Commands

- `Ctrl+Shift+A`: Accept current diff
- `Ctrl+Shift+R`: Reject current diff  
- `Ctrl+Shift+Alt+A`: Accept all diffs in file
- `Ctrl+Shift+Alt+R`: Reject all diffs in file
- `Ctrl+Shift+Alt+C`: Clear all diff state

## Features

### 🎯 User Story 1: Basic Diff Visualization
- Inline diff overlays with color coding
- Individual change acceptance/rejection
- Shadow buffer management
- Myers algorithm diff computation

### 📁 User Story 2: Multi-File Management  
- Automatic multi-file opening
- Tab coordination and organization
- Session state persistence
- File type detection (40+ languages)

### ⚡ User Story 3: Performance & Large Files
- Streaming processing for large files
- Memory management and cleanup
- Background task processing
- Performance monitoring

## Configuration

### Settings

Access through VSCode settings or `settings.json`:

```json
{
  "diffSystem.autoSave": false,
  "diffSystem.colorScheme": "vscode",
  "diffSystem.maxFileSize": 10485760,
  "diffSystem.streamingChunkSize": 65536,
  "diffSystem.performanceMonitoring": true
}
```

### Performance Tuning

For large files (>1MB), the system automatically:
- Enables streaming mode
- Increases chunk sizes
- Monitors memory usage
- Provides progress indicators

## Supported File Types

| Category | Extensions | Features |
|-----------|-------------|----------|
| Web | `.js`, `.ts`, `.jsx`, `.tsx`, `.html`, `.css`, `.scss`, `.less` | Full syntax highlighting |
| Backend | `.py`, `.java`, `.c`, `.cpp`, `.cs`, `.go`, `.rs`, `.php`, `.rb` | IntelliSense support |
| Config | `.json`, `.yaml`, `.yml`, `.xml`, `.toml`, `.env` | Validation and formatting |
| Docs | `.md`, `.txt` | Preview and formatting |

## Troubleshooting

### Performance Issues

**Large Files Slow?**
- Enable streaming: Set `"diffSystem.streamingChunkSize": 131072`
- Monitor memory: Check performance metrics
- Close unused tabs

**Memory Usage High?**
- System auto-cleans when >85% memory
- Manual cleanup: Run "Diff: Clear Session" command
- Reduce concurrent files

**Diff Not Showing?**
- Check file encoding (UTF-8 recommended)
- Verify file permissions
- Reload VSCode window

### Debug Mode

Enable detailed logging:

```json
{
  "diffSystem.debug": true,
  "diffSystem.logLevel": "debug"
}
```

Check console output for:
- Operation timing
- Memory usage
- Error details
- Performance warnings

## Development

### Architecture

```
src/services/
├── diff/                    # Core diff processing
│   ├── diff-engine.ts
│   ├── diff-overlay.ts
│   └── streaming-diff.ts
├── file-management/          # File operations
│   ├── file-opener.ts
│   ├── tab-manager.ts
│   └── file-type-detection.ts
├── session/                 # State management
│   ├── session-state.ts
│   └── multi-file-coordinator.ts
├── performance/             # Performance services
│   ├── memory-management.ts
│   ├── background-processing.ts
│   └── performance-monitoring.ts
└── integration/             # VSCode integration
    └── editor-hooks.ts
```

### Building

```bash
# Install dependencies
pnpm install

# Build extension
pnpm build

# Run in development
pnpm dev
```

### Testing

```bash
# Run all tests
pnpm test

# Unit tests only
pnpm test:unit

# Integration tests
pnpm test:integration

# Performance tests
pnpm test:performance
```

## API Reference

### Core Services

#### FileOpenerService
```typescript
await fileOpener.openFile({
  filePath: '/path/to/file.ts',
  action: 'focus',
  createIfNotExists: true
});
```

#### TabManagerService  
```typescript
await tabManager.arrangeTabsInGrid([
  '/file1.ts',
  '/file2.ts', 
  '/file3.ts'
]);
```

#### StreamingDiffProcessor
```typescript
const result = await processor.processStreamingDiff(
  originalBuffer,
  modifiedContent,
  { chunkSize: 131072, enableProgress: true }
);
```

### Events

Listen to system events:

```typescript
// Diff events
diffEventManager.on('diff_created', (event) => {
  console.log('New diff created:', event.data);
});

// Performance events
performanceMonitor.on('performance_warning', (event) => {
  console.warn('Performance warning:', event.message);
});
```

## Contributing

### Code Standards

- **TypeScript**: Strict mode enabled
- **ESLint**: Follow project configuration  
- **Prettier**: Auto-format on save
- **Tests**: 90%+ coverage required

### Submitting Changes

1. Fork the repository
2. Create feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit pull request with description

## License

Part of the Kilo Code project. See main project license for details.

## Support

- **Documentation**: See `docs/multi-file-diff-system.md`
- **Issues**: Report through GitHub issues
- **Discussions**: Use GitHub Discussions for questions
