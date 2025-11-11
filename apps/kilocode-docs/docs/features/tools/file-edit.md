---
title: file_edit
---

# file_edit

The `file_edit` tool performs targeted string replacements inside an existing file without requiring full diff blocks or a Fast Apply model. It combines deterministic matching with fuzzy fallbacks so you can provide an `old_string` and `new_string`, and the tool will locate and replace the intended section while still showing a diff for review.

## Parameters

- `target_file` (required): Path to the file to modify, relative to the workspace root.
- `old_string` (required): The text you expect to replace. Provide enough context for a unique match. Use an empty string to replace the entire file.
- `new_string` (required): Replacement text. This can be empty when you want to delete the matched block.
- `replace_all` (optional, default `false`): When `true`, every occurrence of the matched text is replaced. When `false`, the tool refuses to apply the change if the match is ambiguous.

## How It Works

1. **Validation** – Ensures required parameters are provided and that `old_string` differs from `new_string`.
2. **Access Checks** – Respects `.rooignore` and write-protection rules before modifying files.
3. **Content Matching** – Searches for `old_string` using multiple strategies:
    - Exact substring matches
    - Trimmed and indentation-insensitive comparisons
    - Context-aware block matching with anchor lines
    - Escaped character normalization and whitespace normalization
4. **Replacement** – Applies the update (single occurrence by default, or all occurrences when `replace_all` is `true`).
5. **Review** – Opens a diff preview for approval before writing changes to disk.

Because the tool still previews differences, you maintain full control over the edit before it is applied.

## When to Use

- You want a precise, deterministic edit without crafting manual `apply_diff` blocks.
- The change is localized and can be described as “replace this text with that text.”
- You need to remove or rewrite a block of code using string-based matching.
- Fast Apply is disabled or unavailable, and you want an alternative to `apply_diff`.

## Tips

- Prefer multi-line `old_string` values for more reliable matching.
- Include surrounding context (such as function signatures and closing braces) when multiple similar blocks exist.
- Set `replace_all` to `true` only when you intentionally want to update each occurrence of the match.
- Use the tool in combination with `read_file` or `search_files` to confirm the exact text you need to replace.

## Comparison to Other Editing Tools

| Tool            | Best For                                               | Notes                                                                               |
| --------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `apply_diff`    | Structured changes with explicit SEARCH/REPLACE blocks | Supports multi-file edits and precise line control via `:start_line:` metadata.     |
| `file_edit`     | String-based replacements with fuzzy matching          | Great when you know the before/after text but want deterministic, model-free edits. |
| `edit_file`     | Morph Fast Apply powered edits                         | Delegates the change to an external model; ideal for large or semantic refactors.   |
| `write_to_file` | Creating or completely replacing files                 | Overwrites entire files or creates new files from scratch.                          |

Choose the tool that best matches your workflow and the level of control you need over the edit.
