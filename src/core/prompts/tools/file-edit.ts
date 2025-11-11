export function getFileEditDescription(): string {
	return `## file_edit

**Description**: Perform targeted text replacements within a single file without constructing manual diff blocks.

**When to use**:
- You know the exact text that should be replaced and its updated form.
- You want a deterministic edit without invoking Fast Apply models.
- You need to delete or rewrite a block of code but don't want to craft search/replace diff markers manually.

**Parameters**:
1. \`target_file\` — Relative path to the file you want to modify.
2. \`old_string\` — The current text you expect to replace. Provide enough context for a unique match; this can be empty to replace the entire file.
3. \`new_string\` — The text that should replace the match. Use an empty string to delete the matched content.
4. \`replace_all\` (optional, default false) — Set to true to replace every occurrence of the matched text. Leave false to replace only a single uniquely identified match.

**Guidance**:
- Prefer multi-line snippets for \`old_string\` to help the tool locate the correct section.
- If multiple matches exist, either refine \`old_string\` or set \`replace_all\` to true when you intend to change every occurrence.
- The tool shows a diff before applying changes so you can confirm the result.`
}
