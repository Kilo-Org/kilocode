# First-request context budget

The `kilo packages` PR check captures the default CLI coding agent's first `Hi` request in an empty workspace. It uses a private profile, a local DeepSeek-compatible endpoint and no provider credentials. It downloads checksum-pinned tokenizer and template data; no inference runs.

`budget.json` is the review boundary: exact direct tool names plus a ceiling on the **whole rendered request**, including system instructions, skill listings, tool schemas and Code Mode discovery. A small margin accommodates platform, date and temporary path differences. Prefer on-demand discovery before increasing either budget. Tighten the baseline when removing tools or materially reducing context. Intentional increases should explain the before/after and why the extra default context is necessary. The check never updates the baseline.

To reproduce from the repository root after `bun install --frozen-lockfile`:

```sh
python3 -m venv /tmp/kilo-context-venv
/tmp/kilo-context-venv/bin/pip install -r script/kilocode/context-budget/requirements.txt
/tmp/kilo-context-venv/bin/python script/kilocode/context-budget/check.py
```
