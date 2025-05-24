# i18n Tools

This directory contains tools for managing internationalization (i18n) in the application.

## Available Tools

### translate_i18n_key

Translates specific keys from English to other languages. It handles both simple strings and nested objects.

**Features:**

- Translates individual keys or entire parent keys with nested children
- Supports batch translation of multiple keys
- Maintains consistent key ordering across all locales
- Preserves existing translations when available

### move_i18n_key

Moves a key from one JSON file to another across all locales, maintaining translations.

**Features:**

- Preserves all translations during the move
- Option to rename the key in the destination file
- Maintains consistent key ordering across all locales
- Cleans up empty objects in the source file after moving

### list_locales

Lists all available locales for a specific target (core or webview).

## Key Ordering Behavior

To ensure consistency across locales, all non-English locale files maintain the same key order as their English counterparts. This provides several benefits:

1. **Improved Readability**: Developers can easily compare locale files side by side
2. **Easier Diffs**: Version control diffs are more meaningful when keys are in the same order
3. **Reduced Merge Conflicts**: Consistent ordering helps prevent unnecessary merge conflicts

This ordering happens automatically whenever:

- Keys are translated from English to other languages
- Keys are moved between files

If the English locale file cannot be found or accessed during the operation, the tool will fall back to maintaining the original order of the target locale file.

## Usage Notes

- All keys must be in the format `filename:keyPath` (e.g., "kilocode:lowCreditWarning.nice")
- For parent keys (e.g., "kilocode:veryCool"), all child keys will be processed
- The colon format clearly separates the filename from the key path
