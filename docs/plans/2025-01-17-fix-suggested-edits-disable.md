# Fix Suggested Edits Disable Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the `kilo-code.enableCodeActions` setting properly disable "Kilo Code: Suggested Edits" code action.

**Architecture:** The fix adds a configuration check in `GhostCodeActionProvider.provideCodeActions()` to respect the `enableCodeActions` setting, matching the behavior of `CodeActionProvider`.

**Tech Stack:** TypeScript, VSCode Extension API

---

### Task 1: Add enableCodeActions check to GhostCodeActionProvider

**Files:**

- Modify: `src/services/ghost/GhostCodeActionProvider.ts:1-27`

**Step 1: Write the test**

First, let's write a test to verify the behavior. Create a test file:

```typescript
// src/services/ghost/__tests__/GhostCodeActionProvider.spec.ts
import * as vscode from "vscode"
import { GhostCodeActionProvider } from "../GhostCodeActionProvider"

describe("GhostCodeActionProvider", () => {
	let provider: GhostCodeActionProvider
	let mockConfig: any

	beforeEach(() => {
		provider = new GhostCodeActionProvider()
		mockConfig = {
			get: vi.fn(),
		}
		vi.spyOn(vscode.workspace, "getConfiguration").mockReturnValue(mockConfig)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("provideCodeActions", () => {
		it("should return empty array when enableCodeActions is false", () => {
			mockConfig.get.mockReturnValue(false)

			const document = {} as vscode.TextDocument
			const range = new vscode.Range(0, 0, 1, 0)
			const context = {} as vscode.CodeActionContext
			const token = {} as vscode.CancellationToken

			const result = provider.provideCodeActions(document, range, context, token)

			expect(result).toEqual([])
		})

		it("should return code action when enableCodeActions is true", () => {
			mockConfig.get.mockReturnValue(true)

			const document = { uri: vscode.Uri.parse("file:///test.txt") } as vscode.TextDocument
			const range = new vscode.Range(0, 0, 1, 0)
			const context = {} as vscode.CodeActionContext
			const token = {} as vscode.CancellationToken

			const result = provider.provideCodeActions(document, range, context, token)

			expect(result).toHaveLength(1)
			expect(result[0].title).toBe("Kilo Code: Suggested Edits")
		})
	})
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/services/ghost/__tests__/GhostCodeActionProvider.spec.ts`
Expected: FAIL (test will fail because enableCodeActions check doesn't exist yet)

**Step 3: Implement the fix**

Modify `src/services/ghost/GhostCodeActionProvider.ts`:

```typescript
import * as vscode from "vscode"
import { t } from "../../i18n"
import { Package } from "../../shared/package"

export class GhostCodeActionProvider implements vscode.CodeActionProvider {
	public readonly providedCodeActionKinds = {
		quickfix: vscode.CodeActionKind.QuickFix,
	}

	public provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		_context: vscode.CodeActionContext,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
		// Check if code actions are disabled
		if (!vscode.workspace.getConfiguration(Package.name).get<boolean>("enableCodeActions", true)) {
			return []
		}

		const action = new vscode.CodeAction(
			t("kilocode:ghost.codeAction.title"),
			this.providedCodeActionKinds["quickfix"],
		)
		action.command = {
			command: "kilo-code.ghost.generateSuggestions",
			title: "",
			arguments: [document.uri, range],
		}

		return [action]
	}

	public async resolveCodeAction(
		codeAction: vscode.CodeAction,
		token: vscode.CancellationToken,
	): Promise<vscode.CodeAction> {
		if (token.isCancellationRequested) {
			return codeAction
		}
		return codeAction
	}
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/services/ghost/__tests__/GhostCodeActionProvider.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/ghost/GhostCodeActionProvider.ts src/services/ghost/__tests__/GhostCodeActionProvider.spec.ts
git commit -m "fix(chat): respect enableCodeActions setting for Suggested Edits

Fixes #5042

The kilo-code.enableCodeActions setting now properly disables
'Kilo Code: Suggested Edits' code action when set to false."
```

---

## Verification

After implementing the fix:

1. Set `"kilo-code.enableCodeActions": false` in VSCode settings
2. Trigger code actions in a file (Right-click -> Show Code Actions or Cmd+.)
3. Verify "Kilo Code: Suggested Edits" does NOT appear
4. Set `"kilo-code.enableCodeActions": true`
5. Verify "Kilo Code: Suggested Edits" DOES appear
