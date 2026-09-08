---
"@kilocode/cli": minor
"kilo-code": minor
"@kilocode/kilo-ui": patch
---

Keep working toward a session goal with `/goal`, with shared pause, resume, and clear controls in the terminal and VS Code. Pause goals after no-action replies, terminal failures, Stop, new messages, and backend restarts. Rename custom commands or MCP prompts named `goal` to use this reserved command. Show a labeled Goal icon with hover details while work runs.

Compose multiline goals with images and file attachments in VS Code. Select `/goal` to enter goal mode, or cancel to keep the draft as ordinary chat. Keep drafts and attachments when submission fails.

Keep the current goal running when replacement attachments are invalid. Make pending Goal submissions read-only, and preserve the draft when Cancel exits Goal mode before acknowledgement.

Disable clarification questions during active goals and delegated work while keeping permission approvals unchanged. Make safe, reversible decisions autonomously and report completion or blockers.

Retain Active, Complete, Blocked, and Paused goals with their objective and reason until explicitly cleared. Let the working model explicitly report completion or a blocker with the Goal-only reporting tool, without a separate evaluator or independent verification claim. Pause no-action turns that have no explicit report. Keep complete goals complete after a backend restart and label their resume action as Restart.
