---
"@kilocode/cli": minor
---

# Checkpoint Restore

Allows users to restore their conversation to a previous point in time.

## What do we have here?

### View your checkpoints

`/checkpoint list`

This shows all available restore points with:
Hash for the checkpoint
When it was created

### Restore to a checkpoint

`/checkpoint restore abc123...`

You'll see a confirmation showing:
Which checkpoint you're going back to
How many messages will be removed
What will happen to your current work

Choose `Restore` to go back, or `Cancel` to keep working.

### Example

Let's say you asked Kilo CLI to refactor some code, but you don't like the result:

Run `/checkpoint list` to see earlier save points

Find the checkpoint from before the refactoring

Run `/checkpoint restore <hash>` with that checkpoint's hash

Confirm the restore
Your conversation is now back to before the refactoring happened

### Why use checkpoints?

1. Undo mistakes - Go back if something went wrong
2. Try different approaches - Restore and try a different solution
3. Keep working states - Return to a point where everything was working
