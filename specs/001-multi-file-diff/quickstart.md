# Quickstart Guide: Multi-File Diff and Auto-Navigation System

**Date**: January 10, 2026  
**Purpose**: Quick setup and testing guide for the diff system

## Prerequisites

- VSCode 1.80.0 or higher
- Kilo Code extension installed
- Node.js 18.0.0 or higher for development
- TypeScript 5.0.0 or higher for development

## Installation

### Development Setup

```bash
# Clone the repository
git clone <repository-url>
cd kilocode

# Install dependencies
pnpm install

# Navigate to the diff system
cd src/services/diff

# Install diff-specific dependencies
pnpm add diff @types/diff
```

### Extension Activation

The diff system activates automatically when:
1. Kilo Code extension is loaded
2. AI response contains file paths with actions
3. User manually triggers diff commands

## Basic Usage

### 1. Single File Diff

```typescript
// AI generates response with diff
const aiResponse = `
I'll modify the file to add error handling:

File: /src/utils/helper.js
@@ -5,3 +5,7 @@
 function processData(data) {
+  if (!data) {
+    throw new Error('Data is required');
+  }
   return data.map(item => item.value);
 }
`;

// System automatically creates diff overlay
// User sees green additions and red deletions
```

### 2. Multi-File Auto-Navigation

```typescript
// AI generates response with multiple files
const multiFileResponse = `
I'll update the Odoo module:

File: /models/res_partner.py (add new field)
File: /views/res_partner_views.xml (update view)
File: /static/src/js/partner_form.js (add validation)
`;

// System automatically:
// 1. Opens all three files in new tabs
// 2. Creates diff overlays in each file
// 3. Maintains separate state for each file
```

### 3. Accept/Reject Changes

```typescript
// User interactions
- Click green checkmark to accept addition
- Click red X to reject deletion
- Use keyboard shortcuts: Ctrl+A (accept all), Ctrl+R (reject all)
- Right-click for context menu options
```

## Testing Scenarios

### Test 1: Basic Diff Visualization

**Setup**: Create a test file with simple content

```bash
# Create test file
echo "function hello() {
  console.log('Hello');
}" > test.js

# Trigger AI response with diff
# System should show green/red overlay
```

**Expected Results**:
- Additions displayed with green background
- Deletions displayed with red strikethrough
- Accept/reject buttons appear for each change

### Test 2: Multi-File Workflow

**Setup**: Create multiple related files

```bash
# Create Odoo module structure
mkdir -p test_module/{models,views,static/src/js}
echo "class TestModel(models.Model):" > test_module/models/test_model.py
echo "<record id='view_test'>" > test_module/views/test_view.xml
echo "// Test JavaScript" > test_module/static/src/js/test.js
```

**Expected Results**:
- All files open automatically
- Each file maintains independent diff state
- Navigation between files preserves diff overlays

### Test 3: Large File Performance

**Setup**: Create large test file (1000+ lines)

```bash
# Generate large file
for i in {1..1000}; do
  echo "line $i: some content here"
done > large_file.js

# Apply large diff
# System should stream without UI blocking
```

**Expected Results**:
- UI remains responsive during processing
- Diff appears progressively (streaming)
- Memory usage stays within limits

## Configuration

### Session Settings

```json
{
  "diffSystem": {
    "autoSave": false,
    "diffColorScheme": "vscode",
    "maxFileSize": 10485760,
    "streamingChunkSize": 65536
  }
}
```

### Keyboard Shortcuts

```json
{
  "key": "ctrl+shift+d",
  "command": "diffSystem.acceptCurrent"
},
{
  "key": "ctrl+shift+r", 
  "command": "diffSystem.rejectCurrent"
},
{
  "key": "ctrl+shift+a",
  "command": "diffSystem.acceptAll"
}
```

## Troubleshooting

### Common Issues

1. **Diff overlays not appearing**
   - Check file is open in editor
   - Verify AI response format is correct
   - Check extension activation logs

2. **Performance issues with large files**
   - Reduce `maxFileSize` setting
   - Enable streaming mode
   - Close unused file tabs

3. **Multi-file state conflicts**
   - Clear session state: `Ctrl+Shift+P` → "Clear Diff Session"
   - Restart VSCode
   - Check for conflicting extensions

### Debug Information

Enable debug logging:

```json
{
  "diffSystem.debug": true,
  "diffSystem.logLevel": "verbose"
}
```

Check output in `Developer: Show Logs` → `Extension Host`.

## Integration Points

### AI Agent Integration

```typescript
// AI agents can trigger diff system
import { DiffSystem } from './services/diff/diff-system';

// Create diff from AI response
await DiffSystem.createDiff({
  filePath: '/path/to/file.js',
  diffContent: aiGeneratedDiff,
  diffFormat: 'unified',
  source: 'AI-Agent'
});

// Open multiple files
await DiffSystem.openFiles([
  '/path/to/file1.py',
  '/path/to/file2.xml',
  '/path/to/file3.js'
]);
```

### Editor Hooks

```typescript
// Integration with existing editor functions
const originalEditorOpen = vscode.window.showTextDocument;
vscode.window.showTextDocument = async (document) => {
  // Custom diff system logic
  await DiffSystem.handleFileOpen(document);
  return originalEditorOpen(document);
};
```

## Performance Monitoring

Monitor system performance:

```typescript
// Check performance metrics
const metrics = await DiffSystem.getPerformanceMetrics();
console.log('Active diffs:', metrics.activeDiffCount);
console.log('Memory usage:', metrics.memoryUsage);
console.log('Average response time:', metrics.avgResponseTime);
```

## Next Steps

1. Run the test scenarios to verify installation
2. Configure keyboard shortcuts for your workflow
3. Test with your actual AI responses
4. Adjust settings based on your project needs
