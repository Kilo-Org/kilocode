# Create namespace folder for the copied app UI
mkdir -p kilo-vscode/webview-ui/src/opencode-app

# Core chat window UI
mkdir -p kilo-vscode/webview-ui/src/opencode-app/pages
cp app/src/pages/session.tsx kilo-vscode/webview-ui/src/opencode-app/pages/session.tsx

mkdir -p kilo-vscode/webview-ui/src/opencode-app/components
cp app/src/components/prompt-input.tsx kilo-vscode/webview-ui/src/opencode-app/components/prompt-input.tsx
cp app/src/components/session-context-usage.tsx kilo-vscode/webview-ui/src/opencode-app/components/session-context-usage.tsx

# Session support components
mkdir -p kilo-vscode/webview-ui/src/opencode-app/components/session
cp -R app/src/components/session/* kilo-vscode/webview-ui/src/opencode-app/components/session/

# Dialogs used by session/prompt input
cp app/src/components/dialog-select-file.tsx kilo-vscode/webview-ui/src/opencode-app/components/dialog-select-file.tsx
cp app/src/components/dialog-select-model.tsx kilo-vscode/webview-ui/src/opencode-app/components/dialog-select-model.tsx
cp app/src/components/dialog-select-model-unpaid.tsx kilo-vscode/webview-ui/src/opencode-app/components/dialog-select-model-unpaid.tsx
cp app/src/components/dialog-select-mcp.tsx kilo-vscode/webview-ui/src/opencode-app/components/dialog-select-mcp.tsx
cp app/src/components/dialog-fork.tsx kilo-vscode/webview-ui/src/opencode-app/components/dialog-fork.tsx

# Optional (only if you keep file-tree/terminal panels)
cp app/src/components/file-tree.tsx kilo-vscode/webview-ui/src/opencode-app/components/file-tree.tsx
cp app/src/components/terminal.tsx kilo-vscode/webview-ui/src/opencode-app/components/terminal.tsx

# Context/state (copy whole dir to avoid chasing imports)
mkdir -p kilo-vscode/webview-ui/src/opencode-app/context
cp -R app/src/context/* kilo-vscode/webview-ui/src/opencode-app/context/

# Hooks
mkdir -p kilo-vscode/webview-ui/src/opencode-app/hooks
cp -R app/src/hooks/* kilo-vscode/webview-ui/src/opencode-app/hooks/

# Utils (copy whole dir)
mkdir -p kilo-vscode/webview-ui/src/opencode-app/utils
cp -R app/src/utils/* kilo-vscode/webview-ui/src/opencode-app/utils/

# Styles
cp app/src/index.css kilo-vscode/webview-ui/src/opencode-app/index.css
