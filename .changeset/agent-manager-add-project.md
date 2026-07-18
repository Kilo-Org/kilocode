---
"kilo-code": minor
---

Add an **Add project** flow to the Agent Manager sidebar and a multi-project accordion layout. Users can now register an external repository (or any local Git folder) as a project, and the sidebar renders one collapsible accordion per registered project with a header showing the project label, worktree count, and per-project actions (new worktree, add to VS Code workspace, remove project). Unsupported filesystem schemes and non-Git folders are rejected with a clear error; registering the same canonical root twice is a no-op. The single-project UX is preserved unchanged when zero or one project is registered.