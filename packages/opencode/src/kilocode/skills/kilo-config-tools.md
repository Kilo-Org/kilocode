## Permissions

Scalar form applies to all patterns. Object form maps glob patterns to actions. Evaluated top-to-bottom; the last matching rule wins. Put broad fallback patterns first, then specific overrides.

```jsonc
{
  "permission": {
    "bash": "allow", // scalar: allow all bash
    "edit": {
      // object: pattern-matched
      "*": "ask", // fallback
      "src/**": "allow",
      "*.lock": "deny",
    },
    "read": "ask",
    "skill": { "my-skill": "allow" },
    "external_directory": "deny",
  },
}
```

Actions: `"allow"`, `"ask"`, `"deny"`. Set `null` to delete an inherited key.

Tool permissions: `read`, `edit`, `glob`, `grep`, `list`, `bash`, `task`, `webfetch`, `websearch`, `semantic_search`, `kilo_memory_save`, `kilo_memory_recall`, `lsp`, `skill`, `external_directory`, `todowrite`, `todoread`, `question`, `doom_loop`.

## MCP Servers

```jsonc
{
  "mcp": {
    "local-server": {
      "type": "local",
      "command": ["node", "server.js"],
      "environment": { "PORT": "3000" },
      "enabled": true,
      "timeout": 10000,
    },
    "remote-server": {
      "type": "remote",
      "url": "https://mcp.example.com",
      "headers": { "Authorization": "Bearer ..." },
      "oauth": { "clientId": "...", "scope": "read" },
      "enabled": true,
    },
  },
}
```

Disable an inherited server: `{ "server-name": { "enabled": false } }`.

### MCP Tool Permissions

MCP tools use the same permission system as built-in tools. Each MCP tool's permission key is `{server}_{tool}` (e.g. `github_create_pull_request`). Glob patterns are supported.

```jsonc
{
  "permission": {
    // Require approval for all tools on this server by default
    "github_*": "ask",

    // Auto-approve a specific safe tool
    "github_get_file_contents": "allow",

    // Block a dangerous tool entirely
    "github_delete_file": "deny",
  },
}
```

Rules are evaluated top-to-bottom — the **last** matching rule wins. Put broad patterns first, then specific overrides after.
