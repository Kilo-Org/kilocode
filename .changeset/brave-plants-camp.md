---
"kilo-code": minor
---

Include changes from Roo Code v3.28.2-v3.28.7

- UX: Collapse thinking blocks by default with UI settings to always show them (thanks @brunobergher!)
- Fix: Resolve checkpoint restore popover positioning issue (#8219 by @NaccOll, PR by @app/roomote)
- Add support for zai-org/GLM-4.5-turbo model in Chutes provider (#8155 by @mugnimaestra, PR by @app/roomote)
- Fix: Improve reasoning block formatting for better readability (thanks @daniel-lxs!)
- Fix: Respect Ollama Modelfile num_ctx configuration (#7797 by @hannesrudolph, PR by @app/roomote)
- Fix: Prevent checkpoint text from wrapping in non-English languages (#8206 by @NaccOll, PR by @app/roomote)
- Fix: Bare metal evals fixes (thanks @cte!)
- Fix: Follow-up questions should trigger the "interactive" state (thanks @cte!)
- Fix: Resolve duplicate rehydrate during reasoning; centralize rehydrate and preserve cancel metadata (#8153 by @hannesrudolph, PR by @hannesrudolph)
- Fix: Support dash prefix in parseMarkdownChecklist for todo lists (#8054 by @NaccOll, PR by app/roomote)
- Fix: Apply tiered pricing for Gemini models via Vertex AI (#8017 by @ikumi3, PR by app/roomote)
- Update SambaNova models to latest versions (thanks @snova-jorgep!)
- UX: Redesigned Message Feed (thanks @brunobergher!)
- UX: Responsive Auto-Approve (thanks @brunobergher!)
- Add telemetry retry queue for network resilience (thanks @daniel-lxs!)
- Fix: Filter out Claude Code built-in tools (ExitPlanMode, BashOutput, KillBash) (#7817 by @juliettefournier-econ, PR by @roomote)
- Fix: Corrected C# tree-sitter query (#5238 by @vadash, PR by @mubeen-zulfiqar)
- Add keyboard shortcut for "Add to Context" action (#7907 by @hannesrudolph, PR by @roomote)
- Fix: Context menu is obscured when edit message (#7759 by @mini2s, PR by @NaccOll)
- Fix: Handle ByteString conversion errors in OpenAI embedders (#7959 by @PavelA85, PR by @daniel-lxs)
- Bring back a way to temporarily and globally pause auto-approve without losing your toggle state (thanks @brunobergher!)
