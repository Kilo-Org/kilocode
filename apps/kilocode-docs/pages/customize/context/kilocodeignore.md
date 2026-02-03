---
title: ".kilocodeignore"
description: "Control which files Kilo Code can access"
---

# .kilocodeignore

## Overview

`.kilocodeignore` is a root-level file that tells Kilo Code which files and folders it should not access. It uses standard `.gitignore` pattern syntax, but it only affects Kilo Code's file access, not Git.

If no `.kilocodeignore` file exists, Kilo Code can access all files in the workspace.

## Quick Start

1. Create a `.kilocodeignore` file at the root of your project.
2. Add patterns for files or folders you want Kilo Code to avoid.
3. Save the file. Kilo Code will pick up the changes automatically.

Example:

```txt
# Secrets
.env
secrets/
**/*.pem
**/*.key

# Build output
dist/
coverage/

# Allow a specific file inside a blocked folder
!secrets/README.md
```

## Pattern Rules

`.kilocodeignore` follows the same rules as `.gitignore`:

- `#` starts a comment
- `*` and `**` match wildcards
- Trailing `/` matches directories only
- `!` negates a previous rule

Patterns are evaluated relative to the workspace root.

## What It Affects

Kilo Code checks `.kilocodeignore` before accessing files in tools like:

- [`read_file`](/docs/automate/tools/read-file)
- [`write_to_file`](/docs/automate/tools/write-to-file)
- [`apply_diff`](/docs/automate/tools/apply-diff)
- [`delete_file`](/docs/automate/tools/delete-file)
- [`execute_command`](/docs/automate/tools/execute-command)
- [`list_files`](/docs/automate/tools/list-files)

If a file is blocked, Kilo Code will return an "access denied" message and suggest updating your `.kilocodeignore` rules.

## Visibility in Lists

By default, ignored files are hidden from file lists. You can show them with a lock icon by enabling:

Settings -> Context -> **Show .kilocodeignore'd files in lists and searches**

## Checkpoints vs .kilocodeignore

Checkpoint tracking is separate from file access rules. Files blocked by `.kilocodeignore` can still be checkpointed if they are not excluded by `.gitignore`. See the [Checkpoints](/docs/code-with-ai/features/checkpoints) documentation for details.

## Troubleshooting

- **Kilo can't access a file you want:** Remove or narrow the matching rule in `.kilocodeignore`.
- **A file still appears in lists:** Check the setting that shows ignored files in lists and searches.
