# Verification Test

Use this checklist to verify CLI and VS Code extension behavior after upstream merge work.

## CLI

Start the CLI from this branch with `bun install` if dependencies are missing, then `bun run dev` from the repository root. Pass CLI arguments after the script, for example `bun run dev -- help`.

- Ask which model it is using.
- Ask it to use two subagents:
  - One subagent runs `git status`.
  - The other subagent runs either `ls` or `npm install`.
  - Change settings if needed to trigger a permission prompt.
- Quickly ask it a simple follow-up question, such as `What is 2 + 2?`, to verify queued messages work.
- Ask `What is my favourite animal?` and have it provide options.
- Change the model and ask it about the favourite animal again.
- Find `/local-review` and run it.
- Change from Code mode to Ask mode and ask it what it can do.

## VS Code Extension

Start the VS Code extension from this branch with `bun install` if dependencies are missing, then `bun run extension` from the repository root. Use `bun run extension -- --no-build` only when a current build already exists.

Run all CLI verification steps in the VS Code extension, then verify the extension-specific flows:

- Use the diff button in the sidebar next to the Worktree button.
- Use the Worktree button.
- Open history, select a previous conversation, and ask `What's the last thing I asked you?`.
- Create a worktree and ask `In which branch are you?`.
- Open the diff viewer, make a comment, and send it to chat.
- Run permissions on a subagent in a worktree.
- Ask it to read and edit a file by adding a random line.
