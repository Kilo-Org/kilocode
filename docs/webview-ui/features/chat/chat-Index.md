# Webview UI - Chat Feature

**Quick Navigation for AI Agents**

---

## Overview

Main chat interface (70+ components). Handles message display, user input, tool approvals, and task controls.

**Source Location**: `webview-ui/src/components/chat/`

---

## Key Components

| Component | Purpose | File |
|-----------|---------|------|
| ChatView | Main chat container | `ChatView.tsx` |
| ChatRow | Individual message row | `ChatRow.tsx` |
| ChatTextArea | User input area | `ChatTextArea.tsx` |
| ModeSelector | Mode selection | `ModeSelector.tsx` |
| TaskHeader | Task title/controls | `TaskHeader.tsx` |
| TaskActions | Task action buttons | `TaskActions.tsx` |

---

## Approval Components

| Component | Purpose |
|-----------|---------|
| AutoApproveDropdown | Auto-approval settings |
| AutoApproveMenu | Approval menu |
| BatchDiffApproval | Batch diff approval |
| BatchFilePermission | File permission batch |

---

## Checkpoint Components

| Component | Purpose |
|-----------|---------|
| CheckpointRestoreDialog | Restore dialog |
| CheckpointMenu | Checkpoint menu |
| CheckpointSaved | Confirmation |
| CheckpointWarning | Warnings |

---

## Browser Components

| Component | Purpose |
|-----------|---------|
| BrowserSessionRow | Browser session display |
| BrowserActionRow | Browser action display |
| BrowserSessionStatusRow | Session status |

---

## Context Components

| Component | Purpose |
|-----------|---------|
| ContextWindowProgress | Token usage display |
| CodeIndexPopover | Code index status |
| IndexingStatusBadge | Indexing progress |

---

## Search Components

| Component | Purpose |
|-----------|---------|
| CodebaseSearchResult | Single result |
| CodebaseSearchResultsDisplay | Results list |

---

[← Back to Webview UI](../../Feature-Index.md)
