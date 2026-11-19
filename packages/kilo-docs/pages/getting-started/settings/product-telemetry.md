---
title: "Product telemetry and crash reports"
description: "Choose whether to share product telemetry and crash reports, with instructions for each Kilo client."
---

# Product telemetry and crash reports

Product telemetry helps us understand how Kilo is used so we can improve it: which features to prioritize, which errors come up most often, and what is slow. It includes information about feature usage, performance, and errors. Kilo Desktop also sends crash reports to help diagnose crashes.

Not everyone wants to share this data, so you can turn it off. Product telemetry is enabled by default in the standalone CLI and Kilo Desktop. In VS Code, Kilo follows the editor's telemetry preference. Use the instructions for your client below; these clients do not share one telemetry preference.

This page covers product telemetry shared with Kilo. [OpenTelemetry export](#optional-opentelemetry-export) is a separate feature for monitoring Kilo in your own observability tools.

| Client | Where to disable product telemetry | Precedence |
|---|---|---|
| Standalone CLI | `KILO_TELEMETRY_LEVEL=off`, or `experimental.openTelemetry: false` in global Kilo config | The environment variable overrides global config. |
| VS Code | VS Code's **Telemetry: Telemetry Level** setting: any level other than **all** | VS Code's preference overrides the CLI controls for its managed Kilo backend. |
| Kilo Desktop | **Settings > General > Privacy > Share usage analytics and crash reports** | Desktop's preference overrides the CLI controls for its embedded Kilo service. |
| JetBrains | Not available; see [JetBrains](#jetbrains) | Product telemetry is currently always on in the plugin. |

## VS Code

1. Open VS Code **Settings** and search for `telemetry.telemetryLevel`.
2. Set **Telemetry: Telemetry Level** to **off**.

Alternatively, add this to your **VS Code user settings JSON**, not `kilo.jsonc`:

```json
{
  "telemetry.telemetryLevel": "off"
}
```

You can also open this setting from Kilo's **Settings > About Kilo Code > Telemetry > Open Telemetry Settings**.

Kilo sends product telemetry only when the level is **all**. The **error** and **crash** levels also turn Kilo's product telemetry off, so you can use one of them to keep sharing error or crash reports with VS Code itself.

The change applies to the running Kilo backend right away, and backends started later follow the setting too. You do not need to restart VS Code.

This is VS Code's editor-wide telemetry preference, not a Kilo-only switch. Kilo uses it for the extension and its managed backend, including the sidebar and Agent Manager. Setting only `experimental.openTelemetry: false` in Kilo config or inheriting `KILO_TELEMETRY_LEVEL=off` does not override an enabled VS Code telemetry preference. A standalone CLI started separately still uses its own controls below.

## Standalone CLI

Product telemetry is enabled by default. To disable it for a CLI process, set `KILO_TELEMETRY_LEVEL=off` before starting it.

On macOS or Linux:

```bash
KILO_TELEMETRY_LEVEL=off kilo
```

In PowerShell:

```powershell
$env:KILO_TELEMETRY_LEVEL = "off"
kilo
```

For a persistent config-based opt-out, merge this into your **global** `~/.config/kilo/kilo.jsonc`:

```json
{
  "experimental": {
    "openTelemetry": false
  }
}
```

The default Windows location is `%USERPROFILE%\.config\kilo\kilo.jsonc`. If you set `XDG_CONFIG_HOME`, use its `kilo` subdirectory instead.

Despite its name, `experimental.openTelemetry` controls the CLI's **product telemetry** default. Telemetry initialization reads global config, so putting this setting only in a project config, a custom `KILO_CONFIG` file, or `KILO_CONFIG_CONTENT` is not sufficient.

`KILO_TELEMETRY_LEVEL` takes precedence: `off` disables product telemetry and `all` enables it even when global config says `false`. Leave the variable unset if you want global config to decide. `DO_NOT_TRACK` is not a supported opt-out for this CLI.

Restart existing CLI and server processes after changing the environment or config. If you attach to an already-running server, apply the setting to that server's environment or global config and restart it; changing only the attaching client's environment does not change the running server.

## Kilo Desktop

1. Open **Settings > General > Privacy**.
2. Turn off **Share usage analytics and crash reports**.

This preference is enabled by default and covers Desktop's product telemetry and crash reports, the embedded Kilo service, and the conda environment manager. Desktop supplies its own telemetry preference to the embedded service, overriding standalone CLI environment and config settings.

To ensure every embedded service uses the new preference, finish any active work, fully quit Desktop, and reopen it after turning the toggle off. This also applies if Desktop reports an error applying the change to a running service.

See [Desktop privacy settings](/docs/desktop/settings/general#privacy) for the settings location and free-model data handling.

## JetBrains

{% callout type="note" %}
Product telemetry is currently always on in the JetBrains plugin. The CLI settings above and the IDE's data-sharing preferences do not turn it off.
{% /callout %}

## Mobile

The mobile app has its own optional-telemetry consent during onboarding and in Settings. See [Mobile privacy and telemetry](/docs/code-with-ai/platforms/mobile#privacy-and-telemetry); desktop and CLI settings do not configure the mobile app.

## What opting out does not change

- Events queued before a runtime opt-out may still be uploaded. Opting out does not delete telemetry already sent.
- Model requests, authentication, billing, and other requests needed for features you use still occur. This is not an offline mode or an opt-out from server-side operational processing.
- The CLI's `privacy_mode` setting only blurs personal information in the terminal UI; it does not disable product telemetry.
- Third-party tools, plugins, and MCP servers have their own data-handling settings.

## Optional OpenTelemetry export

OpenTelemetry/OTLP export lets you send logs and traces to your own configured observability endpoint. It is not the mechanism for Kilo's product telemetry collection. If you set `OTEL_EXPORTER_OTLP_ENDPOINT`, that export operates independently of the product telemetry preferences above. To stop your configured export, remove the endpoint from the service's environment and restart it.

See [CLI OpenTelemetry export](/docs/code-with-ai/platforms/cli#opentelemetry-export) for exporter configuration. You do not need to configure an OTLP endpoint to disable product telemetry.
