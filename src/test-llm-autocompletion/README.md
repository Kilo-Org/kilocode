# LLM Autocompletion Tests

Standalone test suite for GhostInlineCompletionProvider with real LLM calls using approval testing.

## Setup

1. Copy `.env.example` to `.env`:
    ```bash
    cd src/test-llm-autocompletion
    cp .env.example .env
    ```
    Then configure your kilocode API key in `.env`:

## Approval Testing

This test suite uses approval testing instead of regex pattern matching to validate LLM autocompletion outputs.

### How It Works

1. **First Run**: When a test runs and produces output that hasn't been seen before, the runner will:

    - Display the test input and output
    - Ask you whether the output is acceptable
    - Save your decision to `approvals/{category}/{test-name}.approved.N.txt` or `{test-name}.rejected.N.txt`
    - File numbers are globally unique across approved and rejected files (e.g., `approved.1.txt`, `rejected.2.txt`, `approved.3.txt`)

2. **Subsequent Runs**:
    - If the output matches a previously approved file, the test passes
    - If the output matches a previously rejected file, the test fails
    - If the output is new, you'll be asked again

### Directory Structure

```
approvals/
├── basic-syntax/
│   ├── closing-brace/
│   │   ├── approved/
│   │   │   ├── approved.1.txt
│   │   │   └── approved.2.txt
│   │   └── rejected/
│   │       └── rejected.1.txt
│   └── semicolon/
│       └── approved/
│           └── approved.1.txt
└── property-access/
    └── ...
```

## Running Tests

```bash
# Run all tests
pnpm run test

# Run with verbose output
pnpm run test:verbose

# Run without interactive approval (fail if not already approved)
pnpm run test --skip-approval

# Run with Opus auto-approval (uses Claude Opus to judge completions)
pnpm run test --opus-approval
# Or short form
pnpm run test -oa

# Run a single test
pnpm run test closing-brace

# Clean up orphaned approval files
pnpm run clean

# Combine flags
pnpm run test --verbose --skip-approval
pnpm run test --verbose --opus-approval
```

### Completion Strategy

The test suite uses `GhostProviderTester` which mirrors the behavior of `GhostInlineCompletionProvider`:

- Uses `LLMClient` for API calls (standalone, no VSCode dependencies)
- **Auto-selects strategy** based on model capabilities:
    - **FIM** (Fill-In-Middle): Used when the model supports FIM (e.g., Codestral). Uses `FimPromptBuilder` for prompt building.
    - **HoleFiller**: Used for chat-based models without FIM support. Uses `HoleFiller` for prompt building.
- Uses the same prompt building code as the production extension

You can configure the model via the `LLM_MODEL` environment variable:

```bash
# Use default model (mistralai/codestral-2508 - supports FIM)
pnpm run test

# Use a different model
LLM_MODEL=anthropic/claude-3-haiku pnpm run test
```

**Strategy Names in Output:**

- `ghost-provider-fim` - FIM strategy (model supports FIM)
- `ghost-provider-holefiller` - HoleFiller strategy (chat-based)

### Clean Command

The `clean` command removes approval files for test cases that no longer exist:

```bash
pnpm run clean
```

This is useful when you've deleted or renamed test cases and want to clean up the corresponding approval files. The command will:

- Scan all approval files in the `approvals/` directory
- Check if each approval corresponds to an existing test case
- Remove approvals for test cases that no longer exist
- Report how many files were cleaned

### Skip Approval Mode

Use `--skip-approval` (or `-sa`) to run tests in CI/CD or when you want to avoid interactive prompts:

- Tests that match previously approved outputs will **pass**
- Tests that match previously rejected outputs will **fail**
- Tests with new outputs (not previously approved or rejected) will be marked as **unknown** without prompting

The accuracy calculation only includes passed and failed tests, excluding unknown tests. This gives you a true measure of how the model performs on known cases.

This is useful for:

- Running tests in CI/CD pipelines
- Regression testing to ensure outputs haven't changed
- Validating that all test outputs have been reviewed

### Opus Auto-Approval Mode

Use `--opus-approval` (or `-oa`) to automatically judge completions using Claude Opus:

```bash
pnpm run test --opus-approval
pnpm run test -oa
```

When a new output is detected that hasn't been previously approved/rejected:

1. Opus evaluates whether the completion is useful (meaningful code) vs not useful (trivial like semicolons)
2. Opus responds with APPROVED or REJECTED based on its judgment
3. The result is saved to the approvals directory for later manual review

Opus considers a suggestion **useful** if it:

- Provides meaningful code that helps the developer
- Completes a logical code pattern
- Adds substantial functionality (not just trivial characters)
- Is syntactically correct and contextually appropriate

Opus considers a suggestion **not useful** if it:

- Only adds trivial characters like semicolons, closing brackets, or single characters
- Is empty or nearly empty
- Is syntactically incorrect or doesn't make sense in context

This is useful for:

- Quickly processing large batches of new test outputs
- Getting consistent, objective judgments on completion quality
- Reducing manual review burden while still saving decisions for later audit

## User Interaction

When new output is detected, you'll see:

```
═════════════════════════════════════════════════════════════════════════════

🔍 New output detected for: basic-syntax/closing-brace

Input:
function test() {\n\t\tconsole.log('hello')<CURSOR>

Output:
}

────────────────────────────────────────────────────────────────────────────

Is this acceptable? (y/n):
```

## Benefits

- **Flexibility**: Accepts any valid output, not just predefined patterns
- **History**: Keeps track of all approved and rejected outputs
- **Interactive**: Only asks for input when truly needed
- **Context-Rich**: Shows the full context when asking for approval
- **Production Parity**: Uses the same prompt building code as `GhostInlineCompletionProvider`

## Notes

- The `approvals/` directory is gitignored
- Each approved/rejected output gets a globally unique numbered file (numbers are unique across both approved and rejected files for the same test case)
- Tests only prompt for input in the terminal when output is new
- The test summary at the end shows how many passed/failed
