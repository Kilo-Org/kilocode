# AGENTS.md

Kilo's own UI copy, one dictionary per locale. `packages/kilo-vscode/webview-ui/src/context/language.tsx` builds the English base from the ported app dictionary, then `packages/kilo-ui/src/i18n` (upstream's `packages/ui/src/i18n`), then this package; each locale dictionary spreads its app, `ui`, `kilo` and Agent Manager layers over that base. A key here therefore either adds copy upstream does not have or deliberately overrides an upstream value.

## Every key, every locale

- `en.ts` is the source of truth, and every key in it must also exist in the other 19 files in `src/`: ar, br, bs, da, de, es, fr, it, ja, ko, nl, no, pl, ru, th, tr, uk, zh, zht. This is the requirement, not the current state: 21 marketplace keys added by the v2 port exist in `en.ts` only and still need backfilling. Persian has no `src/fa.ts` yet; its app and Agent Manager layers exist and it inherits English for keys in this package, and adding that layer is a separate localization task, not part of a copy change.
- A change that adds or edits English copy adds or updates the same key in every one of those files in the same change. A key left English-only, half translated, stale after an English copy change, or present in a locale but absent from `en.ts` is an incomplete change.
- Keep the `en.ts` section comments and key order in each locale so the dictionaries stay diffable side by side.
- Count-sensitive copy renders through `plural(key, count, params)`, which resolves `<key>.<category>` and falls back to `<key>.other`. Give every locale the CLDR categories that locale uses (for example `.one` and `.other` in English, `.one`, `.few`, `.many` and `.other` in Russian and Polish), not English's set.
- Never change, rename or delete an English key or value to make translation easier. English is intentional, designer-written source copy; adapt the locale translation and the i18n mechanics around it.
- Preserve `{{placeholder}}` names and count, Markdown and HTML in the value, and leading or trailing spaces: fragments such as `"provider.connect.kiloGateway.byok.prefix": "For more usage stats, "` are concatenated in the UI, so the spacing is part of the string.
- Do not copy an upstream value here unchanged. This package holds Kilo-only strings and intentional overrides.

## Translation quality

- Do not translate from model knowledge alone. Verify terminology and grammar with Unicode CLDR locale/plural data, Microsoft Localization Style Guides and terminology, Apple localization/style guidance and localized platform UI, Mozilla localization style guides, Mozilla Pontoon, and the Firefox localization corpus at `github.com/mozilla-l10n/firefox-l10n`.
- For developer-facing terminology, prefer established usage in the target language's developer community over literal translations. Cross-check maintained Firefox, KDE, and VS Code localizations, using at least two independent corpora when available. Keep established English loanwords and acronyms instead of inventing unfamiliar terms.
- Translate whole UI phrases in context rather than substituting glossary words. Audit recurring concepts for consistency and review every exact-English value; retain it only when it is an intentional product/provider/tool name, URL, code token, keyboard legend, acronym, asset name, or established borrowing.
- Also use the relevant language authority or official dictionary for the locale (for example RAE/Fundéu, FranceTerme, Duden, TDK, Kotus/Kielitoimiston sanakirja, Språkrådet/Bokmålsordboka, Rada Języka Polskiego/PWN, the Russian and Arabic language academies, the Ukrainian Orthography, Taiwan MOE dictionaries, or the Royal Society of Thailand). Treat the English dictionary as the semantic source of truth and preserve placeholders, code identifiers, product names, and keyboard labels.
- Record the corpora used and flag uncertain or regional terminology in the pull request notes.

## Placement

- Copy that only Kilo shows belongs here. Copy that upstream already owns, including upstream's `packages/ui/src/i18n`, is never translated by hand: upstream syncs those files, and upstream's "English source strings only" rule in `packages/ui/AGENTS.md` covers them.
- Dictionaries ported from v1 under `packages/kilo-vscode/webview-ui/` (`src/i18n`, `agent-manager/i18n`) follow the same every-key-every-locale rule for the strings they own.
