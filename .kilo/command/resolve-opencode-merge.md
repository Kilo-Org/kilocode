---
description: Resolve one opencode upstream merge conflict
---

## Intro

In this project we're merging from upstream opencode into our fork kilocode.

You can check upstream opencode in the worktree `.worktrees/opencode-merge/opencode`.

You can check kilocode main in the worktree `.worktrees/opencode-merge/kilo-main`.

To see the original merge conflicts you can check the worktree `.worktrees/opencode-merge/auto-merge`.

The code from the fork kilocode is contained within kilocode markers.

kilocode markers are comments that start with kilocode_change, if the change is a single line, you'll see a `// kilocode_change` at the end, or sometimes in the line above.

If the change is multiline, you'll see a block like this

```ts
// kilocode_change start - Some description
... code
... code
... code
// kilocode_change end
```

## Goal

I want you to address the files with merge conflicts in this folder. The goal here is to adopt upstream's code whenever possible, including new architecture changes.

## Procedure

We will work one file at a time. The path to work on is provided in `$ARGUMENTS`.

Read from `.worktrees/opencode-merge/auto-merge` what the conflicts were, and analyze how it should be resolved.

You can use `script/upstream/find-conflict-markers.sh <file>` to locate merge conflict markers in a file. Use it with the current file path, and with `.worktrees/opencode-merge/auto-merge/<file>` when inspecting the automated merge snapshot.

I have already taken theirs in most of these files, in others I have left the conflict there. Either way, I want you to look at `.worktrees/opencode-merge/auto-merge` and find the bits we added, which will have kilocode markers.

You need to inspect what's causing the conflict and prepare a fix, which most of the time will be adding our kilocode code to upstream's.

You might notice our code is valid, but doesn't use opencode's newest architecture. If that's the case you need to let me know so that the kilocode code is refactored, and I'll approve it.

You might also notice the kilocode code no longer fits in this file, because upstream moved that logic to a different file. If that's the case you need to let me know and we'll add it in the other file.

Sometimes you will find a file has been deleted upstream, if that's the case analyze if the kilocode changes we had there should be ported to a different file.

Maintain the same texts and the same code for the kilocode specific code as can be seen in `.worktrees/opencode-merge/auto-merge`. Do not edit the comments, don't add extra info in the comments.

If something was removed from upstream and the tests fail because of this, we need to remove the tests, not add the file back.

## Code previously modified

You might notice that even though I have taken theirs in several of these files, there are some differences already with `.worktrees/opencode-merge/opencode`, this is because I already used a tool that renames some variables, from things like `OPENCODE_KEY` to `KILO_KEY`. In that case you don't need to add kilocode markers or do anything. Don't add any other kilocode markers that are not in the files with conflicts.

## Moving to next file

When you're done with the file, you should only say "Next".

First file I want you to work on is `$ARGUMENTS`.
