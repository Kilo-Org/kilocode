# Plan: Add "Create PR" Button to Agent Manager

## Overview

Add a button next to the existing "Finish worktree" button that sends PR creation instructions to the agent, letting it handle git operations (diff, commit, push, gh pr create) naturally.

## Key Insight

Instead of building complex PR automation, we send instructions to the agent. The agent:

1. Checks gh CLI is installed and authenticated (fail fast)
2. Analyzes changes and proposes clean branch name, commit message, PR title/description
3. **Asks user to confirm BEFORE any irreversible action**
4. Only after confirmation: commits, pushes to clean branch name, creates PR

## Workflows Handled

| Scenario | Flow |
|----------|------|
| **PR button while running** | Agent proposes details → user confirms → commits → pushes → creates PR |
| **PR button after commit button** | Agent proposes details → user confirms → pushes → creates PR |
| **gh CLI not ready** | Agent asks user to install/authenticate before proceeding |

## UI Placement

The PR button goes next to the existing "Finish worktree" button (GitBranch icon):

- Both buttons only visible for worktree agents (`parallelMode?.enabled`)
- GitBranch icon = "Finish worktree" (existing)
- GitPullRequest icon = "Create PR" (new)

## Files to Modify

### 1. `webview-ui/src/kilocode/agent-manager/components/ChatInput.tsx`

- Add `showCreatePR` prop
- Add `parentBranch` prop (needed for instruction message)
- Add PR button (GitPullRequest icon) next to existing GitBranch button
- Button visible when `showCreatePR` prop is true
- **Important**: Update hint text `right-[70px]` to `right-[100px]` to prevent overlay with 4 buttons

### 2. `webview-ui/src/kilocode/agent-manager/components/SessionDetail.tsx`

- Calculate `canCreatePR` visibility:
  - Session has `parallelMode?.enabled` (worktree agent)
  - Session has `parallelMode?.branch`
  - Session status is "running" OR "done"/"stopped"/"error" (can resume)
- Pass `showCreatePR={canCreatePR}` to ChatInput
- Pass `parentBranch={selectedSession.parallelMode?.parentBranch}` to ChatInput

### 3. `webview-ui/src/i18n/locales/en/agentManager.json`

- Add translation key:
  - `"chatInput.createPRTitle"`: "Create pull request"

### 4. All other locale files

Add translations for the new key to: ar, ca, cs, de, es, fr, hi, id, it, ja, ko, nl, pl, pt-BR, ru, th, tr, uk, vi, zh-CN, zh-TW

## Implementation Details

### PR Instruction Template

```typescript
const createPRInstructions = (branch: string, parentBranch: string) => `
The user wants to create a pull request.

Local branch: ${branch}
Target branch: origin/${parentBranch}

Follow these steps:

1. First, verify gh CLI is ready by running: gh auth status
   - If gh is not installed, ask the user to install it: https://cli.github.com/
   - If not authenticated, ask the user to run: gh auth login
   - Do not proceed until gh is ready.

2. Run git status to check for uncommitted changes

3. Run git diff to understand what changes exist (both staged and unstaged)

4. Based on the changes, prepare suggestions for the user:
   - Propose a CLEAN branch name following conventions (e.g., feat/description, fix/description, docs/description)
     Do NOT suggest the auto-generated local branch name "${branch}" - always propose a better name.
   - Propose a descriptive commit message (if there are uncommitted changes)
   - Propose a PR title (under 80 chars)
   - Propose a PR description (concise summary)

5. STOP and present your suggestions to the user. Ask them to confirm or edit:
   - Branch name for the PR (your clean suggestion, not the auto-generated one)
   - Commit message (if applicable)
   - PR title
   - PR description

   DO NOT commit, push, or create the PR until the user explicitly confirms.

6. Once the user confirms, execute in this order:
   a. If there are uncommitted changes, commit with the confirmed message
   b. Push to origin with the confirmed branch name:
      git push origin ${branch}:<confirmed-branch-name>
   c. Create the PR: gh pr create --base ${parentBranch} --head <confirmed-branch-name> --title "<confirmed-title>" --body "<confirmed-description>"

If any step fails, ask the user for help.
`
```

### Button Click Handler

```typescript
const handleCreatePR = () => {
  const instructions = createPRInstructions(branch, parentBranch)

  if (isSessionCompleted) {
    // Resume session with PR instructions
    vscode.postMessage({
      type: "agentManager.resumeSession",
      sessionId,
      content: instructions,
    })
  } else {
    // Queue message for running session
    const queuedMsg = addToQueue({ sessionId, content: instructions })
    if (queuedMsg) {
      vscode.postMessage({
        type: "agentManager.messageQueued",
        sessionId,
        messageId: queuedMsg.id,
        content: instructions,
      })
    }
  }
}
```

### Button UI (in ChatInput.tsx floating actions)

```tsx
{showCreatePR && (
  <StandardTooltip content={t("chatInput.createPRTitle")}>
    <button
      aria-label={t("chatInput.createPRTitle")}
      onClick={handleCreatePR}
      className={buttonClasses}
    >
      <GitPullRequest size={14} />
    </button>
  </StandardTooltip>
)}
```

## Verification

1. **Build check**: `pnpm compile` should pass
2. **Test UI**:
   - Start a parallel mode session
   - Verify PR button appears when session has a branch
   - Click button → agent receives instructions
   - Agent performs git operations and creates PR
3. **Test resume**:
   - Let session complete (status "done")
   - Click PR button → session resumes with instructions
4. **Test gh CLI not installed**:
   - Agent should detect and ask user to install/authenticate

## Out of Scope

- No new backend message types needed
- No changes to AgentManagerProvider.ts
- Uses existing resumeSession and messageQueued flows
