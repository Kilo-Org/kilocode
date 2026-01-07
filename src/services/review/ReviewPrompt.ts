/**
 * Review Prompt Template for local code reviews
 *
 * Builds a comprehensive review prompt adapted from cloud review prompts,
 * optimized for local git-based reviews without external integrations.
 */

import { ReviewContext } from "./ReviewService"

/**
 * Builds the review prompt with git diff context
 */
export function buildReviewPrompt(context: ReviewContext, userInput: string): string {
	const scopeDescription =
		context.scope === "uncommitted"
			? "Reviewing **uncommitted changes** (staged and unstaged)"
			: `Reviewing **branch diff**: \`${context.currentBranch}\` vs \`${context.baseBranch}\``

	const userInstructions = userInput.trim()
		? `
## Additional Instructions from User
${userInput.trim()}
`
		: ""

	return `<explicit_instructions type="code_review">
You are performing a local code review. Your role is advisory - provide clear, actionable feedback on code quality and potential issues.

## Review Scope
${scopeDescription}

**Current Branch:** \`${context.currentBranch}\`
${context.baseBranch ? `**Base Branch:** \`${context.baseBranch}\`` : ""}

## Files Changed
${context.filesSummary}

## Diff Content
\`\`\`diff
${context.diff}
\`\`\`
${userInstructions}
---

## Review Guidelines

### Phase 1: Understand the Change
1. Read through the entire diff to understand the overall purpose
2. Identify the main changes and their intent
3. Note any patterns or architectural decisions

### Phase 2: Gather Context (if needed)
If the diff context is insufficient to understand the change:
- Use \`read_file\` to examine the full file for better context
- Trace function calls to understand impact
- Check related files if the change affects shared code

### Phase 3: Review with Confidence Levels
**Only report issues where you have HIGH CONFIDENCE.** Use these thresholds:

| Severity | Confidence | Examples |
|----------|------------|----------|
| **CRITICAL** | 95%+ | Security vulnerabilities, data loss risks, crashes, authentication bypasses |
| **WARNING** | 85%+ | Bugs, logic errors, performance issues, unhandled errors |
| **SUGGESTION** | 75%+ | Code quality improvements, best practices, maintainability |

**Below 75% confidence: DO NOT comment** - you likely lack sufficient context.

### Focus Areas (Priority Order)
1. **Security**: Injection vulnerabilities, auth issues, data exposure, XSS, CSRF
2. **Bugs**: Logic errors, null/undefined handling, race conditions, edge cases
3. **Performance**: Inefficient algorithms, unnecessary operations, memory leaks
4. **Error Handling**: Missing try-catch, unhandled promises, poor error messages
5. **Code Quality**: Readability, DRY violations, unclear logic

### What NOT to Flag
- Style preferences that don't affect functionality
- Minor naming suggestions (unless truly confusing)
- Low-confidence speculation
- Patterns that are clearly intentional or match existing codebase conventions
- TODO comments (unless blocking production)

---

## Output Format

### Summary
Provide a brief (2-3 sentences) description of what this change does and your overall assessment.

### Issues Found

If issues are found, present them in this table:

| Severity | File:Line | Issue |
|----------|-----------|-------|
| CRITICAL | path/file.ts:42 | Brief description |
| WARNING | path/file.ts:78 | Brief description |
| SUGGESTION | path/file.ts:95 | Brief description |

If no issues found, state: "No issues found."

### Detailed Findings

For each issue, provide:

#### [SEVERITY] Issue Title
**File:** \`path/to/file.ts:line\`
**Confidence:** X%

**Problem:**
Clear explanation of what's wrong and why it matters.

**Code:**
\`\`\`language
// The problematic code
\`\`\`

**Suggestion:**
\`\`\`language
// The recommended fix
\`\`\`

---

### Recommendation

Conclude with ONE of these recommendations:

- **APPROVE**: No issues found. Code is ready to commit/merge.
- **APPROVE WITH SUGGESTIONS**: Minor improvements possible but not blocking. Safe to proceed.
- **NEEDS CHANGES**: Issues should be addressed before committing/merging.
- **NEEDS DISCUSSION**: Architectural or design questions that need team input.

</explicit_instructions>
`
}
