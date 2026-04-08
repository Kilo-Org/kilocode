---
title: Dev Container Persistence
description: How to preserve devil Code threads and settings in dev containers
---

# Dev Container Persistence

When using devil Code in development containers (VS Code Dev Containers, GitHub Codespaces, etc.), your threads and settings can persist across container rebuilds by properly configuring volume mounts.

## Why Persistence Matters

Dev containers are ephemeral by default - when you rebuild the container, all data is lost unless explicitly persisted. devil Code stores important data including:

- **Conversation threads**: Your ongoing discussions with devil Code
- **Settings**: API configurations, custom modes, and preferences
- **Cache**: Vector store for code indexing and browser tool data

## Required Configuration

The devil Code dev container is pre-configured with named volumes to preserve your data. If you're setting up your own dev container, add these mounts to your `devcontainer.json`:

```json
{
  "name": "Your Project",
  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",
  "mounts": [
    {
      "source": "devilcode-global-storage",
      "target": "/root/.vscode-remote/data/User/globalStorage/devilcode.devil-code",
      "type": "volume"
    },
    {
      "source": "devilcode-settings",
      "target": "/root/.vscode-remote/data/User/settings",
      "type": "volume"
    }
  ]
}
```

## Storage Locations

| Data Type    | Container Path                                                            |
| ------------ | ------------------------------------------------------------------------- |
| Threads      | `/root/.vscode-remote/data/User/globalStorage/devilcode.devil-code/tasks/`  |
| Settings     | `/root/.vscode-remote/data/User/settings/`                                |
| Cache        | `/root/.vscode-remote/data/User/globalStorage/devilcode.devil-code/cache/`  |
| Vector Store | `/root/.vscode-remote/data/User/globalStorage/devilcode.devil-code/vector/` |

## Troubleshooting

### Threads Don't Appear After Rebuild

1. **Check volume attachment**: Ensure the dev container has the volumes attached
2. **Verify volume contents**: Check that the volume contains your data
3. **Rebuild with volumes**: Use `devcontainer rebuild` instead of `devcontainer up --rebuild`

### Volumes Lost

If named volumes are accidentally deleted:

1. Threads cannot be automatically recovered
2. Start new conversations with devil Code
3. Consider implementing a backup strategy for important threads

### Manual Backup

To manually back up your threads:

```bash
# Copy thread data from the container
docker cp <container-name>:/root/.vscode-remote/data/User/globalStorage/devilcode.devil-code ./devilcode-backup
```

## Custom Storage Path

For advanced configurations, you can specify a custom storage path:

1. Add a bind mount to your `devcontainer.json`:

```json
"mounts": [
  {
    "source": "${localWorkspaceFolder}/.devilcode-data",
    "target": "/home/vscode/devilcode-data",
    "type": "bind"
  }
]
```

2. Set the custom storage path in VS Code settings:
   - Open Settings (`Ctrl+,` or `Cmd+,`)
   - Search for "devil Code: Custom Storage Path"
   - Enter: `/home/vscode/devilcode-data`

## Best Practices

1. **Use named volumes** for automatic persistence
2. **Back up important threads** before major container changes
3. **Avoid deleting volumes** during cleanup
4. **Test persistence** by rebuilding and verifying threads remain

## GitHub Codespaces

GitHub Codespaces automatically persists your VS Code settings and extensions. For devil Code threads, the pre-configured dev container includes the necessary volume mounts.

If using a custom Codespace configuration, ensure the mounts from the Required Configuration section are included.
