# About Tab — All Translation Strings

Source: `webview-ui/src/i18n/locales/en/settings.json`

**Note:** `<tagName>...</tagName>` are interpolation placeholders for React components (links).
`{{variable}}` are i18next interpolation variables.

---

## Currently Rendered in Kilo Code's About.tsx

### Section header

| Key | English |
|-----|---------|
| `sections.about` | About Kilo Code |

### Telemetry checkbox (hidden when running inside VS Code)

| Key | English |
|-----|---------|
| `footer.telemetry.label` | Allow error and usage reporting |
| `footer.telemetry.description` | Help improve Kilo Code by sending usage data and error reports. No code, prompts, or personal information is ever sent. See our privacy policy for more details. |

### Feedback paragraph (contains embedded links)

| Key | English |
|-----|---------|
| `footer.feedback` | If you have any questions or feedback, feel free to open an issue at `<githubLink>`github.com/Kilo-Org/kilocode`</githubLink>` or join `<redditLink>`reddit.com/r/kilocode`</redditLink>` or `<discordLink>`kilo.ai/discord`</discordLink>`. |

### Support paragraph (Kilo Code addition)

| Key | English |
|-----|---------|
| `footer.support` | For financial questions, please contact Customer Support at `<supportLink>`https://kilo.ai/support`</supportLink>` |

### Settings management buttons

| Key | English |
|-----|---------|
| `footer.settings.export` | Export |
| `footer.settings.import` | Import |
| `footer.settings.reset` | Reset |

---

## Upstream (Roo Code) About Keys

These keys exist in `settings.json` but are **NOT** currently rendered by Kilo Code's `About.tsx` (tests are skipped with `describe.skip`).

| Key | English |
|-----|---------|
| `about.bugReport.label` | Found a bug? |
| `about.bugReport.link` | Report on GitHub |
| `about.featureRequest.label` | Have an idea? |
| `about.featureRequest.link` | Share it with us |
| `about.securityIssue.label` | Discovered a vulnerability? |
| `about.securityIssue.link` | Follow our disclosure process |
| `about.contact.label` | Need to talk to us? Write |
| `about.community` | Want tips or to just hang out with other Kilo Code users? Join `<redditLink>`reddit.com/r/kilocode`</redditLink>` or `<discordLink>`kilo.ai/discord`</discordLink>` |
| `about.contactAndCommunity` | Contact & Community |
| `about.manageSettings` | Manage Settings |
| `about.debugMode.label` | Enable debug mode |
| `about.debugMode.description` | Enable debug mode to show additional buttons in the task header for viewing API conversation history and UI messages as prettified JSON in temporary files. |
