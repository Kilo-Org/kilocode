---
"kilo-code": minor
---

Include changes from Roo Code v3.27.0

Added from Roo Code v3.26.5-v3.27.0:

- Add: Kimi K2-0905 model support in Chutes provider (#7700 by @pwilkin, PR by @app/roomote)
- Fix: Prevent stack overflow in codebase indexing for large projects (#7588 by @StarTrai1, PR by @daniel-lxs)
- Fix: Resolve race condition in Gemini Grounding Sources by improving code design (#6372 by @daniel-lxs, PR by @HahaBill)
- Fix: Preserve conversation context by retrying with full conversation on invalid previous_response_id (thanks @daniel-lxs!)
- Fix: Identify MCP and slash command config path in multiple folder workspaces (#6720 by @kfuglsang, PR by @NaccOll)
- Fix: Handle array paths from VSCode terminal profiles correctly (#7695 by @Amosvcc, PR by @app/roomote)
- Fix: Improve WelcomeView styling and readability (thanks @daniel-lxs!)
- Fix: Resolve CI e2e test ETIMEDOUT errors when downloading VS Code (thanks @daniel-lxs!)
- Feature: Add OpenAI Responses API service tiers (flex/priority) with UI selector and pricing (thanks @hannesrudolph!)
- Feature: Add DeepInfra as a model provider in Roo Code (#7661 by @Thachnh, PR by @Thachnh)
- Feature: Update kimi-k2-0905-preview and kimi-k2-turbo-preview models on the Moonshot provider (thanks @CellenLee!)
- Feature: Add kimi-k2-0905-preview to Groq, Moonshot, and Fireworks (thanks @daniel-lxs and Cline!)
- Fix: Prevent countdown timer from showing in history for answered follow-up questions (#7624 by @XuyiK, PR by @daniel-lxs)
- Fix: Moonshot's maximum return token count limited to 1024 issue resolved (#6936 by @greyishsong, PR by @wangxiaolong100)
- Fix: Add error transform to cryptic OpenAI SDK errors when API key is invalid (#7483 by @A0nameless0man, PR by @app/roomote)
- Fix: Validate MCP tool exists before execution (#7631 by @R-omk, PR by @app/roomote)
- Fix: Handle zsh glob qualifiers correctly (thanks @mrubens!)
- Fix: Handle zsh process substitution correctly (thanks @mrubens!)
- Fix: Minor zh-TW Traditional Chinese locale typo fix (thanks @PeterDaveHello!)
- Fix: use askApproval wrapper in insert_content and search_and_replace tools (#7648 by @hannesrudolph, PR by @app/roomote)
- Add Kimi K2 Turbo model configuration to moonshotModels (thanks @wangxiaolong100!)
- Fix: preserve scroll position when switching tabs in settings (thanks @DC-Dancao!)
- feat: Add support for Qwen3 235B A22B Thinking 2507 model in chutes (thanks @mohamad154!)
- feat: Add auto-approve support for MCP access_resource tool (#7565 by @m-ibm, PR by @daniel-lxs)
- feat: Add configurable embedding batch size for code indexing (#7356 by @BenLampson, PR by @app/roomote)
- fix: Add cache reporting support for OpenAI-Native provider (thanks @hannesrudolph!)
- feat: Move message queue to the extension host for better performance (thanks @cte!)
