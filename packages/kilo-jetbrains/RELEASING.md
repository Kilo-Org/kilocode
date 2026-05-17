# Releasing the JetBrains Plugin

## RC releases (currently the only supported flow)

Stable release tags (`jetbrains/vx.y.z`) are recognized by the workflow but intentionally rejected. Only RC tags are accepted right now.

### 1. Create and push a tag

Tag format: `jetbrains/v<major>.<minor>.<patch>-rc.<n>`

```
git tag jetbrains/v7.0.1-rc.1
git push origin jetbrains/v7.0.1-rc.1
```

### 2. Watch the workflow

The `publish-jetbrains` workflow starts automatically on tag push. Follow progress at:

[https://github.com/Kilo-Org/kilocode/actions/workflows/publish-jetbrains.yml](https://github.com/Kilo-Org/kilocode/actions/workflows/publish-jetbrains.yml)

The workflow:
1. Validates the tag format and required secrets.
2. Downloads CLI binaries for all 6 platforms from the matching GitHub Release.
3. Verifies and signs the plugin with `./gradlew verifyPlugin publishPlugin -Pproduction=true`.
4. Publishes the signed ZIP to the JetBrains Marketplace `eap` channel.
5. Uploads the signed ZIP to a GitHub prerelease for the tag.

### 3. Verify on the Marketplace

Once the workflow succeeds, the new version should appear in the plugin's version list:

[https://plugins.jetbrains.com/plugin/28350-kilo-code/edit/versions](https://plugins.jetbrains.com/plugin/28350-kilo-code/edit/versions)

---

## Installing RC builds via the custom plugin repository

RC builds are published to the `eap` channel, not the default channel. To get them in IntelliJ IDEA:

1. Open **Settings > Plugins**.
2. Click the gear icon and choose **Manage Plugin Repositories**.
3. Add the following URL:

```
https://plugins.jetbrains.com/plugins/list?channel=eap&pluginId=28350
```

4. Search for **Kilo Code** in the Marketplace tab — the latest RC version will appear and update automatically.

---

## Required GitHub Actions secrets

| Secret | Purpose |
|---|---|
| `JETBRAINS_MARKETPLACE_TOKEN` | Marketplace API token for publishing |
| `JETBRAINS_CERTIFICATE_CHAIN` | PEM certificate chain for plugin signing |
| `JETBRAINS_PRIVATE_KEY` | PEM private key for plugin signing |
| `JETBRAINS_PRIVATE_KEY_PASSWORD` | Password for the private key |

Before the first publish, complete `RELEASE_TODO.md` to set up these secrets and the Marketplace plugin entry.
