# Review: App i18n (PR #6622 - OpenCode v1.2.16)

## Files Reviewed

| File                                   | Status    | +/-     | Locale              |
| -------------------------------------- | --------- | ------- | ------------------- |
| `packages/app/src/i18n/en.ts`          | modified  | +32/-8  | English (source)    |
| `packages/app/src/i18n/ar.ts`          | modified  | +24/-7  | Arabic              |
| `packages/app/src/i18n/br.ts`          | modified  | +22/-6  | Portuguese (Brazil) |
| `packages/app/src/i18n/bs.ts`          | modified  | +22/-6  | Bosnian             |
| `packages/app/src/i18n/da.ts`          | modified  | +22/-6  | Danish              |
| `packages/app/src/i18n/de.ts`          | modified  | +22/-6  | German              |
| `packages/app/src/i18n/es.ts`          | modified  | +22/-6  | Spanish             |
| `packages/app/src/i18n/fr.ts`          | modified  | +26/-10 | French              |
| `packages/app/src/i18n/ja.ts`          | modified  | +22/-6  | Japanese            |
| `packages/app/src/i18n/ko.ts`          | modified  | +22/-6  | Korean              |
| `packages/app/src/i18n/no.ts`          | modified  | +22/-6  | Norwegian           |
| `packages/app/src/i18n/pl.ts`          | modified  | +22/-6  | Polish              |
| `packages/app/src/i18n/ru.ts`          | modified  | +22/-6  | Russian             |
| `packages/app/src/i18n/th.ts`          | modified  | +24/-7  | Thai                |
| `packages/app/src/i18n/tr.ts`          | **added** | +849/-0 | Turkish (new)       |
| `packages/app/src/i18n/zh.ts`          | modified  | +22/-6  | Chinese Simplified  |
| `packages/app/src/i18n/zht.ts`         | modified  | +24/-7  | Chinese Traditional |
| `packages/app/src/i18n/parity.test.ts` | modified  | +2/-1   | Test                |

**18 files total** (16 modified, 1 new locale, 1 test update)

---

## Summary

This patch group makes three categories of i18n changes to `packages/app/`:

1. **Terminology change: "edits" -> "permissions"** — 6 keys across all 16 existing locales have their auto-accept strings updated from "edits" to "permissions", reflecting a broader semantic change in the auto-accept feature (it now covers all permissions, not just edits).

2. **22 new keys** added to `en.ts` covering: provider taglines (`dialog.provider.opencode.tagline`, `dialog.provider.opencodeGo.tagline`), server management dialogs (`dialog.server.add.name/namePlaceholder/username/password`, `dialog.server.edit.title`), release notes UI (`dialog.releaseNotes.*`), time formatting (`common.time.*`), error/toast messages, settings descriptions, and the Turkish language label.

3. **New Turkish locale (`tr.ts`)** — A complete 849-line translation file with 723 keys. The parity test is updated to include Turkish.

There are **two issues of concern**: systematic missing translations for 6 new keys across all 15 non-English locales, and 9 missing keys in the new Turkish file compared to post-patch `en.ts`. There is also a minor inconsistency in `en.ts` where existing key values were changed without updating corresponding locale translations.

---

## Detailed Findings

### 1. `packages/app/src/i18n/en.ts` (source of truth)

**Changes overview:**

- 6 existing autoaccept key values updated ("edits" -> "permissions")
- 2 existing key values tweaked: `dialog.server.add.title` ("Add a server" -> "Add server"), `dialog.server.add.url` ("Server URL" -> "Server address")
- 22 truly new keys added

