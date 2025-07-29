# Kilocode Development Setup Guide

## Quick Start

This project consists of a VS Code extension with Kilocode integrated. Here's how to get everything running in development mode:

## Prerequisites

- Node.js v20.18.1 or higher
- npm
- VS Code

## Installation Steps

1. **Install all dependencies** (run from the extension root directory):
   ```bash
   cd /Users/jkneen/Documents/GitHub/flows/void_new/extensions/kilocode
   npm run install:all
   ```

2. **Known TypeScript Issues**:
   The webview-ui has some TypeScript errors that need to be fixed:
   - ChatView.tsx: Type mismatches with ClineAsk comparisons
   - ApiOptions.tsx: Index type errors
   
   These don't prevent the extension from running but should be fixed for a clean build.

## Running in Development Mode

### Method 1: VS Code Debugging (Recommended)

1. Open the project in VS Code
2. Press `F5` or go to Run → Start Debugging
3. This will:
   - Compile the extension
   - Launch a new VS Code window with the extension loaded
   - Enable hot reloading for the webview

### Method 2: Manual Development Mode

1. **Start the webview dev server** (from webview-ui directory):
   ```bash
   npm run dev
   ```

2. **In a separate terminal, watch the extension** (from extension root):
   ```bash
   cd .. && npm run watch
   ```

3. **Open VS Code with the extension**:
   - Press `F5` in VS Code with the project open

## Build Commands

### Development Build
```bash
# From extension root
npm run compile      # Compile TypeScript
npm run watch        # Watch mode for extension

# From webview-ui
npm run dev          # Start Vite dev server
npm run build        # Build webview for production
```

### Production Build
```bash
# From extension root
npm run build        # Creates .vsix file in bin/
```

## Current Build Status

### Working:
- Extension structure is set up correctly
- Dependencies are installed
- Basic compilation works

### Issues to Fix:
1. TypeScript errors in webview-ui (ChatView.tsx, ApiOptions.tsx)
2. Type mismatches between shared types and webview types

## Project Structure

```
kilocode/
├── src/                    # Extension source code
├── webview-ui/            # React-based webview
│   ├── src/
│   ├── node_modules/
│   └── package.json
├── dist/                  # Compiled extension output
├── out/                   # TypeScript output
└── package.json          # Extension manifest
```

## Development Tips

1. **Hot Reloading**: 
   - Webview changes reload automatically
   - Extension changes require reload (Ctrl+R in the debug VS Code window)

2. **Debugging**:
   - Use VS Code's Debug Console
   - Check Output → Kilo Code for extension logs
   - Right-click in webview → Inspect Element for webview debugging

3. **Type Checking**:
   ```bash
   # Check types in webview-ui
   npm run check-types
   
   # Check types in extension (from root)
   cd .. && npm run check-types:extension
   ```

## Next Steps

1. Fix the TypeScript compilation errors
2. Ensure all tests pass
3. Set up proper development workflow

## Troubleshooting

If you encounter issues:
1. Make sure all dependencies are installed: `npm run install:all` from extension root
2. Clean and rebuild: `npm run clean` then `npm run build`
3. Check the VS Code Developer Tools (Help → Toggle Developer Tools) for errors