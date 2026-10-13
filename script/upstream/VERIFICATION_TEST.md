# Verification test

Use this checklist after an upstream sync on the v2 line. The Kilo executable on `v2` must keep working (D2). Unit tests and typecheck do not count as this test.

Run the CLI only through `bun dev` (`script/dev-isolated.ts`), with a fresh profile for each test. Never run `opencode`, `dev:live` or `bun run --cwd packages/cli` directly: they use the installed OpenCode data and service. The `vscode-self-test` harness and the commands below are described in `.kilo/skills/v2-migration/SKILL.md`, section "Self-test the CLI".

## Quick check without UI

```bash
bun install
env KILO_V2_PROFILE=$(mktemp -d) bun dev run --standalone "Reply with only the word ok."
```

Expected: the answer `ok`, no error.

## TUI check (skill harness)

Start the TUI signed out (`env XDG_DATA_HOME=$T/empty KILO_V2_PROFILE=$T/profile bun <v2>/script/dev-isolated.ts --standalone`), then:

- The home screen shows `ctrl+p commands`.
- Send a prompt on the free model (`kilo/kilo-auto/free`, or the default free model when signed out):

  ```text
  What is 2 + 2? Reply with only the number.
  ```

  Expected: `4`.

- Type `/connect`. Expected: the provider list shows Kilo Gateway. Press Escape before any credential input.
- `logs` prints no `level=ERROR` lines.

## More scenarios when the sync touched these areas

- Two subagents in parallel (`Use two subagents in parallel. Have one run date, and the other run whoami.`), with a permission prompt.
- A queued follow-up message while the agent is busy (`What is 2 + 2?`).
- A question with options (`What is my favourite animal? Please provide a few options for me to choose from.`).
- Change the model (`Control+x`, then `m`) and ask again.
- An `@` mention attaches a file and the agent reads it.

Record each scenario with pass, fail or blocked in the sync PR.
