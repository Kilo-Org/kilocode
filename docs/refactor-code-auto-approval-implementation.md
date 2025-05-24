# Refactor Code Tool Auto-Approval Implementation

## Summary

Added an auto-approval option for the refactor code tool to the UI, allowing users to make it always auto-approved.

## Changes Made

### 1. Schema Definition

**File: `src/schemas/index.ts`**

- Added `alwaysAllowRefactorCode: z.boolean().optional()` to `globalSettingsSchema`
- Added to `globalSettingsRecord` for type generation

### 2. Message Types

**File: `src/shared/ExtensionMessage.ts`**

- Added `"alwaysAllowRefactorCode"` to the ExtensionMessage type union

**File: `src/shared/WebviewMessage.ts`**

- Added `"alwaysAllowRefactorCode"` to the WebviewMessage type union

### 3. State Management

**File: `webview-ui/src/context/ExtensionStateContext.tsx`**

- Added `setAlwaysAllowRefactorCode: (value: boolean) => void` to the interface
- Implemented the setter function

**File: `src/core/webview/ClineProvider.ts`**

- Added `alwaysAllowRefactorCode: stateValues.alwaysAllowRefactorCode ?? false` to getState()
- Added to getStateToPostToWebview() destructuring and return

### 4. Message Handling

**File: `src/core/webview/webviewMessageHandler.ts`**

- Added case handler for "alwaysAllowRefactorCode" message

### 5. Settings UI

**File: `webview-ui/src/components/settings/SettingsView.tsx`**

- Added `alwaysAllowRefactorCode` to destructured state
- Added to handleSubmit function

**File: `webview-ui/src/components/settings/AutoApproveSettings.tsx`**

- Added `alwaysAllowRefactorCode` to component props interface
- Passed to AutoApproveToggle component

**File: `webview-ui/src/components/settings/AutoApproveToggle.tsx`**

- Added `alwaysAllowRefactorCode` to AutoApproveToggles type
- Added config entry with icon "edit", label, description, and test ID

### 6. Translations

**File: `webview-ui/src/i18n/locales/en/settings.json`**

- Added translation entries:
    ```json
    "refactorCode": {
      "label": "Refactor",
      "description": "Automatically approve code refactoring operations without requiring manual approval"
    }
    ```

### 7. Auto-Approval Logic

**File: `webview-ui/src/components/chat/ChatView.tsx`**

- Added `alwaysAllowRefactorCode` to useExtensionState() destructuring
- Added check for refactor_code tool in the auto-approval logic:
    ```typescript
    if (tool?.tool === "refactorCode") {
    	return alwaysAllowRefactorCode
    }
    ```
- Added `alwaysAllowRefactorCode` to the useMemo dependency array

## How It Works

1. When the user enables the "Refactor" toggle in the Auto-Approve settings
2. The setting is saved to VSCode's global state
3. When the refactor code tool is invoked, the ChatView component checks if `alwaysAllowRefactorCode` is true
4. If true, the tool is automatically approved without showing the approval dialog
5. The refactoring operations proceed immediately

## Testing

To test this feature:

1. Open the settings panel
2. Navigate to the Auto-Approve section
3. Toggle the "Refactor" option
4. Use the refactor code tool - it should execute without requiring approval when enabled
