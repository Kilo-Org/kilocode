---
"@kilocode/cli": patch
---

Fix CLI interactive prompts (arrow key navigation) not working on Windows

The inquirer v13+ upgrade introduced stricter TTY raw mode requirements. This fix ensures raw mode is properly enabled before inquirer prompts, restoring arrow key navigation in list selections like provider choice during `kilocode auth`.