**New keys (22):**
| Key | Category |
|-----|----------|
| `dialog.provider.opencode.tagline` | Provider UI |
| `dialog.provider.opencodeGo.tagline` | Provider UI |
| `common.open` | Common |
| `dialog.server.add.name` | Server management |
| `dialog.server.add.namePlaceholder` | Server management |
| `dialog.server.add.username` | Server management |
| `dialog.server.add.password` | Server management |
| `dialog.server.edit.title` | Server management |
| `dialog.releaseNotes.action.getStarted` | Release notes |
| `dialog.releaseNotes.action.next` | Release notes |
| `dialog.releaseNotes.action.hideFuture` | Release notes |
| `dialog.releaseNotes.media.alt` | Release notes |
| `language.tr` | Language label |
| `toast.project.reloadFailed.title` | Toast |
| `error.server.invalidConfiguration` | Error |
| `common.moreCountSuffix` | Common |
| `common.time.justNow` | Time formatting |
| `common.time.minutesAgo.short` | Time formatting |
| `common.time.hoursAgo.short` | Time formatting |
| `common.time.daysAgo.short` | Time formatting |
| `settings.providers.connected.environmentDescription` | Settings |
| `settings.providers.custom.description` | Settings |

No issues with the English source file itself. Key naming conventions are consistent.

---

### 2. All 15 existing non-English locales (ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, zh, zht)

**What was done correctly:**

- All 15 locales update the 6 autoaccept strings from "edits" to "permissions" with proper translations in their respective languages.
- All 15 locales add translations for `dialog.provider.opencode.tagline` and `dialog.provider.opencodeGo.tagline`.
- All 15 locales add 14 new keys at the end of their files: `common.open`, release notes keys, toast/error keys, time formatting keys, and settings descriptions.

**MEDIUM - 6 keys missing from all 15 existing locales:**

The following keys are added to `en.ts` but **not** translated in any of the 15 non-English locale patches:

| Missing Key                         | English Value            |
| ----------------------------------- | ------------------------ |
| `dialog.server.add.name`            | "Server name (optional)" |
| `dialog.server.add.namePlaceholder` | "Localhost"              |
| `dialog.server.add.username`        | "Username (optional)"    |
| `dialog.server.add.password`        | "Password (optional)"    |
| `dialog.server.edit.title`          | "Edit server"            |
| `language.tr`                       | "Türkçe"                 |

