# Verification Test

Use this checklist to verify CLI and VS Code extension behavior after upstream merge work.

## CLI

Start the CLI from this branch with `bun install` if dependencies are missing, then `bun run dev` from the repository root. Pass CLI arguments after the script, for example `bun run dev -- help`.

- Ask which model it is using:

  ```text
  Which model are you using?
  ```

- Ask it to use two subagents, changing settings first if needed to trigger a permission prompt:

  ```text
  Use two subagents in parallel. Have one subagent run date, and have the other subagent run whoami.
  ```

  If `date` and `whoami` do not trigger a permission prompt, use:

  ```text
  Use two subagents in parallel. Have one subagent run date, and have the other subagent run npm install.
  ```

- Quickly ask a simple follow-up question to verify queued messages work:

  ```text
  What is 2 + 2?
  ```

- Ask about a favourite animal and have it provide options:

  ```text
  What is my favourite animal? Please provide a few options for me to choose from.
  ```

- Change the model and ask about the favourite animal again:

  ```text
  What is my favourite animal?
  ```

- Find `/local-review` and run it:

  ```text
  /local-review
  ```

- Change from Code mode to Ask mode and ask what it can do:

  ```text
  What can you do in Ask mode?
  ```

## VS Code Extension

Start the VS Code extension from this branch with `bun install` if dependencies are missing, then `bun run extension` from the repository root. Use `bun run extension -- --no-build` only when a current build already exists.

Run all CLI verification steps in the VS Code extension, then verify the extension-specific flows:

- Use the diff button in the sidebar next to the Worktree button.
- Use the Worktree button.
- Open history, select a previous conversation, and ask:

  ```text
  What's the last thing I asked you?
  ```

- Create a worktree and ask:

  ```text
  In which branch are you?
  ```

- Open the diff viewer, make a comment, and send it to chat.
- Run permissions on a subagent in a worktree:

  ```text
  Use a subagent to run whoami in this worktree.
  ```

- Ask it to read and edit a file by adding a random line:

  ```text
  Read README.md and edit it by adding one random test line at the end.
  ```
