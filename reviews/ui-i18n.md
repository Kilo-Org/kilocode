# Review: UI i18n (PR #6622 - OpenCode v1.2.16)

## Files Reviewed

| File                          | Status    | +/-     | Locale              |
| ----------------------------- | --------- | ------- | ------------------- |
| `packages/ui/src/i18n/en.ts`  | modified  | +27/-1  | English (source)    |
| `packages/ui/src/i18n/ar.ts`  | modified  | +25/-0  | Arabic              |
| `packages/ui/src/i18n/br.ts`  | modified  | +25/-0  | Portuguese (Brazil) |
| `packages/ui/src/i18n/bs.ts`  | modified  | +25/-0  | Bosnian             |
| `packages/ui/src/i18n/da.ts`  | modified  | +25/-0  | Danish              |
| `packages/ui/src/i18n/de.ts`  | modified  | +27/-0  | German              |
| `packages/ui/src/i18n/es.ts`  | modified  | +25/-0  | Spanish             |
| `packages/ui/src/i18n/fr.ts`  | modified  | +25/-0  | French              |
| `packages/ui/src/i18n/ja.ts`  | modified  | +25/-0  | Japanese            |
| `packages/ui/src/i18n/ko.ts`  | modified  | +25/-0  | Korean              |
| `packages/ui/src/i18n/no.ts`  | modified  | +25/-0  | Norwegian           |
| `packages/ui/src/i18n/pl.ts`  | modified  | +25/-0  | Polish              |
| `packages/ui/src/i18n/ru.ts`  | modified  | +25/-0  | Russian             |
| `packages/ui/src/i18n/th.ts`  | modified  | +25/-0  | Thai                |
| `packages/ui/src/i18n/tr.ts`  | **added** | +139/-0 | Turkish (new)       |
| `packages/ui/src/i18n/zh.ts`  | modified  | +25/-0  | Chinese Simplified  |
| `packages/ui/src/i18n/zht.ts` | modified  | +25/-0  | Chinese Traditional |

**17 files total** (16 modified, 1 new)

---

## Summary

This patch group adds 25 new i18n keys across 5 feature areas to the `packages/ui` i18n dictionaries, and introduces Turkish (`tr`) as a new locale. The new keys cover:

1. **Session review** - `openFile`, `selection.line`, `selection.lines` (3 keys)
2. **File media** - `fileMedia.kind.*`, `fileMedia.state.*`, `fileMedia.binary.*` (9 keys)
3. **Retry UI** - `retry.attempt`, `retry.attemptLine`, `retry.geminiHot` (3 keys)
4. **Message parts** - `questions.dismissed`, `compaction`, `context.{read,search,list}.{one,other}` (8 keys)
5. **Misc** - `scrollView.ariaLabel`, `message.queued` (2 keys)

There are **two critical issues**: a type-safety regression in `en.ts` and a missing key block in the new `tr.ts` locale. There are also integration gaps where the new Turkish locale is not registered in any consumer.

---

## Detailed Findings

### 1. `packages/ui/src/i18n/en.ts` (source of truth)

**CRITICAL - Type annotation change breaks type safety**

The export changes from:

```ts
export const dict = {
```

to:

```ts
export const dict: Record<string, string> = {
```

This widens the inferred type of `dict` from a specific object literal type (with known string literal keys) to `Record<string, string>`. The downstream type `UiI18nKey` in `packages/ui/src/context/i18n.tsx:4` is defined as:

```ts
export type UiI18nKey = keyof typeof en
```

After this change, `UiI18nKey` resolves to `string` instead of a union of 126 literal string keys (e.g., `"ui.sessionReview.title" | "ui.sessionReview.openFile" | ...`). This means:

- All `t()` calls throughout the UI lose compile-time key validation. Typos in key names will no longer produce type errors.
- The `Record<Keys, string>` annotation on `no.ts` (which enforces full key coverage) derives its `Keys` from `keyof typeof en`, which also degrades to `string`, eliminating its compile-time completeness check.
- The `satisfies Partial<Record<Keys, string>>` pattern used by `bs.ts`, `de.ts`, `zh.ts`, `zht.ts`, and the new `tr.ts` similarly loses its ability to validate keys.
- The VS Code extension's `language.tsx:167` uses `UiI18nKey` for its `t()` function signature, which also loses type safety.

