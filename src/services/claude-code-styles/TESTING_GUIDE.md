# Local Testing Guide for Skills Feature

This guide will help you test the skills feature locally before submitting a PR.

## Prerequisites

Ensure you have the following installed:

- Node.js (v18 or higher)
- pnpm (preferred package manager)
- VSCode (for extension testing)

## Step 1: Build the Extension

```bash
# Navigate to the kilocode directory
cd kilocode

# Install dependencies
pnpm install

# Build the extension
pnpm run build

# Compile TypeScript
pnpm run type-check
```

## Step 2: Run Tests

First, let's verify our new code works correctly:

```bash
# Run the skills feature tests
pnpm test src/services/claude-code-styles/__tests__/CodeStyleExtractor.test.ts

# Run with coverage
pnpm run test:coverage src/services/claude-code-styles/__tests__/CodeStyleExtractor.test.ts

# Run all tests to ensure nothing broke
pnpm test
```

## Step 3: Install Extension Locally

### Method 1: Using VSCode Extension Development

1. **Open VSCode** in the kilocode directory:

   ```bash
   code kilocode
   ```

2. **Press F5** or go to `Run > Start Debugging` to launch extension development host

3. **This will:**
   - Compile the TypeScript automatically
   - Launch a new VSCode window with the extension loaded
   - Allow you to test in real-time

### Method 2: Install as VSIX

1. **Build the extension**:

```bash
   pnpm run vsix
   ```

2.**Install the VSIX**:

   ```bash
   code --install-extension kilocode-*.vsix
   ```

3.**Restart VSCode** to load the new extension

## Step 4: Test the Skills Feature

### Test 1: Verify Skills Detection

1. **Open the kilocode workspace** in the extension development host
2. **Check if skills are detected**:
   - The extension should automatically create `.kilocode/rules/` directory
   - It should populate it with example files if they don't exist
   - Check the Output panel (`View > Output`) and select "Kilo Code" to see logs

### Test 2: Manual Skills Refresh

1. **Open Command Palette** (`Ctrl+Shift+P`)
2. **Search for "Refresh Skills"**
3. **Run the command** and check for success message

### Test 3: Open Rules Directory

1. **Run "Open Rules Directory" command** from Command Palette
2. **Verify** it opens the `.kilocode/rules/` folder

### Test 4: Test Custom Rules

1. **Edit** `.kilocode/rules/codestyle.md`:

   ```markdown
   # Code Style Rules
   
   ## Custom Rules
   - Custom indentation: 4 spaces
   - **Custom naming:** snake_case
   ```

2. **Edit** `.kilocode/rules/skills.md`:

   ```markdown
   # Project Skills
   
   ## Custom Skills
   - Custom testing framework
   - Custom build tools
   ```

3. **Run "Refresh Skills"** command again
4. **Verify** the changes are detected (check logs)

### Test 5: Verify File Watching

1. **Create a new file** in `.kilocode/rules/` (e.g., `custom-rules.md`)
2. **Check logs** - should show cache invalidation
3. **Delete a file** in the rules directory
4. **Check logs** - should show cache invalidation

## Step 5: Integration Testing

### Test 6: Skills Service Integration

Create a simple test script to verify the integration service:

```typescript
// test-integration.ts
import { SkillsIntegrationService } from './src/services/claude-code-styles/SkillsIntegrationService.js'
import * as vscode from 'vscode'

// Mock VSCode context
const mockContext = {
  workspaceState: {
    update: async (key: string, value: any) => {
      console.log(`Cache updated: ${key}`)
    },
    get: (key: string) => null
  },
  subscriptions: []
} as any

async function testIntegration() {
  const workspacePath = process.cwd()
  const service = new SkillsIntegrationService(mockContext, workspacePath)
  
  try {
    await service.initialize()
    console.log('✅ Service initialized successfully')
    
    const skills = await service.getSkills()
    console.log(`✅ Skills extracted: ${skills.styles.length} styles, ${skills.skills.length} skill categories`)
    
    const stats = service.getSkillsStats(skills)
    console.log('✅ Skills stats:', stats)
    
    console.log('✅ All integration tests passed!')
  } catch (error) {
    console.error('❌ Integration test failed:', error)
  }
}

testIntegration()
```

Run this test:

```bash
npx tsx test-integration.ts
```

## Step 6: Check for Issues

### Common Issues and Solutions

## Issue: Extension not loading

- Check console for errors (`Developer Tools > Console`)
- Verify TypeScript compilation: `pnpm run type-check`
- Rebuild: `pnpm run build`

## Issue: Skills not detected

- Check Output panel for "Kilo Code" logs
- Verify workspace has source files
- Ensure `.kilocode/rules/` directory exists

## Issue: Commands not appearing

- Restart VSCode after extension installation
- Check extension activation in Output panel

## Issue: Tests failing

- Run with verbose output: `pnpm test -- --reporter=verbose`
- Check for missing dependencies: `pnpm install`

## Step 7: Performance Testing

### Test 7: Large Project Performance

1. **Test with a large project** (copy the kilocode project to a temp location)
2. **Time the skills extraction**:

   ```typescript
   const start = Date.now()
   const skills = await service.getSkills()
   const end = Date.now()
   console.log(`Extraction took ${end - start}ms`)
   ```

3. **Verify** it completes within reasonable time (< 5 seconds for typical projects)

### Test 8: Memory Usage

1. **Monitor memory** in Task Manager while testing
2. **Check for memory leaks** during multiple refresh operations
3. **Verify** file watchers are properly cleaned up

## Step 8: Validation Checklist

Before creating the PR, ensure:

- [ ] All tests pass (`pnpm test`)
- [ ] TypeScript compilation succeeds (`pnpm run type-check`)
- [ ] Extension loads without errors
- [ ] Skills detection works on test projects
- [ ] Custom rules are properly parsed
- [ ] File watching functions correctly
- [ ] Commands are registered and work
- [ ] Integration service handles edge cases
- [ ] Performance is acceptable
- [ ] No console errors during operation

## Step 9: Cleanup

After testing:

1. **Stop the extension development host** (Shift+F5)
2. **Clean up test files**:

   ```bash
   rm -f test-integration.ts
   rm -rf .kilocode (if testing in a different directory)
   ```

3. **Restore any changed configuration files**

## Troubleshooting

### If tests fail

```bash
# Clear test cache
pnpm test -- --clearCache

# Run specific test
pnpm test src/services/claude-code-styles/__tests__/CodeStyleExtractor.test.ts -- --reporter=verbose
```

### If extension doesn't load

1. Check `Developer Tools > Console` for errors
2. Verify all dependencies are installed: `pnpm install`
3. Check TypeScript errors: `pnpm run type-check`

### If skills aren't detected

1. Check Output panel for "Kilo Code" logs
2. Verify workspace contains source files
3. Check file permissions on rules directory

## Success Indicators

You'll know testing is successful when:

- ✅ All tests pass
- ✅ Extension loads without errors in VSCode
- ✅ Skills are automatically detected and displayed
- ✅ Custom rules are properly parsed and applied
- ✅ File watching works (changes trigger cache refresh)
- ✅ Commands appear in Command Palette and work
- ✅ No console errors during normal operation

Once all tests pass and functionality works as expected, you're ready to create a PR!
