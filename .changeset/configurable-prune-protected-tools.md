---
"@kilocode/opencode": minor
---

feat(compaction): add configurable `compaction.protectedTools` to protect additional tools from pruning

The pruner currently only protects the built-in `skill` tool from having its output replaced with `[Old tool result content cleared]`. This makes it impossible for users with MCP-based skill loaders or other context-injecting tools to prevent their content from being silently erased.

This change adds `compaction.protectedTools` to the config schema, allowing users to specify additional tool names that should be exempt from pruning:

```json
{
  "compaction": {
    "protectedTools": ["my_mcp_server_skill_loader"]
  }
}
```

- The built-in `["skill"]` default is always preserved
- User-specified tools are merged with defaults (concat + dedup)
- Multiple config layers are merged correctly via `mergeConfigConcatArrays`
- Fully backward-compatible: no behavior change without explicit config