**Recommendation**: Revert this type change. If the intent is to allow the dict to be indexed with arbitrary strings (for dynamic key lookup), consider adding a separate overload or cast at the call site rather than widening the source type.

**Key ordering**: The new keys `openFile`, `selection.line`, `selection.lines` are inserted _after_ `renderAnyway` in `en.ts` but _before_ `expandAll` in all other locale files. This is a minor inconsistency in ordering but has no runtime impact.

---

### 2. `packages/ui/src/i18n/tr.ts` (new locale)

**CRITICAL - Missing 9 `ui.fileMedia.*` keys**

The new Turkish locale file has **116 keys** while `en.ts` (post-patch) has **126 keys**. The following 10 keys are absent:

| Missing Key                               | Category    |
| ----------------------------------------- | ----------- |
| `ui.fileMedia.kind.image`                 | File media  |
| `ui.fileMedia.kind.audio`                 | File media  |
| `ui.fileMedia.state.removed`              | File media  |
| `ui.fileMedia.state.loading`              | File media  |
| `ui.fileMedia.state.error`                | File media  |
| `ui.fileMedia.state.unavailable`          | File media  |
| `ui.fileMedia.binary.title`               | File media  |
| `ui.fileMedia.binary.description.path`    | File media  |
| `ui.fileMedia.binary.description.default` | File media  |
| `ui.permission.sessionHint`               | Permissions |

The entire `ui.fileMedia.*` block that was added in this same PR to all other locales was not added to `tr.ts`. Additionally, `ui.permission.sessionHint` is missing (though this key predates this PR - it exists in `en.ts` pre-patch and is also absent from several other locales).

Because `tr.ts` uses `satisfies Partial<Record<Keys, string>>`, the compiler won't flag missing keys at build time (that's the purpose of `Partial`). However, at runtime, users with Turkish locale will see raw key strings like `"ui.fileMedia.kind.image"` instead of Turkish translations when encountering binary files or media in the session review UI. The `i18n.tsx` fallback (`en[key] ?? String(key)`) will fall through to English only if `tr.ts` doesn't define the key at all AND the fallback mechanism is wired to check `en` - but in the VS Code extension's `language.tsx`, the lookup is `dict()[key] ?? String(key)`, which falls back to the base `en` keys via the spread `{ ...base, ... }` pattern. Since `tr` is not registered there at all (see finding below), this is moot.

**Not registered in any consumer**: The new `tr.ts` file is created but **not imported or registered** in:

- `packages/kilo-vscode/webview-ui/src/context/language.tsx` - No `uiTr` import, no `tr:` entry in `LOCALE_LABELS` or `dicts`
- `packages/kilo-vscode/webview-ui/src/context/language-utils.ts` - `"tr"` not in the `Locale` type union or `LOCALES` array
- `packages/app/src/context/language.tsx` - No `uiTr` import, no `tr:` entry in `DICT` or `localeMatchers`

This means the Turkish locale file ships but **cannot be selected or used** by any product until the consumer-side registration is completed. This is likely an incremental PR with registration planned for a follow-up, but it should be noted.

---

### 3. Modified locale files (ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, zh, zht)

**All 15 modified locales have full coverage of the 25 new keys.** No missing translations.

**Template placeholder consistency**: All locales correctly preserve the `{{variable}}` placeholders (`{{line}}`, `{{start}}`, `{{end}}`, `{{kind}}`, `{{path}}`, `{{attempt}}`, `{{count}}`). No placeholder mismatches or omissions detected.

**Translation quality observations** (non-blocking):

