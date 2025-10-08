# LLM Autocompletion Tests

Standalone test suite for AutoTriggerStrategy with real LLM calls using approval testing.

## Approval Testing

This test suite uses approval testing instead of regex pattern matching to validate LLM autocompletion outputs.

### How It Works

1. **First Run**: When a test runs and produces output that hasn't been seen before, the runner will:

    - Display the test input and output
    - Ask you whether the output is acceptable
    - Save your decision to `approvals/{category}/{test-name}/approved.N.txt` or `rejected.N.txt`

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

# Run a single test
pnpm run test closing-brace
```

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

## Notes

- The `approvals/` directory is gitignored
- Each approved/rejected output gets a unique numbered file
- Tests only prompt for input in the terminal when output is new
- The test summary at the end shows how many passed/failed
