# Code Cleanup Instructions

## CRITICAL: Protected Modules

**AUTOCOMPLETE AND NEXTEDIT CODE MUST NOT BE MODIFIED**

The following directories contain critical functionality that must be preserved:

- `core/autocomplete/**` - All autocomplete-related code
- `core/nextEdit/**` - All nextEdit-related code

**Do not:**

- Remove any code from these directories
- Unexport any functions, types, or classes from these directories

Even if linters or analysis tools report code as "unused", it may be used through dynamic imports, reflection, or other mechanisms that static analysis cannot detect. These modules are off-limits for cleanup operations.

## Objective

Safely remove unnecessary code that isn't essential for running or testing autocomplete, NextEdit, and tree-sitter functionality.

## Prerequisites

You have found dead code. These instructions assume you have already found dead code, e.g. by following [`DEAD_CODE_DETECTION_GUIDE.md`](DEAD_CODE_DETECTION_GUIDE.md). This document does not describe how to find it; just how to remove it CLEANLY.

---

## Process for Each Removal

You will be given a specific code location (file path and line numbers) containing a method, function, or feature that is confirmed to be unnecessary. You'll try removing the code, and verify that no new warnings have appeared; finally, assuming everything went well, you will "git commit" your changes.

### Steps to Follow:

#### 1. Analyze the Code

- Read the target file and understand what the code does
- Check if it's directly related to autocomplete, NextEdit, or tree-sitter
- Trace dependencies to see what depends on this code
- If unsure whether it's used, keep it (better safe than broken)

**Think in layers:** A feature is often more than just one method - it's an implementation + interface declaration + types + helpers + imports. When it's trivial to do so, remove all layers parts together. On the other hand, when in doubt only remove the directly unused bit of code.

#### 2. Remove the Code

- Remove the target code
- If the target code is part of an interface, check to see if the interface member doesn't need removing too.
- If it's a parameter, check the caller - don't remove parameters used by autocomplete/nextedit/treesitter, but otherwise please do remove both parameters and arguments when unused.
- If it's a variable assignment and the variable is never read, consider removing the expression assigned to the variable as well; side effects are a concern and should be checked for, but are rare.
- Do NOT remove code that's part of autocomplete, NextEdit, or tree-sitter
- Do NOT remove code that's directly supporting autocomplete, NextEdit, or tree-sitter

#### 3. Verify Safety

Run verification commands:

```bash
npm run typecheck    # Must ONLY contain errors about unused code; no other errors
npm run lint         # Must ONLY contain errors about unused code; no other errors
npm test             # Must pass
```

**A removal is safe if ALL of these conditions are met:**

- ✅ Tests pass (`npm test`), and all tests are present (43 test files, 965 tests)
- ✅ Typecheck warnings/errors contain at most errors about unused code (we'll deal with those later)
- ✅ ESLint warnings/errors contain at most errors about unused code (we'll deal with those later)

**If typecheck/lint errors appeared (other than those warning about unused code) or tests fail:**

- Check if the new warnings/errors/failures aren't easily fixed. If you make any changes, redo the verification step.
- If you can't fix the error, or are concerned that the fix is undesirable, revert your changes

#### 4. Git Commit

IMPORTANT Create a git commit with a message describing:

- What was removed
- Why it's safe to remove
- Any caveats or concerns
- What cascading deletions were included
- Only skip the git commit when there's nothing to commit i.e. lint/typecheck/test failures were unresolvable.

#### 5. Report Results

Use attempt_completion to report:

- **Success**: What was removed, commit SHA, why it's safe. DO NOT REPORT SUCCESS unless you committed the changes!
- **Failure**: Why the code is necessary and was kept
