# Shared - Messages Feature

**Quick Navigation for AI Agents**

---

## Overview

Message type definitions for extension-webview communication. Defines all message formats passed between VS Code extension and React webview.

**Source Location**: `src/shared/ExtensionMessage.ts`, `src/shared/WebviewMessage.ts`

---

## Components

| Component | File | Size |
|-----------|------|------|
| ExtensionMessage | `ExtensionMessage.ts` | 22KB |
| WebviewMessage | `WebviewMessage.ts` | 17KB |

---

## ExtensionMessage

Messages from extension TO webview.

**Categories**:
| Category | Examples |
|----------|----------|
| State updates | `taskState`, `clineMessages` |
| Configuration | `apiConfiguration`, `customModes` |
| Tool results | `toolResult`, `askResponse` |
| Status | `loading`, `error`, `streaming` |

**Key Types**:
```typescript
type ExtensionMessage =
  | { type: "state"; state: ExtensionState }
  | { type: "action"; action: string }
  | { type: "selectedImages"; images: string[] }
  | { type: "theme"; text: string }
  // ... many more
```

---

## WebviewMessage

Messages from webview TO extension.

**Categories**:
| Category | Examples |
|----------|----------|
| User actions | `newTask`, `askResponse` |
| Configuration | `updateApiConfig`, `updateMode` |
| Commands | `executeCommand`, `cancelTask` |
| UI events | `didShowAnnouncement`, `selectImages` |

**Key Types**:
```typescript
type WebviewMessage =
  | { type: "newTask"; text: string; images?: string[] }
  | { type: "askResponse"; response: ClineAskResponse }
  | { type: "cancelTask" }
  // ... many more
```

---

## Message Flow

```
User Action (Webview)
       ↓
  WebviewMessage
       ↓
Extension processes
       ↓
  ExtensionMessage
       ↓
UI Update (Webview)
```

---

## Related

- [Core Messages](../../../core/features/messages/) - Message handling logic

---

[← Back to Shared](../../Feature-Index.md)
