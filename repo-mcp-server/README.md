# Translation MCP Server

**Dev tool only:** This is a performance optimization to reduce LLM waiting time during translation tasks. Can be deleted when maintenance burden outweighs time saved.

## Tools

- `translate_i18n_key` - Translate keys from English to other languages
- `move_i18n_key` - Move keys between files across locales
- `list_locales` - List available locales
- `remove_i18n_keys` - Remove keys from all locale files

## Usage

```
npx tsx src/index.ts
```

Requires `OPENROUTER_API_KEY` in parent directory's `.env.local` file.
