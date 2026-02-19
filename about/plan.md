# About Tab — Settings Screen

## Overview

The About tab is the last section in the Settings view. It displays version information, telemetry preferences, community/support links, and settings management buttons (export, import, reset).

## Component

- **File**: `webview-ui/src/components/settings/About.tsx`
- **Props**:
  - `telemetrySetting: TelemetrySetting` — current telemetry state (`"enabled"` | `"disabled"`)
  - `setTelemetrySetting: (setting: TelemetrySetting) => void`
  - `isVsCode: boolean` — controls whether the telemetry checkbox is visible (hidden in VS Code since VS Code has its own telemetry settings)

## Layout (top to bottom)

```
┌─────────────────────────────────────────────────────┐
│ ℹ️  About <Extension Name>                          │
│     Version: X.Y.Z (commit-sha)                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│ [Telemetry Checkbox] — hidden when isVsCode=true    │
│   ☐ Allow error and usage reporting                 │
│   Help improve ... See our privacy policy ...       │
│                                                     │
│ Feedback paragraph with links:                      │
│   "If you have any questions or feedback..."        │
│   → GitHub link                                     │
│   → Reddit link                                     │
│   → Discord link                                    │
│                                                     │
│ Support paragraph with link:                        │
│   "For financial questions, please contact..."      │
│   → Support link                                    │
│                                                     │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│ │ ⬆ Export │ │ ⬇ Import │ │ ⚠ Reset  │             │
│ └──────────┘ └──────────┘ └──────────┘             │
│                                                     │
│ [DEV ONLY] "Allocate memory" button                 │
└─────────────────────────────────────────────────────┘
```

## Upstream (Roo Code) About keys

The English translation file also contains an `about` section with keys for an upstream variant of the About screen that Kilo Code does not currently render (tests are skipped). These keys are included in `translations.txt` for reference:

- Bug report label + link
- Feature request label + link
- Security issue label + link
- Contact label
- Community text (Reddit + Discord)
- "Contact & Community" header
- "Manage Settings" header
- Debug mode toggle + description

## Actions

| Button   | Message sent to extension host        |
|----------|---------------------------------------|
| Export   | `{ type: "exportSettings" }`          |
| Import   | `{ type: "importSettings" }`          |
| Reset    | `{ type: "resetState" }`              |

## Translation keys used

All translation keys are in `webview-ui/src/i18n/locales/<lang>/settings.json`. The relevant keys are:

- `sections.about`
- `footer.telemetry.label`
- `footer.telemetry.description`
- `footer.feedback`
- `footer.support`
- `footer.settings.export`
- `footer.settings.import`
- `footer.settings.reset`
- `about.bugReport.label`
- `about.bugReport.link`
- `about.featureRequest.label`
- `about.featureRequest.link`
- `about.securityIssue.label`
- `about.securityIssue.link`
- `about.contact.label`
- `about.community`
- `about.contactAndCommunity`
- `about.manageSettings`
- `about.debugMode.label`
- `about.debugMode.description`

## Dependencies

- `@roo/package` — provides `Package.version` and `Package.sha`
- `@vscode/webview-ui-toolkit/react` — `VSCodeCheckbox`, `VSCodeLink`
- `lucide-react` — icons: `Info`, `Download`, `Upload`, `TriangleAlert`
- Custom UI: `Button` (with `variant="destructive"` for Reset)
- Layout helpers: `SectionHeader`, `Section`