The `language.tr` key is a special case — it should be the same string "Türkçe" in all locales (it's the native name of Turkish), but it still needs to be present for key parity. The 5 `dialog.server.*` keys are new server management UI strings that will fall back to English if untranslated.

**Impact**: Users of the server management dialog in non-English locales will see mixed-language UI (English labels for server name/username/password fields alongside their translated language). The `language.tr` label will fall back to the English key, potentially showing "Türkçe" anyway if the i18n system returns the en.ts fallback, but it's still a parity gap.

**LOW - Stale translations for value-changed keys:**

The en.ts patch changes the **values** (not keys) of:

- `dialog.server.add.title`: "Add a server" -> "Add server"
- `dialog.server.add.url`: "Server URL" -> "Server address"

No non-English locale updates its translation for these keys. The existing locale translations for `dialog.server.add.title` and `dialog.server.add.url` still match the old English phrasing. This is a minor semantic inconsistency — for instance, `dialog.server.add.url` changed from "URL" to "address" in English (perhaps because the field now accepts non-URL formats), but the German translation still says "Server-URL".

---

### 3. `packages/app/src/i18n/tr.ts` (new Turkish locale)

**What was done correctly:**

- Complete new file with 723 keys and proper TypeScript structure
- Imports `dict as en` from `./en` and uses `type Keys = keyof typeof en` for type safety
- Uses `satisfies Partial<Record<Keys, string>>` for compile-time key validation
- Translation quality appears high with proper Turkish grammar and idioms
- Includes all 22 new keys added in this PR except the 5 server management keys (consistent with the gap in other locales)
- Correctly translates the autoaccept keys with "permissions" terminology from the start

**MEDIUM - 9 keys missing compared to post-patch en.ts:**

| Missing Key                         | English Value                                   | Status                  |
| ----------------------------------- | ----------------------------------------------- | ----------------------- |
| `dialog.server.add.name`            | "Server name (optional)"                        | Same gap as all locales |
| `dialog.server.add.namePlaceholder` | "Localhost"                                     | Same gap as all locales |
| `dialog.server.add.username`        | "Username (optional)"                           | Same gap as all locales |
| `dialog.server.add.password`        | "Password (optional)"                           | Same gap as all locales |
| `dialog.server.edit.title`          | "Edit server"                                   | Same gap as all locales |
| `session.modeSwitch.switching`      | "Switching to {{mode}} mode..."                 | Pre-existing gap\*      |
| `session.modeSwitch.waiting`        | "Waiting for current task to complete"          | Pre-existing gap\*      |
| `session.modeSwitch.notAvailable`   | "Agent not available"                           | Pre-existing gap\*      |
| `session.modeSwitch.fallback`       | '"{{requested}}" not found, using "{{actual}}"' | Pre-existing gap\*      |

_The 4 `session.modeSwitch._`keys are missing from **all** existing non-English locales (not just tr.ts). These are pre-existing gaps in the i18n coverage that were never translated in any locale. Since`tr.ts` is a brand-new file, this is an opportunity to add them — but their absence is consistent with all other locales and not a regression.

**Untranslated strings (expected):**
The tr.ts file has ~61 keys where the Turkish value matches the English value. All are appropriate non-translatable content: brand names (Anthropic, OpenAI, Google), font names (JetBrains Mono, Fira Code), sound effect names, language labels in their native scripts, URLs, and technical terms (Shell, Terminal, Model, LSP).

---

### 4. `packages/app/src/i18n/parity.test.ts`

**What was done correctly:**

- Imports `tr` dictionary
- Adds `tr` to the `locales` array in alphabetical order
- Maintains existing test logic checking `command.session.previous.unseen` and `command.session.next.unseen` keys

No issues.

**Note:** The parity test is very narrow — it only checks 2 keys (`command.session.previous.unseen` and `command.session.next.unseen`). It does not catch the 6 keys systematically missing from this PR. Consider expanding the parity test to validate all en.ts keys exist in every locale.

---

### 5. Formatting-only changes (ar.ts, th.ts, zht.ts, fr.ts)

Several locale patches include line-wrapping changes for long strings that don't change the actual translation content. For example:

- `ar.ts`: `provider.connect.oauth.auto.visit.suffix` reformatted from single-line to multi-line
- `th.ts`: Same key reformatted
- `zht.ts`: Same key reformatted
- `fr.ts`: `toast.update.description`, `sidebar.gettingStarted.line1` reformatted; also net reduction of 4 lines in autoaccept toast section (multiline -> single-line)

These are clean formatting changes with no functional impact.

---

## Risk to VS Code Extension

**Low.** The VS Code extension (Kilo Code) does not directly use `packages/app/src/i18n/` files — these are consumed by the SolidJS web frontend (`packages/app/`). The extension has its own i18n system. The missing translations will only affect users of the desktop app or `kilo web` command who have a non-English locale set and navigate to the server management dialog.

The auto-accept terminology change ("edits" -> "permissions") could cause minor confusion if the VS Code extension's own i18n still refers to "edits" while the web/desktop app says "permissions", but this is a cross-product consistency concern rather than a functional risk.

---

## Overall Risk

**Low-Medium.** The changes are well-structured and the translation quality is high across all locales. The primary concern is the systematic omission of 6 new keys (5 server management + `language.tr`) from all 15 existing locales and the new Turkish locale. This will result in English fallback text appearing in the server management dialog for non-English users. The 4 pre-existing `session.modeSwitch.*` gaps in tr.ts are consistent with all other locales and not a regression.

### Action items (recommended, not blocking):

1. **Add the 5 missing `dialog.server.*` keys** to all 16 non-English locale files
2. **Add `language.tr`: "Türkçe"** to all 15 existing locale files
3. **Add the 4 `session.modeSwitch.*` keys** to tr.ts (and ideally all other locales, though that's a pre-existing gap)
4. **Update `dialog.server.add.title` and `dialog.server.add.url` translations** in non-English locales to reflect the English value changes ("Add a server" -> "Add server", "Server URL" -> "Server address")
5. Consider expanding `parity.test.ts` to validate full key coverage across locales
