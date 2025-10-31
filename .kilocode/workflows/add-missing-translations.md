# Add missing translations

This workflow requires Orchestrator mode.

Execute `node scripts/find-missing-translations.js` in Code mode to find all missing translations.

For each language that is missing translations:

- For each JSON file that is missing translations:
    - Start a separate subtask in Translate mode for this language and JSON file to add the missing translations. Do not try to process mutliple languages or JSON files in one subtask.
