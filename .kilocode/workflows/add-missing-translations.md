# Add missing translations

This workflow requires Orchestrator mode.

Execute `node scripts/find-missing-translations.js` in Code mode to find all missing translations.

For each language that is missing translations:

- For each JSON file that is missing translations:
    - Start a separate subtask in Translate mode for this language and JSON file to add the missing translations. Do not try to process multiple languages or JSON files in one subtask.

## Translation Guidelines

When translating, follow these key rules:

1. **Supported Languages**: ar, ca, cs, de, en, es, fr, hi, id, it, ja, ko, nl, pl, pt-BR, ru, th, tr, uk, vi, zh-CN, zh-TW
2. **Voice**: Always use informal speech (e.g., "du" not "Sie" in German)
3. **Technical Terms**: Don't translate "token", "API", "prompt" and domain-specific technical terms
4. **Placeholders**: Keep `{{variable}}` placeholders exactly as in the English source
5. **Validation**: Run `node scripts/find-missing-translations.js` to validate changes

For comprehensive translation guidelines including language-specific rules, see `.kilocode/skills/translation/SKILL.md`.
