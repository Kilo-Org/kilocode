# `@terminal` Context Plan

## Legacy Notes

- Legacy suggests `@terminal` in the mention menu and resolves it as a labeled `<terminal_output>` context block.
- Terminal capture used VS Code terminal selection commands, copied to clipboard, then restored the original clipboard.
- Legacy terminal safety uses output limits: default 500 lines and 50,000 characters, with truncation notices.
- The new extension already has similar capture code in `src/services/code-actions/register-terminal-actions.ts`.

## Plan

1. Extract terminal capture
   - Move terminal clipboard capture into `src/services/terminal/context.ts`.
   - Reuse it from existing terminal code actions.

2. Add output safety
   - Add shared terminal truncation with default 500 lines and 50,000 characters.
   - Keep first 20% and last 80% of allowed output, with an omitted-lines/chars notice.
   - Apply truncation before attaching context so `@terminal` cannot flood the prompt.

3. Add webview protocol
   - Add `requestTerminalContext` and `terminalContextResult` messages in `webview-ui/src/types/messages.ts`.
   - Include `requestId` and optional `sessionID` so Agent Manager can target the active session.
   - Handle the request in `src/KiloProvider.ts` and return truncated terminal output.

4. Add Agent Manager routing
   - Agent Manager already reuses `ChatView` / `PromptInput`, so mention UI changes apply there too.
   - Add the new message type to `src/agent-manager/types.ts`.
   - When `sessionID` is present, reveal that session's managed terminal before forwarding to `KiloProvider`.
   - Fall back to the active VS Code terminal when no managed terminal exists.

5. Add isolated webview support
   - Put terminal mention state/request logic in `webview-ui/src/hooks/useTerminalContext.ts`.
   - Put mention detection and attachment building in `webview-ui/src/hooks/terminal-context-utils.ts`.
   - Keep `PromptInput.tsx` as orchestration only.

6. Add mention support
   - Extend `useFileMention` / `file-mention-utils` with a virtual `terminal` suggestion.
   - Show it for `@` and `@term...`; selecting it inserts `@terminal`.

7. Attach context on send
   - Detect standalone `@terminal` before sending.
   - Fetch terminal output, keep the draft if output is empty or capture fails.
   - Send output as a `text/plain` data-url attachment named `terminal-output.txt`.

8. Preserve metadata
   - Allow file attachments to carry `filename` and `source` through `parseMessageFiles()`.
   - Pass those fields into SDK file parts for normal messages, commands, and cloud import sends.

9. Validate
   - Unit test mention matching, truncation, attachment creation, attachment validation, and Agent Manager pass-through.
   - Manually verify `@terminal` in sidebar and Agent Manager, including per-session managed terminals and existing terminal actions.
