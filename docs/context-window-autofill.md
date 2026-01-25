# Context Window Auto-fill Feature

## Objective

Implement an auto-fill feature for the context window and other model capabilities in the OpenAI Compatible settings.

## Changes

### Backend

1.  **`src/shared/WebviewMessage.ts`**:

    - Added `requestOpenAiModelInfo` to `WebviewMessage` type.
    - This message allows the frontend to request model information based on the selected model ID.

2.  **`src/shared/ExtensionMessage.ts`**:

    - Added `openAiModelInfo` to `ExtensionMessage` type.
    - This property carriers the `ModelInfo` payload back to the frontend.

3.  **`src/api/providers/openai.ts`**:

    - Imported known model maps (`openAiNativeModels`, `anthropicModels`, etc.) from `@roo-code/types`.
    - Added `getOpenAiModelInfo(modelId: string)` helper function.
    - This function iterates through known model maps to find and return the `ModelInfo` for a given model ID.

4.  **`src/core/webview/webviewMessageHandler.ts`**:
    - Added a handler for `requestOpenAiModelInfo`.
    - It calls `getOpenAiModelInfo` and sends back an `openAiModelInfo` message with the result.

### Frontend

1.  **`webview-ui/src/i18n/locales/en/settings.json`**:

    - Added `"autoFill": "Auto-fill"` translation key.

2.  **`webview-ui/src/components/settings/providers/OpenAICompatible.tsx`**:
    - Imported `vscode` utility for message passing.
    - Implemented `handleAutoFill` function that sends `requestOpenAiModelInfo`.
    - Added a listener in `onMessage` to handle `openAiModelInfo` response and update `openAiCustomModelInfo` state.
    - Added an "Auto-fill" button in the "Model Capabilities" section header.

## Verification

- Ran `pnpm check-types` successfully, confirming type safety across the monorepo.