- `de.ts`: `"ui.fileMedia.kind.image": "bild"` - lowercase "bild" where German nouns are typically capitalized ("Bild"). Other German values like "Binardatei", "Fehler" are correctly capitalized. Minor inconsistency.
- `ja.ts`: `context.read.one` and `context.read.other` are identical (`"{{count}} 件の読み取り"`), same for `search` and `list` pairs. This is correct for Japanese which does not have singular/plural distinction.
- `ko.ts`: Same pattern as Japanese - `.one` and `.other` are identical, correct for Korean.
- `no.ts`: Same pattern - `.one` and `.other` identical for `read` and `search`, which is slightly unusual for Norwegian (which does have plural forms), but acceptable for a technical UI.
- `th.ts`: Same pattern, correct for Thai.
- `ar.ts`: Singular/plural pairs are distinct, which is appropriate for Arabic. However, Arabic has additional grammatical number forms (dual, paucal) that the `.one`/`.other` pattern doesn't capture. This is a known limitation of the i18n framework, not a defect in this PR.

**Type annotation inconsistency** (pre-existing, not introduced by this PR):

- Files with `import en` + type checking: `bs.ts`, `de.ts`, `zh.ts`, `zht.ts` (use `satisfies Partial<Record<Keys, string>>`), `no.ts` (uses `Record<Keys, string>` - enforces completeness)
- Files without type checking: `ar.ts`, `br.ts`, `da.ts`, `es.ts`, `fr.ts`, `ja.ts`, `ko.ts`, `pl.ts`, `ru.ts`, `th.ts`

This means 10 of 16 non-English locales have no compile-time validation that their keys match `en.ts`. This is a pre-existing concern, not introduced by this PR, but the `en.ts` type change in this PR would nullify even the existing checks (see finding #1).

---

### 4. `geminiHot` key content

The key `ui.sessionTurn.retry.geminiHot` contains the English value `"gemini is way too hot right now"` - a colloquial/humorous message about Gemini API overload. All locales translate this idiomatically rather than literally, which is appropriate. The key name `geminiHot` references a specific provider, which is slightly unusual for a generic UI i18n key but is acceptable for a user-facing status message.

---

## Risk to VS Code Extension

**HIGH**

1. **Type safety regression (Critical)**: The `en.ts` `Record<string, string>` type change propagates through `UiI18nKey` to the VS Code extension's `language.tsx:167`, eliminating compile-time key validation for all `t()` calls in the extension webview. This affects both the sidebar chat and Agent Manager webviews.

2. **Turkish locale not wired up**: The VS Code extension's `language.tsx` does not import `@kilocode/kilo-ui/i18n/tr`, the `Locale` type in `language-utils.ts` does not include `"tr"`, and `LOCALE_LABELS` has no Turkish entry. Turkish users selecting their system language will fall through `normalizeLocale()` to `"en"` since `"tr"` is not in the `LOCALES` array. This is a dead-code scenario for the extension - no runtime breakage, but the locale is unusable.

3. **Missing `tr.ts` fileMedia keys**: If/when Turkish is wired up, the 9 missing `ui.fileMedia.*` keys will cause raw key strings to display instead of Turkish text when viewing binary files or media in session review.

---

## Overall Risk

**HIGH**

| Issue                                            | Severity          | Impact                                                                                                                                                |
| ------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `en.ts` type widened to `Record<string, string>` | **Critical**      | Breaks `UiI18nKey` type safety across all products (UI, app, VS Code extension). Silent regression - no build errors, but all key validation is lost. |
| `tr.ts` missing 9 `ui.fileMedia.*` keys          | **High**          | Turkish users will see untranslated keys for binary/media file UI once the locale is registered.                                                      |
| `tr.ts` not registered in consumers              | **Medium**        | Turkish locale is dead code - ships but cannot be used. Likely intentional (incremental), but creates a partial state.                                |
| `de.ts` lowercase "bild"                         | **Low**           | Minor grammatical inconsistency in German translation.                                                                                                |
| Key ordering inconsistency in `en.ts`            | **Informational** | New keys placed at a different position in en.ts vs other locales. No runtime impact.                                                                 |

**Recommendation**: Block on the `en.ts` type annotation change (revert to inferred literal type). The `tr.ts` missing keys and registration gaps should be addressed before or alongside the consumer-side wiring.
