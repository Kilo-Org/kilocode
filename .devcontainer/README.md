# Kilo Code Development Container

This development container provides a standardized environment for developing Kilo Code.

## Persistence

Kilo Code stores thread conversations, settings, and caches in the following locations:

- **Threads/Conversations**: `~/.vscode-remote/data/User/globalStorage/kilocode.kilo-code/`
- **Settings**: `~/.vscode-remote/data/User/settings/`
- **Cache**: `~/.vscode-remote/data/User/globalStorage/kilocode.kilo-code/cache/`
- **Vector Store**: `~/.vscode-remote/data/User/globalStorage/kilocode.kilo-code/vector/`

### Volume Mounts

The dev container is configured with named volumes to persist this data across container rebuilds:

| Volume                    | Target                                                            | Purpose                      |
| ------------------------- | ----------------------------------------------------------------- | ---------------------------- |
| `kilocode-global-storage` | `/root/.vscode-remote/data/User/globalStorage/kilocode.kilo-code` | Threads, cache, vector store |
| `kilocode-settings`       | `/root/.vscode-remote/data/User/settings`                         | VS Code settings             |

### Preserving Threads Across Rebuilds

When you rebuild the dev container, these volumes persist your data:

1. **Before rebuilding**: Your threads are automatically preserved in the named volumes
2. **After rebuilding**: Threads restore automatically when you reopen the container
3. **If threads disappear**: Check that the volumes are still attached

### Troubleshooting Thread Recovery

If threads don't appear after a container rebuild:

1. **Verify volumes exist**:

    ```bash
    docker volume ls | grep kilocode
    ```

2. **Inspect volume contents**:

    ```bash
    docker volume inspect kilocode-global-storage
    ```

3. **Reattach volumes**: If volumes were detached, rebuild with:

    ```bash
    devcontainer rebuild
    ```

4. **Manual recovery**: If volumes are lost, threads cannot be recovered. Start new conversations and consider backing up important threads.

### Backing Up Threads

To back up your threads:

1. Copy the global storage directory:

    ```bash
    cp -r ~/.vscode-remote/data/User/globalStorage/kilocode.kilo-code ~/kilocode-backup
    ```

2. Store the backup outside the dev container environment.

### Custom Storage Path

If you need threads stored in a different location, configure a custom storage path in VS Code settings:

1. Open VS Code settings (`Ctrl+,` or `Cmd+,`)
2. Search for "Kilo Code: Custom Storage Path"
3. Enter an absolute path that's mounted into the container

Example `devcontainer.json` mount for custom path:

```json
"mounts": [
  {
    "source": "/path/on/host/kilocode-data",
    "target": "/home/vscode/kilocode-data",
    "type": "bind"
  }
]
```

Then set the custom storage path to `/home/vscode/kilocode-data`.
