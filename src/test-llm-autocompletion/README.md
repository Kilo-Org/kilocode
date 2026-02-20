# LLM Autocompletion Tests

Standalone approval-test suite for `AutocompleteInlineCompletionProvider` using **real LLM calls**.

## Setup

```bash
cd src/test-llm-autocompletion
cp .env.example .env
```

Set your kilocode API key in `.env`.

## What “approval testing” means here

- First time a test produces a **new** completion, you’ll be asked to approve/reject it.
- The decision is stored under `approvals/<category>/<test>/approved|rejected/*.txt`.
- Next runs:
    - matches an approved output → **pass**
    - matches a rejected output → **fail**
    - unseen output → prompt again (unless using `--skip-approval` / `--opus-approval`)

## Run tests

```bash
# All tests
pnpm run test

# Verbose
pnpm run test:verbose

# Single test (substring match)
pnpm run test closing-brace

# Repeat runs (works with single test or all)
pnpm run test --runs 5
pnpm run test closing-brace --runs 5
pnpm run test -r 5
```

### Non-interactive / CI mode

```bash
# Don’t prompt; fail only on known rejected outputs.
# New outputs become "unknown".
pnpm run test --skip-approval
pnpm run test -sa
```

### Opus auto-approval (batching new outputs)

```bash
# Uses Claude Opus to auto-judge new outputs as APPROVED/REJECTED
pnpm run test --opus-approval
pnpm run test -oa
```

### Clean up approvals for removed/renamed test cases

```bash
pnpm run clean
```

## Model + completion strategy

Default model: `mistralai/codestral-2508` (supports FIM).

```bash
# Override model
LLM_MODEL=anthropic/claude-3-haiku pnpm run test
```

The suite mirrors production behavior via `AutocompleteProviderTester`:

- If the model supports FIM → `autocomplete-provider-fim` (uses `FimPromptBuilder`)
- Otherwise → `autocomplete-provider-holefiller` (uses `HoleFiller`)

## HTML report

```bash
pnpm run test report
```

Outputs to `html-output/` (gitignored):

- `html-output/index.html` overview by category
- per-test pages with input + all approved/rejected outputs
