---
"kilo-code": minor
---

Include changes from Roo Code 3.25.14

- Fix: Only include verbosity parameter for models that support it (#7054 by @eastonmeth, PR by @app/roomote)
- Fix: AWS Bedrock 1M context - Move anthropic_beta to additionalModelRequestFields (thanks @daniel-lxs!)
- Fix: Make cancelling requests more responsive by reverting recent changes
- Add Sonnet 1M context checkbox to Bedrock
- Fix: add --no-messages flag to ripgrep to suppress file access errors (#6756 by @R-omk, PR by @app/roomote)
- Add support for AGENT.md alongside AGENTS.md (#6912 by @Brendan-Z, PR by @app/roomote)
- Remove deprecated GPT-4.5 Preview model (thanks @PeterDaveHello!)
- Update: Claude Sonnet 4 context window configurable to 1 million tokens in Anthropic provider (thanks @daniel-lxs!)
- Add: Minimal reasoning support to OpenRouter (thanks @daniel-lxs!)
- Fix: Add configurable API request timeout for local providers (#6521 by @dabockster, PR by @app/roomote)
- Fix: Add --no-sandbox flag to browser launch options (#6632 by @QuinsZouls, PR by @QuinsZouls)
- Fix: Ensure JSON files respect .kilocodeignore during indexing (#6690 by @evermoving, PR by @app/roomote)
- Add: New Chutes provider models (#6698 by @fstandhartinger, PR by @app/roomote)
- Add: OpenAI gpt-oss models to Amazon Bedrock dropdown (#6752 by @josh-clanton-powerschool, PR by @app/roomote)
- Fix: Correct tool repetition detector to not block first tool call when limit is 1 (#6834 by @NaccOll, PR by @app/roomote)
- Fix: Improve checkpoint service initialization handling (thanks @NaccOll!)
- Update: Improve zh-TW Traditional Chinese locale (thanks @PeterDaveHello!)
- Add: Task expand and collapse translations (thanks @app/roomote!)
- Update: Exclude GPT-5 models from 20% context window output token cap (thanks @app/roomote!)
- Fix: Truncate long model names in model selector to prevent overflow (thanks @app/roomote!)
- Add: Requesty base url support (thanks @requesty-JohnCosta27!)
- Add: Native OpenAI provider support for Codex Mini model (#5386 by @KJ7LNW, PR by @daniel-lxs)
- Add: IO Intelligence Provider support (thanks @ertan2002!)
- Fix: MCP startup issues and remove refresh notifications (thanks @hannesrudolph!)
- Fix: Improvements to GPT-5 OpenAI provider configuration (thanks @hannesrudolph!)
- Fix: Clarify codebase_search path parameter as optional and improve tool descriptions (thanks @app/roomote!)
- Fix: Bedrock provider workaround for LiteLLM passthrough issues (thanks @jr!)
- Fix: Token usage and cost being underreported on cancelled requests (thanks @chrarnoldus!)
