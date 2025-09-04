# kilo-code

## [v4.89.0]

- [#2242](https://github.com/Kilo-Org/kilocode/pull/2242) [`f474c89`](https://github.com/Kilo-Org/kilocode/commit/f474c89e3881955d2f41b8912b728e91eddb87f8) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.26.4

    - Optimize memory usage for image handling in webview (thanks @daniel-lxs!)
    - Fix: Special tokens should not break task processing (#7539 by @pwilkin, PR by @pwilkin)
    - Add Ollama API key support for Turbo mode (#7147 by @LivioGama, PR by @app/roomote)
    - Add optional input image parameter to image generation tool (thanks @roomote!)
    - Refactor: Flatten image generation settings structure (thanks @daniel-lxs!)
    - Show console logging in vitests when the --no-silent flag is set (thanks @hassoncs!)
    - feat: Add experimental image generation tool with OpenRouter integration (thanks @daniel-lxs!)
    - Fix: Resolve GPT-5 Responses API issues with condensing and image support (#7334 by @nlbuescher, PR by @daniel-lxs)
    - Fix: Hide .kilocodeignore'd files from environment details by default (#7368 by @AlexBlack772, PR by @app/roomote)
    - Fix: Exclude browser scroll actions from repetition detection (#7470 by @cgrierson-smartsheet, PR by @app/roomote)
    - Add Vercel AI Gateway provider integration (thanks @joshualipman123!)
    - Add support for Vercel embeddings (thanks @mrubens!)
    - Enable on-disk storage for Qdrant vectors and HNSW index (thanks @daniel-lxs!)
    - Update tooltip component to match native VSCode tooltip shadow styling (thanks @roomote!)
    - Fix: remove duplicate cache display in task header (thanks @mrubens!)
    - Random chat text area cleanup (thanks @cte!)
    - feat: Add Deepseek v3.1 to Fireworks AI provider (#7374 by @dmarkey, PR by @app/roomote)
    - Fix: Make auto approve toggle trigger stay (#3909 by @kyle-apex, PR by @elianiva)
    - Fix: Preserve user input when selecting follow-up choices (#7316 by @teihome, PR by @daniel-lxs)
    - Fix: Handle Mistral thinking content as reasoning chunks (#6842 by @Biotrioo, PR by @app/roomote)
    - Fix: Resolve newTaskRequireTodos setting not working correctly (thanks @hannesrudolph!)
    - Fix: Requesty model listing (#7377 by @dtrugman, PR by @dtrugman)
    - feat: Hide static providers with no models from provider list (thanks @daniel-lxs!)
    - Add todos parameter to new_task tool usage in issue-fixer mode (thanks @hannesrudolph!)
    - Handle substitution patterns in command validation (thanks @mrubens!)
    - Mark code-workspace files as protected (thanks @mrubens!)
    - Update list of default allowed commands (thanks @mrubens!)
    - Follow symlinks in rooignore checks (thanks @mrubens!)
    - Show cache read and write prices for OpenRouter inference providers (thanks @chrarnoldus!)

## [v4.88.0]

- [#2235](https://github.com/Kilo-Org/kilocode/pull/2235) [`fbf4e42`](https://github.com/Kilo-Org/kilocode/commit/fbf4e42125cef538387301be784ede7d2609fe16) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Rename Inline Assist to Kilo Code Autocomplete

- [#2202](https://github.com/Kilo-Org/kilocode/pull/2202) [`92ef190`](https://github.com/Kilo-Org/kilocode/commit/92ef190d8d9e5ec0df3cbdd8488c98f4190f57b2) Thanks [@hassoncs](https://github.com/hassoncs)! - Show a warning when trying to paste an image when the current model does not support images

### Patch Changes

- [#2244](https://github.com/Kilo-Org/kilocode/pull/2244) [`6a83c5a`](https://github.com/Kilo-Org/kilocode/commit/6a83c5acdd8153a2d8c89aff9644883061c7efe6) Thanks [@hassoncs](https://github.com/hassoncs)! - Prevent writing to files outside the workspace by default

    This should mitigate supply chain compromise attacks via prompt injection. Thank you, Evan Harris from MCP Security Research for finding this!

- [#2245](https://github.com/Kilo-Org/kilocode/pull/2245) [`fff884f`](https://github.com/Kilo-Org/kilocode/commit/fff884fd6f2f1be4906e3d4494adeed3017e8d57) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix Kilo Code Marketplace header missing background color

- [#2237](https://github.com/Kilo-Org/kilocode/pull/2237) [`06c6e8b`](https://github.com/Kilo-Org/kilocode/commit/06c6e8b013b54fc7706a9862af9ddabc86fb8781) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Kilo Code now shows an error message when a model reaches its maximum ouput

- [#2238](https://github.com/Kilo-Org/kilocode/pull/2238) [`b5de938`](https://github.com/Kilo-Org/kilocode/commit/b5de93836338c0398dfa6dede89dbb92f525ceef) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed 500 error with Chutes when no custom temperature is specified.

- [#2248](https://github.com/Kilo-Org/kilocode/pull/2248) [`b8c6f27`](https://github.com/Kilo-Org/kilocode/commit/b8c6f2780757f16e1599b989bb88d235c26233c4) Thanks [@hassoncs](https://github.com/hassoncs)! - Remove the Inline Assist experiment, enabling it by default

    The individual commands and keyboard shortcuts can still be enabled/disabled individually in the settings.

## [v4.87.0]

- [#2010](https://github.com/Kilo-Org/kilocode/pull/2010) [`a7b89d3`](https://github.com/Kilo-Org/kilocode/commit/a7b89d3cf173e6f5d1915aece598489d63652b5f) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - There is now a "See New Changes" button below a Task Completed message. Use this button to see all file changes made since the previous Task Completed message. This feature requires checkpoints to be enabled.

### Patch Changes

- [#2215](https://github.com/Kilo-Org/kilocode/pull/2215) [`4b102aa`](https://github.com/Kilo-Org/kilocode/commit/4b102aaeb42e776e224d71d5fc55033ff0388442) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The Data Provider Collection setting in the Kilo Code and OpenRouter provider settings is now enabled even when a specific inference provider is selected.

- [#2228](https://github.com/Kilo-Org/kilocode/pull/2228) [`5bd17b9`](https://github.com/Kilo-Org/kilocode/commit/5bd17b9ff2b44282200992befad618729e2c1e8e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Warning messages for common cases where checkpoints do not work were added

- [#2174](https://github.com/Kilo-Org/kilocode/pull/2174) [`a1d0972`](https://github.com/Kilo-Org/kilocode/commit/a1d097294a2fd64bd86a6260169d450fb36966f0) Thanks [@TimAidley](https://github.com/TimAidley)! - Add GPT-5 support to LiteLLM provider

- [#2216](https://github.com/Kilo-Org/kilocode/pull/2216) [`479821f`](https://github.com/Kilo-Org/kilocode/commit/479821f84d64d91412996a24d4ed9314f7373839) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The OLLAMA_CONTEXT_LENGTH environment variable is now prioritized over the model's num_ctx parameter.

- [#2191](https://github.com/Kilo-Org/kilocode/pull/2191) [`6fcde72`](https://github.com/Kilo-Org/kilocode/commit/6fcde72c3470d5634a8091dc92191a50f07bab40) Thanks [@hassoncs](https://github.com/hassoncs)! - Explicitly disable the web version of the extension since it is not compatible (vscode.dev)

## [v4.86.0]

- [#2012](https://github.com/Kilo-Org/kilocode/pull/2012) [`1fd698a`](https://github.com/Kilo-Org/kilocode/commit/1fd698ad2025946519a0ce2d516ec528ea92eea4) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improve Inline Assist model compatibility and performance

- [#2199](https://github.com/Kilo-Org/kilocode/pull/2199) [`a19f72c`](https://github.com/Kilo-Org/kilocode/commit/a19f72c05f2bed48106b33c6eaa9f4e9e6d4d020) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Thanks @Thachnh! - Added DeepInfra provider with dynamic model fetching and prompt caching

### Patch Changes

- [#2170](https://github.com/Kilo-Org/kilocode/pull/2170) [`58987e3`](https://github.com/Kilo-Org/kilocode/commit/58987e36377724b639d4b19a2d92162b34bc5eaa) Thanks [@mcowger](https://github.com/mcowger)! - Remove the forced override of the context limit for Ollama API

## [v4.85.0]

- [#2119](https://github.com/Kilo-Org/kilocode/pull/2119) [`19dc45d`](https://github.com/Kilo-Org/kilocode/commit/19dc45d1b1578a41c41ecb787e7945513f6554d9) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.25.23

    - feat: add custom base URL support for Requesty provider (thanks @requesty-JohnCosta27!)
    - feat: add DeepSeek V3.1 model to Chutes AI provider (#7294 by @dmarkey, PR by @app/roomote)
    - Add prompt caching support for Kimi K2 on Groq (thanks @daniel-lxs and @benank!)
    - Add documentation links for global custom instructions in UI (thanks @app/roomote!)
    - Ensure subtask results are provided to GPT-5 in OpenAI Responses API
    - Promote the experimental AssistantMessageParser to the default parser
    - Update DeepSeek models context window to 128k (thanks @JuanPerezReal)
    - Enable grounding features for Vertex AI (thanks @anguslees)
    - Allow orchestrator to pass TODO lists to subtasks
    - Improved MDM handling
    - Handle nullish token values in ContextCondenseRow to prevent UI crash (thanks @s97712)
    - Improved context window error handling for OpenAI and other providers
    - Add "installed" filter to Marketplace (thanks @semidark)
    - Improve filesystem access checks (thanks @elianiva)
    - Add Featherless provider (thanks @DarinVerheijke)

### Patch Changes

- [#2184](https://github.com/Kilo-Org/kilocode/pull/2184) [`0be6743`](https://github.com/Kilo-Org/kilocode/commit/0be6743e08540d1671c10f79b49f17eeac82397e) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix: add favorite button back to tasks

- [#2125](https://github.com/Kilo-Org/kilocode/pull/2125) [`5828254`](https://github.com/Kilo-Org/kilocode/commit/5828254d47e9073c0f0fc9c9db5ef38eb6358036) Thanks [@nitinprajwal](https://github.com/nitinprajwal)! - Added support to Qwen Code for a custom OAuth credential storage path

## [v4.84.1]

- [#2113](https://github.com/Kilo-Org/kilocode/pull/2113) [`d40b35a`](https://github.com/Kilo-Org/kilocode/commit/d40b35a3a1efcc2fbfca51d4ca64a8da2aa321e5) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The model selector below the chat now shows the correct model list for Qwen Code and some other providers

- [#2116](https://github.com/Kilo-Org/kilocode/pull/2116) [`61e18d6`](https://github.com/Kilo-Org/kilocode/commit/61e18d60f54d11d63a64cd674474a68fa398c3b9) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Checkpoints now work when using Morph fast apply

- [#2130](https://github.com/Kilo-Org/kilocode/pull/2130) [`78aaf7c`](https://github.com/Kilo-Org/kilocode/commit/78aaf7c4607c5a98174a26b99973e379b87e5893) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Added support for Grok Code Fast to the xAI provider

- [#2109](https://github.com/Kilo-Org/kilocode/pull/2109) [`173ecf4`](https://github.com/Kilo-Org/kilocode/commit/173ecf4983449a4b7766ba900f736a57b7d5d525) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - A solitary "0" that was sometimes shown on the Kilo Code and OpenRouter API provider settings page was removed.

## [v4.84.0]

- [#1961](https://github.com/Kilo-Org/kilocode/pull/1961) [`d4a7cb6`](https://github.com/Kilo-Org/kilocode/commit/d4a7cb6300d8e00d5889e1079057e43de19ff95e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Updates to the experimental Morph FastApply support

    - A visual indication is now included in the task view whenever Morph is used.
    - The traditional file editing tools are now disabled to ensure Morph is used to edit files.
    - Morph is now automatically disabled when the API provider does not support it and no Morph API key is configured.
    - The Morph API key is no longer lost when switching provider profiles.

- [#1886](https://github.com/Kilo-Org/kilocode/pull/1886) [`0221aaa`](https://github.com/Kilo-Org/kilocode/commit/0221aaa4febea9dfeea8cfbb26fa355204e75d1b) Thanks [@mcowger](https://github.com/mcowger)! - Add collapsible MCP tool calls with memory management

### Patch Changes

- [#2095](https://github.com/Kilo-Org/kilocode/pull/2095) [`8623bb8`](https://github.com/Kilo-Org/kilocode/commit/8623bb8516a7453d299512bd11c5000f43ecb952) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Kilo Code provider now falls back to the default model when the selected model no longer exists

- [#2090](https://github.com/Kilo-Org/kilocode/pull/2090) [`fd147b8`](https://github.com/Kilo-Org/kilocode/commit/fd147b8ed35c8963ec66c5fae89f37829529574f) Thanks [@Mats4k](https://github.com/Mats4k)! - Improvements to German language translation

- [#2030](https://github.com/Kilo-Org/kilocode/pull/2030) [`11e8c7d`](https://github.com/Kilo-Org/kilocode/commit/11e8c7dda9f03b769e22f233b5ea487c9a12bd66) Thanks [@ivanarifin](https://github.com/ivanarifin)! - Show message when Virtual Quota Fallback Provider switches profiles

- [#2100](https://github.com/Kilo-Org/kilocode/pull/2100) [`5ed3d7b`](https://github.com/Kilo-Org/kilocode/commit/5ed3d7be3273fef7ff0eeede8db064fc9bdb4fe0) Thanks [@RSO](https://github.com/RSO)! - Changed the API domain for the Kilo Code provider

- [#1964](https://github.com/Kilo-Org/kilocode/pull/1964) [`6b0dfbf`](https://github.com/Kilo-Org/kilocode/commit/6b0dfbf10a397063f02e0dd6964d1fb1b773cf12) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The Kilo Code API Provider settings now also shows the average cost per request in addition to the average cost per million tokens for a particular model.

## [v4.83.1]

- [#2073](https://github.com/Kilo-Org/kilocode/pull/2073) [`a4b8770`](https://github.com/Kilo-Org/kilocode/commit/a4b8770ba82cbb366bb986a36026b6860129f799) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Ensured free model usage is reported as free

- [#2066](https://github.com/Kilo-Org/kilocode/pull/2066) [`62624d2`](https://github.com/Kilo-Org/kilocode/commit/62624d21f4f3408a552b5f0308d35be154d403b3) Thanks [@mcowger](https://github.com/mcowger)! - Fixed "'messages' field is required" error in LMStudio

- [#2064](https://github.com/Kilo-Org/kilocode/pull/2064) [`8655a71`](https://github.com/Kilo-Org/kilocode/commit/8655a712d7fc84fce1a7aa8c928fa2b32a68cf24) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improved the "language model did not provide any assistant messages" error message to indicate that it likely involves rate limiting

## [v4.83.0]

- [#2063](https://github.com/Kilo-Org/kilocode/pull/2063) [`e844c5f`](https://github.com/Kilo-Org/kilocode/commit/e844c5f3a43c0808a037156e44f621b36a529abd) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add marketplace for modes

- [#2050](https://github.com/Kilo-Org/kilocode/pull/2050) [`0ffe951`](https://github.com/Kilo-Org/kilocode/commit/0ffe951af4d356984608df623c410327cee7f130) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.25.20

    - Fix: respect enableReasoningEffort setting when determining reasoning usage (#7048 by @ikbencasdoei, PR by @app/roomote)
    - Fix: prevent duplicate LM Studio models with case-insensitive deduplication (#6954 by @fbuechler, PR by @daniel-lxs)
    - Feat: simplify ask_followup_question prompt documentation (thanks @daniel-lxs!)
    - Feat: simple read_file tool for single-file-only models (thanks @daniel-lxs!)
    - Fix: Add missing zaiApiKey and doubaoApiKey to SECRET_STATE_KEYS (#7082 by @app/roomote)
    - Feat: Add new models and update configurations for vscode-lm (thanks @NaccOll!)
    - Fix: Resolve terminal reuse logic issues
    - Add support for OpenAI gpt-5-chat-latest model (#7057 by @PeterDaveHello, PR by @app/roomote)
    - Fix: Use native Ollama API instead of OpenAI compatibility layer (#7070 by @LivioGama, PR by @daniel-lxs)
    - Fix: Prevent XML entity decoding in diff tools (#7107 by @indiesewell, PR by @app/roomote)
    - Fix: Add type check before calling .match() on diffItem.content (#6905 by @pwilkin, PR by @app/roomote)
    - Refactor task execution system: improve call stack management (thanks @catrielmuller!)
    - Fix: Enable save button for provider dropdown and checkbox changes (thanks @daniel-lxs!)
    - Add an API for resuming tasks by ID (thanks @mrubens!)
    - Emit event when a task ask requires interaction (thanks @cte!)
    - Make enhance with task history default to true (thanks @liwilliam2021!)
    - Fix: Use cline.cwd as primary source for workspace path in codebaseSearchTool (thanks @NaccOll!)
    - Hotfix multiple folder workspace checkpoint (thanks @NaccOll!)
    - Fix: Remove 500-message limit to prevent scrollbar jumping in long conversations (#7052, #7063 by @daniel-lxs, PR by @app/roomote)
    - Fix: Reset condensing state when switching tasks (#6919 by @f14XuanLv, PR by @f14XuanLv)
    - Fix: Implement sitemap generation in TypeScript and remove XML file (#5231 by @abumalick, PR by @abumalick)
    - Fix: allowedMaxRequests and allowedMaxCost values not showing in the settings UI (thanks @chrarnoldus!)

## [v4.82.3]

- [#2047](https://github.com/Kilo-Org/kilocode/pull/2047) [`077b774`](https://github.com/Kilo-Org/kilocode/commit/077b774deaf1a65d7864db0c1248cfa9574b93b9) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed an issue that caused the same error to be reported multiple times

## [v4.82.2]

- [#1811](https://github.com/Kilo-Org/kilocode/pull/1811) [`5f7afe6`](https://github.com/Kilo-Org/kilocode/commit/5f7afe6ffeb1078428b0b43c6d9a4e9252e78bc8) Thanks [@gerardbalaoro](https://github.com/gerardbalaoro)! - Adjust position within context menus to be below default items

- [#2033](https://github.com/Kilo-Org/kilocode/pull/2033) [`8aef7ef`](https://github.com/Kilo-Org/kilocode/commit/8aef7efc9597613010339a667f87328cf70c9ce1) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Thanks @daniel-lxs! - Added a single-file read tool that works better with Sonic than the default multi-file read tool.

## [v4.82.1]

- [#2021](https://github.com/Kilo-Org/kilocode/pull/2021) [`02adf7c`](https://github.com/Kilo-Org/kilocode/commit/02adf7c4780170125e0f54beaeb5a3cbbd972669) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - OpenRouter inference providers whose context window is smaller than that of the top provider for a particular model are now automatically ignored by default. They can still be used by selecting them specifically in the Provider Routing settings.

- [#2015](https://github.com/Kilo-Org/kilocode/pull/2015) [`e5c7641`](https://github.com/Kilo-Org/kilocode/commit/e5c76411cc3ff6f5aae53e5d1e39775d6830e03e) Thanks [@mcowger](https://github.com/mcowger)! - Add API key support to the Ollama provider, enabling usage of Ollama Turbo

- [#2029](https://github.com/Kilo-Org/kilocode/pull/2029) [`64c6955`](https://github.com/Kilo-Org/kilocode/commit/64c695517dd8a5556c418d88c8338ea090ea09a9) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add search to provider list and sort it alphabetically

## [v4.82.0]

- [#1974](https://github.com/Kilo-Org/kilocode/pull/1974) [`ec18e51`](https://github.com/Kilo-Org/kilocode/commit/ec18e51d7f38c2f5ee21a02cf2290be21223119b) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code 3.25.14

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

## [v4.81.0]

- [#1868](https://github.com/Kilo-Org/kilocode/pull/1868) [`50638b4`](https://github.com/Kilo-Org/kilocode/commit/50638b4226aa3de24f5a9b825a8ef7f1e4d376f6) Thanks [@Toukaiteio](https://github.com/Toukaiteio)! - Add Support For Qwen Code

### Patch Changes

- [#1968](https://github.com/Kilo-Org/kilocode/pull/1968) [`e7680cc`](https://github.com/Kilo-Org/kilocode/commit/e7680cc7f9563a52d4a4babe70ca300ce67aef4a) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - OpenRouter routing settings are no longer randomly reset

- [#1948](https://github.com/Kilo-Org/kilocode/pull/1948) [`ecc81c6`](https://github.com/Kilo-Org/kilocode/commit/ecc81c61db648f2701aa7d71f70cefc71a553300) Thanks [@hassoncs](https://github.com/hassoncs)! - Support drag-to-pan in the Task Timeline header

- [#1899](https://github.com/Kilo-Org/kilocode/pull/1899) [`22c59ba`](https://github.com/Kilo-Org/kilocode/commit/22c59ba824199f9be7662e56fa71a74ca042c7bd) Thanks [@ivanarifin](https://github.com/ivanarifin)! - Improve virtual quota fallback handler initialization and error handling

- [#1955](https://github.com/Kilo-Org/kilocode/pull/1955) [`553033a`](https://github.com/Kilo-Org/kilocode/commit/553033af3220c66e177f516df1bc6b7ee431192e) Thanks [@hassoncs](https://github.com/hassoncs)! - Add Max Cost input to the AutoApprove menu in the ChatView

## [v4.80.0]

- [#1893](https://github.com/Kilo-Org/kilocode/pull/1893) [`d36b1c1`](https://github.com/Kilo-Org/kilocode/commit/d36b1c17fa9d5cb06d13865b4d1ba1e66500a85c) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - More price details are now shown for Kilo Code Provider and OpenRouter. Average Kilo Code cost is the average cost of a model when using Kilo Code, after applying caching discounts. A breakdown of provider prices is also available.

- [#1893](https://github.com/Kilo-Org/kilocode/pull/1893) [`d36b1c1`](https://github.com/Kilo-Org/kilocode/commit/d36b1c17fa9d5cb06d13865b4d1ba1e66500a85c) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Provider Routing options have been added to Kilo Code and OpenRouter settings. It is now possible to select a sorting preference (e.g. prefer lower price) and data policy (e.g. deny data collection).

### Patch Changes

- [#1924](https://github.com/Kilo-Org/kilocode/pull/1924) [`f7d54ee`](https://github.com/Kilo-Org/kilocode/commit/f7d54eee006c21e3b7760e2ee88f144760731892) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The dedicated Big Model API provider was removed. Instead, you can use the Z.AI provider with open.bigmodel.cn endpoint.

## [v4.79.3]

- [#1911](https://github.com/Kilo-Org/kilocode/pull/1911) [`62018d4`](https://github.com/Kilo-Org/kilocode/commit/62018d4cb0dff0386bdccc68ce4a9dbb21834e8f) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed Enhance Prompt and Commit Message Generation not working with GPT-5 on the OpenAI provider

## [v4.79.2]

- [#1892](https://github.com/Kilo-Org/kilocode/pull/1892) [`c5cfb6c`](https://github.com/Kilo-Org/kilocode/commit/c5cfb6cc0af6b7de2a33832b6b1b56b60b950edc) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed not being able to set the Max Auto-Approve Cost

- [#1889](https://github.com/Kilo-Org/kilocode/pull/1889) [`2bbebd0`](https://github.com/Kilo-Org/kilocode/commit/2bbebd09c27a00c197de9dfcc384f34880fdb46f) Thanks [@unitythemaker](https://github.com/unitythemaker)! - Chutes model list updated

- [#1879](https://github.com/Kilo-Org/kilocode/pull/1879) [`e348ea1`](https://github.com/Kilo-Org/kilocode/commit/e348ea18cbbfc76abece9cbe9e54bc477e764e99) Thanks [@possible055](https://github.com/possible055)! - Update Traditional Chinese translations for Settings UI

## [v4.79.1]

- [#1871](https://github.com/Kilo-Org/kilocode/pull/1871) [`fe0b1ce`](https://github.com/Kilo-Org/kilocode/commit/fe0b1ce7141e6fb07f4c4816fd1895a663ce13e7) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.25.10

    - Improved support for GPT-5 (thanks Cline and @app/roomote!)
    - Fix: Use CDATA sections in XML examples to prevent parser errors (#4852 by @hannesrudolph, PR by @hannesrudolph)
    - Fix: Add missing MCP error translation keys (thanks @app/roomote!)
    - Fix: Resolve rounding issue with max tokens (#6806 by @markp018, PR by @mrubens)
    - Add support for GLM-4.5 and OpenAI gpt-oss models in Fireworks provider (#6753 by @alexfarlander, PR by @app/roomote)
    - Improve UX by focusing chat input when clicking plus button in extension menu (thanks @app/roomote!)

## [v4.79.0]

- [#1862](https://github.com/Kilo-Org/kilocode/pull/1862) [`43c7179`](https://github.com/Kilo-Org/kilocode/commit/43c71796a58e25805217c520a9d612d56b2f11d5) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.25.8

    - Fix: Prevent disabled MCP servers from starting processes and show correct status (#6036 by @hannesrudolph, PR by @app/roomote)
    - Fix: Handle current directory path "." correctly in codebase_search tool (#6514 by @hannesrudolph, PR by @app/roomote)
    - Fix: Trim whitespace from OpenAI base URL to fix model detection (#6559 by @vauhochzett, PR by @app/roomote)
    - Feat: Reduce Gemini 2.5 Pro minimum thinking budget to 128 (thanks @app/roomote!)
    - Fix: Improve handling of net::ERR_ABORTED errors in URL fetching (#6632 by @QuinsZouls, PR by @app/roomote)
    - Fix: Recover from error state when Qdrant becomes available (#6660 by @hannesrudolph, PR by @app/roomote)
    - Fix: Resolve memory leak in ChatView virtual scrolling implementation (thanks @xyOz-dev!)
    - Add: Swift files to fallback list (#5857 by @niteshbalusu11, #6555 by @sealad886, PR by @niteshbalusu11)
    - Feat: Clamp default model max tokens to 20% of context window (thanks @mrubens!)
    - Add support for Claude Opus 4.1
    - Add code indexing support for multiple folders similar to task history (#6197 by @NaccOll, PR by @NaccOll)
    - Make mode selection dropdowns responsive (#6423 by @AyazKaan, PR by @AyazKaan)
    - Redesigned task header and task history (thanks @brunobergher!)
    - Fix checkpoints timing and ensure checkpoints work properly (#4827 by @mrubens, PR by @NaccOll)
    - Fix empty mode names from being saved (#5766 by @kfxmvp, PR by @app/roomote)
    - Fix MCP server creation when setting is disabled (#6607 by @characharm, PR by @app/roomote)
    - Update highlight layer style and align to textarea (#6647 by @NaccOll, PR by @NaccOll)
    - Fix UI for approving chained commands
    - Use assistantMessageParser class instead of parseAssistantMessage (#5340 by @qdaxb, PR by @qdaxb)
    - Conditionally include reminder section based on todo list config (thanks @NaccOll!)
    - Task and TaskProvider event emitter cleanup with new events (thanks @cte!)
    - Set horizon-beta model max tokens to 32k for OpenRouter (requested by @hannesrudolph, PR by @app/roomote)
    - Add support for syncing provider profiles from the cloud
    - Fix: Improve Claude Code ENOENT error handling with installation guidance (#5866 by @JamieJ1, PR by @app/roomote)
    - Fix: LM Studio model context length (#5075 by @Angular-Angel, PR by @pwilkin)
    - Fix: VB.NET indexing by implementing fallback chunking system (#6420 by @JensvanZutphen, PR by @daniel-lxs)
    - Add auto-approved cost limits (thanks @hassoncs!)
    - Add Qwen 3 Coder from Cerebras (thanks @kevint-cerebras!)
    - Fix: Handle Qdrant deletion errors gracefully to prevent indexing interruption (thanks @daniel-lxs!)
    - Fix: Restore message sending when clicking save button (thanks @daniel-lxs!)
    - Fix: Linter not applied to locales/\*/README.md (thanks @liwilliam2021!)
    - Handle more variations of chaining and subshell command validation
    - More tolerant search/replace match
    - Clean up the auto-approve UI (thanks @mrubens!)
    - Skip interpolation for non-existent slash commands (thanks @app/roomote!)

### Patch Changes

- [#1856](https://github.com/Kilo-Org/kilocode/pull/1856) [`9c8423e`](https://github.com/Kilo-Org/kilocode/commit/9c8423ef902cf68566185dbf96dae92f4fcac9b3) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed Enhance Prompt and Commit Generation Message not working with GPT-5 on the OpenAI provider

- [#1822](https://github.com/Kilo-Org/kilocode/pull/1822) [`79efaea`](https://github.com/Kilo-Org/kilocode/commit/79efaeaa3da8881310feb4a711f475810df5f84e) Thanks [@tejaschokhawala](https://github.com/tejaschokhawala)! - Thinking Budget value parsing and boundary handling corrected

- [#1850](https://github.com/Kilo-Org/kilocode/pull/1850) [`b9714db`](https://github.com/Kilo-Org/kilocode/commit/b9714dbbdde7e6ec628d32657329fe82c01cfb42) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed "Failed to load Kilo Code provider model list" error

- [#1829](https://github.com/Kilo-Org/kilocode/pull/1829) [`2bdeaa0`](https://github.com/Kilo-Org/kilocode/commit/2bdeaa05074e5e87ffa2af1bbed149864dbd3785) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improve memory allocation on webview

## [v4.78.0]

- [#1836](https://github.com/Kilo-Org/kilocode/pull/1836) [`1cc5edd`](https://github.com/Kilo-Org/kilocode/commit/1cc5edd003434fcd3d1fd66e652099165b077ac6) Thanks [@hassoncs](https://github.com/hassoncs)! - The task timeline now scrolls horizontally using the mouse wheel (thanks @ABODFTW!)

### Patch Changes

- [#1814](https://github.com/Kilo-Org/kilocode/pull/1814) [`3e7290e`](https://github.com/Kilo-Org/kilocode/commit/3e7290e49974d26ee55bcaef743edb527e214735) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Removed "Press Ctrl+Shift+G to generate terminal commands" message

- [#1832](https://github.com/Kilo-Org/kilocode/pull/1832) [`80b0f20`](https://github.com/Kilo-Org/kilocode/commit/80b0f209ad823ac23f30838ba3989dbf877fce73) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add GPT-5 model support to OpenAI provider

## [v4.77.1]

- [#1792](https://github.com/Kilo-Org/kilocode/pull/1792) [`ee300bc`](https://github.com/Kilo-Org/kilocode/commit/ee300bcd9138049182f9979ea9794996c96ee3d1) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix infinite spinning initial API request

## [v4.77.0]

- [#1784](https://github.com/Kilo-Org/kilocode/pull/1784) [`bf5bd8e`](https://github.com/Kilo-Org/kilocode/commit/bf5bd8e22e34191730512f0f793d45b6f3a0a694) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Inline Assist - Improve compatibility with more models (JSON Parsing)

### Patch Changes

- [#1786](https://github.com/Kilo-Org/kilocode/pull/1786) [`26cb921`](https://github.com/Kilo-Org/kilocode/commit/26cb92172d361bb274cb30d81f400136bff06f1e) Thanks [@hellosunghyun](https://github.com/hellosunghyun)! - Update Cerebras models with latest offerings

## [v4.76.0]

- [#1738](https://github.com/Kilo-Org/kilocode/pull/1738) [`0d3643b`](https://github.com/Kilo-Org/kilocode/commit/0d3643b4926fb1d77c865eb96ab9bcfdc49e1ea3) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Inline Assistant: Auto trigger - automatically show code suggestions after a configurable delay

- [#1631](https://github.com/Kilo-Org/kilocode/pull/1631) [`b4f6e09`](https://github.com/Kilo-Org/kilocode/commit/b4f6e09ad57a9e00b5b64f7d75311c647cdf5fce) Thanks [@mcowger](https://github.com/mcowger)! - Add support for virtual provider usage tracking, and fix a selection race condition.

### Patch Changes

- [#1776](https://github.com/Kilo-Org/kilocode/pull/1776) [`7a705a2`](https://github.com/Kilo-Org/kilocode/commit/7a705a26a9b1bb56579e44f01810c42585c75e53) Thanks [@ipkalid](https://github.com/ipkalid)! - add GPT-OSS 120b and 20b models to Groq provider

## [v4.75.0]

- [#1750](https://github.com/Kilo-Org/kilocode/pull/1750) [`4e48339`](https://github.com/Kilo-Org/kilocode/commit/4e48339bb1651e83fe40f481a66c97720afe9900) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Increased maximum system prompt length for Claude Code

### Patch Changes

- [#1761](https://github.com/Kilo-Org/kilocode/pull/1761) [`c13bf0c`](https://github.com/Kilo-Org/kilocode/commit/c13bf0c03cd26f40a705fde2dc0ce67a1e1cc622) Thanks [@Ed4ward](https://github.com/Ed4ward)! - adjust the configurations of BigModel provider for GLM-4.5, added tiers for models prices

- [#1755](https://github.com/Kilo-Org/kilocode/pull/1755) [`9054e23`](https://github.com/Kilo-Org/kilocode/commit/9054e23bd9ca05f920845b8e24d1785fcf9a0e2e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add support for GLM-4.5-Flash, Zhipu's most advanced free model to date, to the BigModel and Z.AI providers.

- [#1741](https://github.com/Kilo-Org/kilocode/pull/1741) [`8ae7c1f`](https://github.com/Kilo-Org/kilocode/commit/8ae7c1f7558cff4370976d347ddc532ecf48fc45) Thanks [@tejaschokhawala](https://github.com/tejaschokhawala)! - feat(gemini): Add Gemma 3 27B to Gemini Provider

- [#1744](https://github.com/Kilo-Org/kilocode/pull/1744) [`b8f3267`](https://github.com/Kilo-Org/kilocode/commit/b8f3267e584ea0399e1bdb89b2b03fd08b8c1f1b) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix Message queue #1736

- [#1763](https://github.com/Kilo-Org/kilocode/pull/1763) [`d3cfbcd`](https://github.com/Kilo-Org/kilocode/commit/d3cfbcd8ccd3820837ba86ee9f7c25a2d4fd44e0) Thanks [@ershang-fireworks](https://github.com/ershang-fireworks)! - Fix fireworks provider

## [v4.74.0]

- [#1721](https://github.com/Kilo-Org/kilocode/pull/1721) [`3f816a8`](https://github.com/Kilo-Org/kilocode/commit/3f816a8e65b7c94d7212130f1312c9d77ff84ebf) Thanks [@damonto](https://github.com/damonto)! - Remove shortcut notation from activity bar title that was present in some languages

- [#1731](https://github.com/Kilo-Org/kilocode/pull/1731) [`8aa1cd3`](https://github.com/Kilo-Org/kilocode/commit/8aa1cd3cd6fa462d8dce4961ff13080d4683161d) Thanks [@Ed4ward](https://github.com/Ed4ward)! - Added Z.AI & BigModel providers for GLM-4.5 Serials

### Patch Changes

- [#1717](https://github.com/Kilo-Org/kilocode/pull/1717) [`529c0d6`](https://github.com/Kilo-Org/kilocode/commit/529c0d61da1f45e93604dd98ed10bf74f694f02f) Thanks [@hassoncs](https://github.com/hassoncs)! - Only show the terminal generation tip once per session

- [#1743](https://github.com/Kilo-Org/kilocode/pull/1743) [`b5a50d1`](https://github.com/Kilo-Org/kilocode/commit/b5a50d198306dcf24d16437ccf409e54fd3972cc) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix bug preventing Orchestrator mode sub-tasks from reporting their results properly

- [#1720](https://github.com/Kilo-Org/kilocode/pull/1720) [`23dfe72`](https://github.com/Kilo-Org/kilocode/commit/23dfe7256bdf95a3be8db4dcc9d8dc6c9ac1d37a) Thanks [@k9evin](https://github.com/k9evin)! - Fix MCP Marketplace installation modal state issue

- [#1735](https://github.com/Kilo-Org/kilocode/pull/1735) [`783e291`](https://github.com/Kilo-Org/kilocode/commit/783e2915bf8795f39f8d63615dd48d79cbd1760a) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix workflows don't work

- [#1734](https://github.com/Kilo-Org/kilocode/pull/1734) [`e2de39f`](https://github.com/Kilo-Org/kilocode/commit/e2de39f9082b26336992248ce4cc0ee5d191d4df) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Added missing "Generate terminal command" label on the prompts settings page

- [#1713](https://github.com/Kilo-Org/kilocode/pull/1713) [`54b88f3`](https://github.com/Kilo-Org/kilocode/commit/54b88f3869e1fa07ae0467b557c7a33adcad0cc9) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The timeout for Ollama and LM Studio was increased from 5 minutes to 1 hour

## [v4.73.1]

- [#1707](https://github.com/Kilo-Org/kilocode/pull/1707) [`d2af1bd`](https://github.com/Kilo-Org/kilocode/commit/d2af1bd779f8e5480355eeceaeaba91679696d95) Thanks [@possible055](https://github.com/possible055)! - Refine Traditional Chinese translation

- [#1710](https://github.com/Kilo-Org/kilocode/pull/1710) [`8d5c647`](https://github.com/Kilo-Org/kilocode/commit/8d5c647e8fd39b5dd528ea959d7e14e28b29d6e6) Thanks [@NaccOll](https://github.com/NaccOll)! - Todo reminders are no longer included in the prompt when todo lists are disabled

- [#1711](https://github.com/Kilo-Org/kilocode/pull/1711) [`e71ca57`](https://github.com/Kilo-Org/kilocode/commit/e71ca578c2935085213ad41bf24226c55f4cf4f5) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix missing padding in the Profile selector

## [v4.73.0]

- [#1654](https://github.com/Kilo-Org/kilocode/pull/1654) [`c4ed29a`](https://github.com/Kilo-Org/kilocode/commit/c4ed29acdabfd131dae82c5ccd06ebe1ecbce058) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.25.4

    - feat: add SambaNova provider integration (#6077 by @snova-jorgep, PR by @snova-jorgep)
    - feat: add Doubao provider integration (thanks @AntiMoron!)
    - feat: set horizon-alpha model max tokens to 32k for OpenRouter (thanks @app/roomote!)
    - feat: add zai-org/GLM-4.5-FP8 model to Chutes AI provider (#6440 by @leakless21, PR by @app/roomote)
    - feat: add symlink support for AGENTS.md file loading (thanks @app/roomote!)
    - feat: optionally add task history context to prompt enhancement (thanks @liwilliam2021!)
    - fix: remove misleading task resumption message (#5850 by @KJ7LNW, PR by @KJ7LNW)
    - feat: add pattern to support Databricks /invocations endpoints (thanks @adambrand!)
    - fix: resolve navigator global error by updating mammoth and bluebird dependencies (#6356 by @hishtadlut, PR by @app/roomote)
    - feat: enhance token counting by extracting text from messages using VSCode LM API (#6112 by @sebinseban, PR by @NaccOll)
    - feat: auto-refresh marketplace data when organization settings change (thanks @app/roomote!)
    - fix: kill button for execute_command tool (thanks @daniel-lxs!)
    - Allow queueing messages with images
    - Increase Claude Code default max output tokens to 16k (#6125 by @bpeterson1991, PR by @app/roomote)
    - Add docs link for slash commands
    - Hide Gemini checkboxes on the welcome view
    - Clarify apply_diff tool descriptions to emphasize surgical edits
    - Fix: Prevent input clearing when clicking chat buttons (thanks @hassoncs!)
    - Update PR reviewer rules and mode configuration (thanks @daniel-lxs!)
    - Add translation check action to pull_request.opened event (thanks @app/roomote!)
    - Remove event types mention from PR reviewer rules (thanks @daniel-lxs!)
    - Fix: Show diff view before approval when background edits are disabled (thanks @daniel-lxs!)
    - Add support for organization-level MCP controls
    - Fix zap icon hover state
    - Add support for GLM-4.5-Air model to Chutes AI provider (#6376 by @matbgn, PR by @app/roomote)
    - Improve subshell validation for commands
    - Add message queueing (thanks @app/roomote!)
    - Add options for URL Context and Grounding with Google Search to the Gemini provider (thanks @HahaBill!)
    - Add image support to read_file tool (thanks @samhvw8!)
    - Add experimental setting to prevent editor focus disruption (#4784 by @hannesrudolph, PR by @app/roomote)
    - Add prompt caching support for LiteLLM (#5791 by @steve-gore-snapdocs, PR by @MuriloFP)
    - Add markdown table rendering support
    - Fix list_files recursive mode now works for dot directories (#2992 by @avtc, #4807 by @zhang157686, #5409 by @MuriloFP, PR by @MuriloFP)
    - Add search functionality to mode selector popup and reorganize layout
    - Sync API config selector style with mode selector
    - Fix keyboard shortcuts for non-QWERTY layouts (#6161 by @shlgug, PR by @app/roomote)
    - Add ESC key handling for modes, API provider, and indexing settings popovers (thanks @app/roomote!)
    - Make task mode sticky to task (thanks @app/roomote!)
    - Add text wrapping to command patterns in Manage Command Permissions (thanks @app/roomote!)
    - Update list-files test for fixed hidden files bug (thanks @daniel-lxs!)
    - Fix normalize Windows paths to forward slashes in mode export (#6307 by @hannesrudolph, PR by @app/roomote)
    - Ensure form-data >= 4.0.4
    - Fix filter out non-text tab inputs (Kilo-Org/kilocode#712 by @szermatt, PR by @hassoncs)

## [v4.72.1]

- [#1697](https://github.com/Kilo-Org/kilocode/pull/1697) [`bcea22c`](https://github.com/Kilo-Org/kilocode/commit/bcea22c5cf6c446a73edbaeabcae8bce62da6441) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - A note on where to find the MCP Marketplace was added

## [v4.72.0]

- [#1663](https://github.com/Kilo-Org/kilocode/pull/1663) [`b043643`](https://github.com/Kilo-Org/kilocode/commit/b043643fe067e415ef28375554e24b8829fa5600) Thanks [@hassoncs](https://github.com/hassoncs)! - Add descriptions to the Mode Selector menu

### Patch Changes

- [#1662](https://github.com/Kilo-Org/kilocode/pull/1662) [`57e5c3e`](https://github.com/Kilo-Org/kilocode/commit/57e5c3eb8f2a86167e121f2d459b74dea987b804) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Some UI text related to pricing and cost has been improved

- [#1684](https://github.com/Kilo-Org/kilocode/pull/1684) [`ccd8a63`](https://github.com/Kilo-Org/kilocode/commit/ccd8a6387c7123f3cb904a1327eaa775e3f87953) Thanks [@NyxJae](https://github.com/NyxJae)! - Standardize brand names in localizations

- [#1666](https://github.com/Kilo-Org/kilocode/pull/1666) [`c59029a`](https://github.com/Kilo-Org/kilocode/commit/c59029a57b820f3cf684476f56a30dc49509d9ea) Thanks [@kevint-cerebras](https://github.com/kevint-cerebras)! - Update available Cerebras models

- [#1655](https://github.com/Kilo-Org/kilocode/pull/1655) [`a3276c0`](https://github.com/Kilo-Org/kilocode/commit/a3276c0feab4300731d9294bbfc44c0bf85db98a) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Credits Store Improvements

- [#1688](https://github.com/Kilo-Org/kilocode/pull/1688) [`de00d50`](https://github.com/Kilo-Org/kilocode/commit/de00d5014e57a602aaee0b21a97a6352bdcdf4c5) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Ollama requests no longer time out after 5 minutes

- [#1677](https://github.com/Kilo-Org/kilocode/pull/1677) [`8a0d0e8`](https://github.com/Kilo-Org/kilocode/commit/8a0d0e830fe56439ce343a743a702c8fa1d02744) Thanks [@possible055](https://github.com/possible055)! - Refine Traditional Chinese translation

## [v4.71.0]

- [#1656](https://github.com/Kilo-Org/kilocode/pull/1656) [`68a3f4a`](https://github.com/Kilo-Org/kilocode/commit/68a3f4a583751ae70ecb5fbd83db119375c4d5bd) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Disable terminal shell integration by default

- [#1596](https://github.com/Kilo-Org/kilocode/pull/1596) [`3e918a2`](https://github.com/Kilo-Org/kilocode/commit/3e918a299c10796805880121844c4841ab56da7c) Thanks [@hassoncs](https://github.com/hassoncs)! - # Terminal Command Generator

    New AI-powered terminal command generator- helps users create terminal commands using natural language

    ## New Features

    - **Terminal Command Generator**: Press `Ctrl+Shift+G` (or `Cmd+Shift+G` on Mac) to generate terminal commands from natural language descriptions
    - **Terminal Welcome Messages**: New terminals now show helpful tips about the command generator feature
    - **API Configuration Selection**: Choose which AI provider configuration to use for terminal command generation in settings

    ## How to Use

    1. Open any terminal in VSCode
    2. Press `Ctrl+Shift+G` (Windows/Linux) or `Cmd+Shift+G` (Mac)
    3. Describe the command you want in plain English (e.g., "list all files in current directory", "find large files", "install npm package")
    4. The AI will generate and execute the appropriate terminal command

    ## Settings

    Navigate to Kilo Code settings → Terminal to configure:

    - **API Configuration**: Select which AI provider to use for command generation (defaults to your current configuration)

- [#1628](https://github.com/Kilo-Org/kilocode/pull/1628) [`4913a39`](https://github.com/Kilo-Org/kilocode/commit/4913a39e6cc6342c896352ed8eaa56831812810c) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Thanks @bhaktatejas922! Add experimental support for Morph Fast Apply

### Patch Changes

- [#1658](https://github.com/Kilo-Org/kilocode/pull/1658) [`962c90a`](https://github.com/Kilo-Org/kilocode/commit/962c90a2d057a72081cb271949cbf780c80a3555) Thanks [@hassoncs](https://github.com/hassoncs)! - Control Kilo Code programmatically from the command line using IPC with the `KILO_CODE_IPC_SOCKET_PATH` var

- [#1647](https://github.com/Kilo-Org/kilocode/pull/1647) [`12a7a5a`](https://github.com/Kilo-Org/kilocode/commit/12a7a5a21ed34ce68694452d7d6bb67a59ca8904) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Simplify the Welcome/Login screen

- [#1649](https://github.com/Kilo-Org/kilocode/pull/1649) [`b3d3fc4`](https://github.com/Kilo-Org/kilocode/commit/b3d3fc4c08a0c1023a37ddeb5823d12d30490727) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The rule toggle UI works again, rules can be disabled.

## [v4.70.2]

- [#1645](https://github.com/Kilo-Org/kilocode/pull/1645) [`81e20ef`](https://github.com/Kilo-Org/kilocode/commit/81e20ef2168b966f8757acf009b27a7374a29386) Thanks [@catrielmuller](https://github.com/catrielmuller)! - You can now buy credits straight from the profile tab

- [#1643](https://github.com/Kilo-Org/kilocode/pull/1643) [`0e99eae`](https://github.com/Kilo-Org/kilocode/commit/0e99eaec42f8111dc75bcd5b273871db0ddc1298) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Optimized memory usage of the chat view

- [#1623](https://github.com/Kilo-Org/kilocode/pull/1623) [`7e29e32`](https://github.com/Kilo-Org/kilocode/commit/7e29e32f40ef3447edf3e5d356235cae6c497e32) Thanks [@hassoncs](https://github.com/hassoncs)! - Add webview memory metrics to telemetry

## [v4.70.1]

- [#1614](https://github.com/Kilo-Org/kilocode/pull/1614) [`2f9d064`](https://github.com/Kilo-Org/kilocode/commit/2f9d064b0370bfa4da92ceffec0026a16feb178a) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - GitHub accounts now show their avatar on the profile page

## [v4.70.0]

- [#1588](https://github.com/Kilo-Org/kilocode/pull/1588) [`96be5a5`](https://github.com/Kilo-Org/kilocode/commit/96be5a5f82111ac2357112a04d3c0adc42103592) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Add warning when Github Copilot conflicts with Kilo's Inline Assist keyboard commands

### Patch Changes

- [#1606](https://github.com/Kilo-Org/kilocode/pull/1606) [`b518ee7`](https://github.com/Kilo-Org/kilocode/commit/b518ee7a577edb61bedcf235bb03164a29719891) Thanks [@hassoncs](https://github.com/hassoncs)! - Put all Inline Assist features behind a new Experiment

## [v4.69.0]

- [#1514](https://github.com/Kilo-Org/kilocode/pull/1514) [`3d09426`](https://github.com/Kilo-Org/kilocode/commit/3d0942667c80cb0e9a185fe1bf1b2dc67f82a694) Thanks [@mcowger](https://github.com/mcowger)! - Show a toast to the user when the active handler changes in the virtual quota fallback provider.

### Patch Changes

- [#1603](https://github.com/Kilo-Org/kilocode/pull/1603) [`dd60d57`](https://github.com/Kilo-Org/kilocode/commit/dd60d57d49e6d0cd62126b869368f6bd8118202f) Thanks [@namaku](https://github.com/namaku)! - fix(ollama): prefer num_ctx from model.parameters over context_length from model.info

## [v4.68.0]

- [#1579](https://github.com/Kilo-Org/kilocode/pull/1579) [`4e5d90a`](https://github.com/Kilo-Org/kilocode/commit/4e5d90a78b99ed5dca750446733aef36d3381680) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.24.0

    - Add Hugging Face provider with support for open source models (thanks @TGlide!)
    - Add terminal command permissions UI to chat interface
    - Add support for Agent Rules standard via AGENTS.md (thanks @sgryphon!)
    - Add settings to control diagnostic messages
    - Fix auto-approve checkbox to be toggled at any time (thanks @KJ7LNW!)
    - Add efficiency warning for single SEARCH/REPLACE blocks in apply_diff (thanks @KJ7LNW!)
    - Fix respect maxReadFileLine setting for file mentions to prevent context exhaustion (thanks @sebinseban!)
    - Fix Ollama API URL normalization by removing trailing slashes (thanks @Naam!)
    - Fix restore list styles for markdown lists in chat interface (thanks @village-way!)
    - Add support for bedrock api keys
    - Add confirmation dialog and proper cleanup for marketplace mode removal
    - Fix cancel auto-approve timer when editing follow-up suggestion (thanks @hassoncs!)
    - Fix add error message when no workspace folder is open for code indexing

### Patch Changes

- [#1561](https://github.com/Kilo-Org/kilocode/pull/1561) [`b3b024f`](https://github.com/Kilo-Org/kilocode/commit/b3b024f670c8b98921d3fc02c626a21c18be0a52) Thanks [@RSO](https://github.com/RSO)! - Added notifications from kilocode backend

- [#1574](https://github.com/Kilo-Org/kilocode/pull/1574) [`2ac061e`](https://github.com/Kilo-Org/kilocode/commit/2ac061ed83ef68f429e113f94f6d72be47fe4389) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improve the styles for the Inline Assist suggestion previews

- [#1581](https://github.com/Kilo-Org/kilocode/pull/1581) [`abf9898`](https://github.com/Kilo-Org/kilocode/commit/abf9898fa1e4e37bdb65ba3abad5c2a7ea78db45) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix 'failure to apply changes to files' when Git diff views are open

- [#1575](https://github.com/Kilo-Org/kilocode/pull/1575) [`3442152`](https://github.com/Kilo-Org/kilocode/commit/34421525994cfa794744a4f969e8eded5cf14d47) Thanks [@hassoncs](https://github.com/hassoncs)! - Attempt to fix the 'kilo icon missing' bug by switching back to PNG icons

## [v4.67.0]

- [#1484](https://github.com/Kilo-Org/kilocode/pull/1484) [`8294250`](https://github.com/Kilo-Org/kilocode/commit/8294250662f15c819f68781b507cb0e35a29b71b) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improve Inline Assist suggestions by adding comprehensive context awareness

## [v4.66.0]

- [#1539](https://github.com/Kilo-Org/kilocode/pull/1539) [`fd3679b`](https://github.com/Kilo-Org/kilocode/commit/fd3679b56b1b72ca41d70b30d805c94d377f3626) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Ollama models now use and report the correct context window size.

- [#1510](https://github.com/Kilo-Org/kilocode/pull/1510) [`ee48df4`](https://github.com/Kilo-Org/kilocode/commit/ee48df43fb460a1fbaa9e4f5a11ce45172bf63e3) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Include changes from Roo Code v3.23.19

    - Fix configurable delay for diagnostics to prevent premature error reporting
    - Add command timeout allowlist
    - Add description and whenToUse fields to custom modes in .roomodes (thanks @RandalSchwartz!)
    - Fix Claude model detection by name for API protocol selection (thanks @daniel-lxs!)
    - Optional setting to prevent completion with open todos
    - Add global rate limiting for OpenAI-compatible embeddings (thanks @daniel-lxs!)
    - Add batch limiting to code indexer (thanks @daniel-lxs!)
    - Add: Moonshot provider (thanks @CellenLee!)
    - Add: Qwen/Qwen3-235B-A22B-Instruct-2507 model to Chutes AI provider
    - Fix: move context condensing prompt to Prompts section (thanks @SannidhyaSah!)
    - Add: jump icon for newly created files
    - Fix: add character limit to prevent terminal output context explosion
    - Fix: resolve global mode export not including rules files
    - Add: auto-omit MCP content when no servers are configured
    - Fix: sort symlinked rules files by symlink names, not target names
    - Docs: clarify when to use update_todo_list tool
    - Add: Mistral embedding provider (thanks @SannidhyaSah!)
    - Fix: add run parameter to vitest command in rules (thanks @KJ7LNW!)
    - Update: the max_tokens fallback logic in the sliding window
    - Fix: Bedrock and Vertext token counting improvements (thanks @daniel-lxs!)
    - Add: llama-4-maverick model to Vertex AI provider (thanks @MuriloFP!)
    - Fix: properly distinguish between user cancellations and API failures
    - Fix: add case sensitivity mention to suggested fixes in apply_diff error message
    - Fix: Resolve 'Bad substitution' error in command parsing (#5978 by @KJ7LNW, PR by @daniel-lxs)
    - Fix: Add ErrorBoundary component for better error handling (#5731 by @elianiva, PR by @KJ7LNW)
    - Improve: Use SIGKILL for command execution timeouts in the "execa" variant (thanks @cte!)
    - Split commands on newlines when evaluating auto-approve
    - Smarter auto-deny of commands

### Patch Changes

- [#1550](https://github.com/Kilo-Org/kilocode/pull/1550) [`48b0d78`](https://github.com/Kilo-Org/kilocode/commit/48b0d78ea9282f4447e5c57262d727b2bc621e50) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - A visual indication is now provided whenever the cost of an API Request could not be retrieved

## [v4.65.3]

- [#1544](https://github.com/Kilo-Org/kilocode/pull/1544) [`758d4ad`](https://github.com/Kilo-Org/kilocode/commit/758d4addb361ae9bc7eb3ba3a98f37a298f8d60d) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improvements to token and cost usage reporting

## [v4.65.2]

- [#1526](https://github.com/Kilo-Org/kilocode/pull/1526) [`fe97c95`](https://github.com/Kilo-Org/kilocode/commit/fe97c9526a13dcf6834c5695dc46b41964738464) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Specify the default model in one place in the code

## [v4.65.1]

- [#1518](https://github.com/Kilo-Org/kilocode/pull/1518) [`f709388`](https://github.com/Kilo-Org/kilocode/commit/f709388ae1e1b730c06796d0b9ec207532219d6e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Claude Sonnet 4 is now the default model! Attend the Anthropic x Kilo Code workshop [The Art of Prompt Engineering for Software Developers](https://www.eventbrite.nl/e/the-art-of-prompt-engineering-for-software-developers-tickets-1474017238239) Thursday, July 31 2025!

- [#1521](https://github.com/Kilo-Org/kilocode/pull/1521) [`08ccbea`](https://github.com/Kilo-Org/kilocode/commit/08ccbeaf2c4e5d9ec22c77edc7cea673f75e397c) Thanks [@hassoncs](https://github.com/hassoncs)! - The chat box is no longer cleared when clicking buttons

    Previously, if either of the buttons in the agent chat was clicked, the ChatTextArea would get cleared. Now, the ChatTextArea will only get cleared if a message is sent as part of the response.

## [v4.65.0]

- [#1487](https://github.com/Kilo-Org/kilocode/pull/1487) [`ad91c38`](https://github.com/Kilo-Org/kilocode/commit/ad91c3824c5fcbced818c90745bed95f7a7e9dc0) Thanks [@mcowger](https://github.com/mcowger)! - Introduce a new Virtual Quota Fallback Provider - delegate to other Profiles based on cost or request count limits!

    This new virtual provider lets you set cost- or request-based quotas for a list of profiles. It will automatically falls back to the next profile's provider when any limit is reached!

### Patch Changes

- [#1502](https://github.com/Kilo-Org/kilocode/pull/1502) [`73f414c`](https://github.com/Kilo-Org/kilocode/commit/73f414c25a59e140946c4c415a8f11817898987c) Thanks [@hellosunghyun](https://github.com/hellosunghyun)! - Update Cerebras models with latest offerings

- [#1512](https://github.com/Kilo-Org/kilocode/pull/1512) [`aea28be`](https://github.com/Kilo-Org/kilocode/commit/aea28bec33d27ad3f824a8a1d44c9d36025adf26) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix a memory leak when opening many documents with different Uris

- [#1515](https://github.com/Kilo-Org/kilocode/pull/1515) [`2b208b3`](https://github.com/Kilo-Org/kilocode/commit/2b208b3320834a847fb3443677d5e7dee3722c41) Thanks [@hassoncs](https://github.com/hassoncs)! - Improve the background color of the "Help Improve Kilo Code" banner

## [v4.64.3]

- [#1494](https://github.com/Kilo-Org/kilocode/pull/1494) [`1488591`](https://github.com/Kilo-Org/kilocode/commit/148859168d0dc1521d5ee7c5d96263ffae47a587) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improved error reporting for Checkpoint-related failures

## [v4.64.2]

- [#1477](https://github.com/Kilo-Org/kilocode/pull/1477) [`8edf106`](https://github.com/Kilo-Org/kilocode/commit/8edf1063d308f36074e10d68cf8418d0f20665d6) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Prevent selection of incompatible providers when you switch models

## [v4.64.1]

- [#1474](https://github.com/Kilo-Org/kilocode/pull/1474) [`7efe383`](https://github.com/Kilo-Org/kilocode/commit/7efe383628f91b7977c0cffcdfc0a7a226ab1f01) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Inline Assist Telemetry

## [v4.64.0]

- [#1447](https://github.com/Kilo-Org/kilocode/pull/1447) [`38d135e`](https://github.com/Kilo-Org/kilocode/commit/38d135eafc395fe5c9883fbe9fcd79941a21e0ce) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - (retry) The Task view now shows per-request cost when using the Kilo Code provider

## [v4.63.2]

- [#1462](https://github.com/Kilo-Org/kilocode/pull/1462) [`54f09c6`](https://github.com/Kilo-Org/kilocode/commit/54f09c6edbd9ea13ebbd645fad9de5a448d5a11d) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Kilo Code no longer uses Gemini 2.5 Pro after a fresh install/reset while showing Sonnet 3.7

- [#1471](https://github.com/Kilo-Org/kilocode/pull/1471) [`d95b409`](https://github.com/Kilo-Org/kilocode/commit/d95b40981715fffbfe62d1fc4e54472195db1f2c) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix Kilo Code profile persist of Routing Provider

## [v4.63.1]

- [#1460](https://github.com/Kilo-Org/kilocode/pull/1460) [`415ea90`](https://github.com/Kilo-Org/kilocode/commit/415ea904e8b9ddd35ce1e4a894411f3679c94922) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improve label of todo list toggle

## [v4.63.0]

- [#1451](https://github.com/Kilo-Org/kilocode/pull/1451) [`66b5892`](https://github.com/Kilo-Org/kilocode/commit/66b5892fbc56d88372ba2ad87118f8696ccbd366) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Add toggles that disable Inline Assist features to the Settings panel

- [#1450](https://github.com/Kilo-Org/kilocode/pull/1450) [`077dba2`](https://github.com/Kilo-Org/kilocode/commit/077dba2964ad99bea5f57d9db1718063abd08a18) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add todo list tool enable checkbox to provider advanced settings (thanks @daniel-lxs, @mrubens!)

- [#1443](https://github.com/Kilo-Org/kilocode/pull/1443) [`eba422a`](https://github.com/Kilo-Org/kilocode/commit/eba422acb01017cc9c7465f414836ff9f14bc86c) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Adds support for changing the Kilo Code providers routing strategy

    You can now select the OpenRouter provider to process your Kilo Code requests.

### Patch Changes

- [#1454](https://github.com/Kilo-Org/kilocode/pull/1454) [`b34b55a`](https://github.com/Kilo-Org/kilocode/commit/b34b55a3f074f14bdfc28bb1998cd91fdf74b0b5) Thanks [@chainedcoder](https://github.com/chainedcoder)! - Load project ID from Gemini CLI's .env file

- [#1448](https://github.com/Kilo-Org/kilocode/pull/1448) [`4e9118b`](https://github.com/Kilo-Org/kilocode/commit/4e9118b7c876c2d2620f2b72503ec17b85ec0539) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Removed language support for Filipino, Greek and Swedish because usage is very low. We can re-add these languages if there is demand.

## [v4.62.0]

- [#1386](https://github.com/Kilo-Org/kilocode/pull/1386) [`48fb539`](https://github.com/Kilo-Org/kilocode/commit/48fb5392a962279463d8db225559db42f32d4ad8) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Include changes from Roo Code v3.23.14

    - Fix Mermaid syntax warning (thanks @MuriloFP!)
    - Expand Vertex AI region config to include all available regions in GCP Vertex AI (thanks @shubhamgupta731!)
    - Handle Qdrant vector dimension mismatch when switching embedding models (thanks @daniel-lxs!)
    - Fix typos in comment & document (thanks @noritaka1166!)
    - Improve the display of codebase search results
    - Correct translation fallback logic for embedding errors (thanks @daniel-lxs!)
    - Clean up MCP tool disabling
    - Link to marketplace from modes and MCP tab
    - Fix TTS button display (thanks @sensei-woo!)
    - Add Devstral Medium model support
    - Add comprehensive error telemetry to code-index service (thanks @daniel-lxs!)
    - Exclude cache tokens from context window calculation (thanks @daniel-lxs!)
    - Enable dynamic tool selection in architect mode for context discovery
    - Add configurable max output tokens setting for claude-code
    - Add enable/disable toggle for code indexing (thanks @daniel-lxs!)
    - Add a command auto-deny list to auto-approve settings
    - Add navigation link to history tab in HistoryPreview
    - Enable Claude Code provider to run natively on Windows (thanks @SannidhyaSah!)
    - Add gemini-embedding-001 model to code-index service (thanks @daniel-lxs!)
    - Resolve vector dimension mismatch error when switching embedding models
    - Return the cwd in the exec tool's response so that the model is not lost after subsequent calls (thanks @chris-garrett!)
    - Add configurable timeout for command execution in VS Code settings
    - Prioritize built-in model dimensions over custom dimensions (thanks @daniel-lxs!)
    - Add padding to the index model options
    - Add Kimi K2 model to Groq along with fixes to context condensing math
    - Add Cmd+Shift+. keyboard shortcut for previous mode switching
    - Update the max-token calculation in model-params to better support Kimi K2 and others
    - Add the ability to "undo" enhance prompt changes
    - Fix a bug where the path component of the baseURL for the LiteLLM provider contains path in it (thanks @ChuKhaLi)
    - Add support for Vertex AI model name formatting when using Claude Code with Vertex AI (thanks @janaki-sasidhar)
    - The list-files tool must include at least the first-level directory contents (thanks @qdaxb)
    - Add a configurable limit that controls both consecutive errors and tool repetitions (thanks @MuriloFP)
    - Add `.terraform/` and `.terragrunt-cache/` directories to the checkpoint exclusion patterns (thanks @MuriloFP)
    - Increase Ollama API timeout values (thanks @daniel-lxs)
    - Fix an issue where you need to "discard changes" before saving even though there are no settings changes
    - Fix `DirectoryScanner` memory leak and improve file limit handling (thanks @daniel-lxs)
    - Fix time formatting in environment (thanks @chrarnoldus)
    - Prevent empty mode names from being saved (thanks @daniel-lxs)
    - Improve auto-approve checkbox UX
    - Improve the chat message edit / delete functionality (thanks @liwilliam2021)
    - Add `commandExecutionTimeout` to `GlobalSettings`
    - Log api-initiated tasks to a tmp directory

### Patch Changes

- [#1154](https://github.com/Kilo-Org/kilocode/pull/1154) [`d871e5e`](https://github.com/Kilo-Org/kilocode/commit/d871e5efb88050d2b4795e8b463e336342dbe550) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Update the Kilo code icon to adapt to light/dark themes

- [#1396](https://github.com/Kilo-Org/kilocode/pull/1396) [`2c46e91`](https://github.com/Kilo-Org/kilocode/commit/2c46e913bba7699eb3bc1425dbe898217f7ee9fe) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Adds new Settings page for Inline Assist

    You can now select the provider you'd like to use for `Inline Assist` commands

## [v4.61.1]

- [#1435](https://github.com/Kilo-Org/kilocode/pull/1435) [`05b5bf4`](https://github.com/Kilo-Org/kilocode/commit/05b5bf400fd195109aa8b2bada01b843acc58318) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Revert "Show per-request cost for Kilo Code provider"

## [v4.61.0]

- [#1431](https://github.com/Kilo-Org/kilocode/pull/1431) [`97a9b97`](https://github.com/Kilo-Org/kilocode/commit/97a9b97de865e3f2d12a956ceaceda12c13505e3) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The Task view now shows per-request cost when using the Kilo Code provider

### Patch Changes

- [#1408](https://github.com/Kilo-Org/kilocode/pull/1408) [`cb5132f`](https://github.com/Kilo-Org/kilocode/commit/cb5132f3faa1f7670c438a201274cbc249a8f68d) Thanks [@markijbema](https://github.com/markijbema)! - Log out kilo code provider when resetting data

- [#1421](https://github.com/Kilo-Org/kilocode/pull/1421) [`841bca9`](https://github.com/Kilo-Org/kilocode/commit/841bca9348434db5d3a5a7fa1c7a821816a23a3f) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed an issue where Kilo Code would inadvertently steal focus

## [v4.60.0]

- [#1354](https://github.com/Kilo-Org/kilocode/pull/1354) [`e6d031d`](https://github.com/Kilo-Org/kilocode/commit/e6d031d77621d38769efd612c04e03137db084de) Thanks [@hassoncs](https://github.com/hassoncs)! - Commit message generation now works with multi-root workspaces

### Patch Changes

- [#1377](https://github.com/Kilo-Org/kilocode/pull/1377) [`185f068`](https://github.com/Kilo-Org/kilocode/commit/185f06891fd1b62114252c10c13ca875321ebe42) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Kilo Code no longer binds to the Ctrl+Shift+K combination

## [v4.59.2]

- [#1364](https://github.com/Kilo-Org/kilocode/pull/1364) [`aaef06f`](https://github.com/Kilo-Org/kilocode/commit/aaef06f9923a31bf1054a06f249ea32d97459c7b) Thanks [@NyxJae](https://github.com/NyxJae)! - Improved some autocomplete-related non-English texts

## [v4.59.1]

- [#1362](https://github.com/Kilo-Org/kilocode/pull/1362) [`08486c4`](https://github.com/Kilo-Org/kilocode/commit/08486c4ac186da2ab7dc02cc8012e77dcae96cce) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed excessive "Kilo Code is having trouble" warnings when the browser tool is scrolling

## [v4.59.0]

- [#1244](https://github.com/Kilo-Org/kilocode/pull/1244) [`8b50f8e`](https://github.com/Kilo-Org/kilocode/commit/8b50f8eb558dc7c3a8667086660ff3c2f5f29788) Thanks [@hassoncs](https://github.com/hassoncs)! - New: Inline Assist Commands

    We've added two new commands that allow you to get AI assistance directly in the code editor. There's no need to start a whole new Kilo task if you just need a quick result. You can even use this while a task is running, speeding up your workflow!

    ⚡️ Quick Inline Tasks (Cmd/Ctl+I)
    Only need a quick change? Select some code (or don't!) and hit Cmd+I. Describe your goal in plain English ("create a React component with these props", "add error handling to this function"), and get ready-to-use suggestions directly in your editor.

    🧠 Let Kilo Decide (Cmd/Ctl+L)
    Think the change you need is obvious? Just hit Cmd+L. Kilo will use the surrounding context to offer immediate improvements, keeping you in the flow.

    ⌨️ Live in Your Keyboard
    Use your arrow keys (↑/↓) to cycle through the options and see a live diff of the changes. Happy with a suggestion? Hit Tab to apply it. That's it. No mouse needed.

### Patch Changes

- [#1359](https://github.com/Kilo-Org/kilocode/pull/1359) [`fbff6cb`](https://github.com/Kilo-Org/kilocode/commit/fbff6cb78472c763b625356dc881ad66c044b0d3) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix positioning of send button in RTL languages

## [v4.58.4]

- [#1349](https://github.com/Kilo-Org/kilocode/pull/1349) [`9f5bb71`](https://github.com/Kilo-Org/kilocode/commit/9f5bb715a086676472f7a5674911b45d230cc970) Thanks [@hassoncs](https://github.com/hassoncs)! - Enhance Prompt feature now works with Claude Code provider

## [v4.58.3]

- [#1348](https://github.com/Kilo-Org/kilocode/pull/1348) [`f83d1d7`](https://github.com/Kilo-Org/kilocode/commit/f83d1d76fa5c42b11cf9821d6b577d5af3d60a79) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add enable/disable toggle for code indexing (thanks @daniel-lxs!)

- [#1328](https://github.com/Kilo-Org/kilocode/pull/1328) [`584225a`](https://github.com/Kilo-Org/kilocode/commit/584225af82a42d840d7daab4a837f1c65ad675fc) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed "Kilo" being inadvertenly translated in some languages (e.g. Кіло, กิโล, キロ)

## [v4.58.2]

- [#1340](https://github.com/Kilo-Org/kilocode/pull/1340) [`1a367c9`](https://github.com/Kilo-Org/kilocode/commit/1a367c943cd423f86c3ab25afe7b43f9d489147b) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add gemini-embedding-001 model to code-index service (thanks @daniel-lxs!)

## [v4.58.1]

- [#1305](https://github.com/Kilo-Org/kilocode/pull/1305) [`34456ee`](https://github.com/Kilo-Org/kilocode/commit/34456eebad9606e5aaee6bff4991a187e8f99573) Thanks [@cobra91](https://github.com/cobra91)! - French localization has been improved

- [#1332](https://github.com/Kilo-Org/kilocode/pull/1332) [`8863e50`](https://github.com/Kilo-Org/kilocode/commit/8863e505e48f80c3d244427b3249eca122791913) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix max_tokens limit for moonshotai/kimi-k2-instruct on Groq

## [v4.58.0]

- [#1272](https://github.com/Kilo-Org/kilocode/pull/1272) [`8026793`](https://github.com/Kilo-Org/kilocode/commit/80267936053b1fbaf4eaf00ef0cbf770cc619fcf) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.23.6

    - Move codebase indexing out of experimental (thanks @daniel-lxs and @MuriloFP!)
    - Add todo list tool (thanks @qdaxb!)
    - Fix code index secret persistence and improve settings UX (thanks @daniel-lxs!)
    - Add Gemini embedding provider for codebase indexing (thanks @SannidhyaSah!)
    - Support full endpoint URLs in OpenAI Compatible provider (thanks @SannidhyaSah!)
    - Add markdown support to codebase indexing (thanks @MuriloFP!)
    - Add Search/Filter Functionality to API Provider Selection in Settings (thanks @GOODBOY008!)
    - Add configurable max search results (thanks @MuriloFP!)
    - Add copy prompt button to task actions (thanks @Juice10 and @vultrnerd!)
    - Fix insertContentTool to create new files with content (thanks @Ruakij!)
    - Fix typescript compiler watch path inconsistency (thanks @bbenshalom!)
    - Use actual max_completion_tokens from OpenRouter API (thanks @shariqriazz!)
    - Prevent completion sound from replaying when reopening completed tasks (thanks @SannidhyaSah!)
    - Fix access_mcp_resource fails to handle images correctly (thanks @s97712!)
    - Prevent chatbox focus loss during automated file editing (thanks @hannesrudolph!)
    - Resolve intermittent hangs and lack of clear error feedback in apply_diff tool (thanks @lhish!)
    - Resolve Go duplicate references in tree-sitter queries (thanks @MuriloFP!)
    - Chat UI consistency and layout shifts (thanks @seedlord!)
    - Chat index UI enhancements (thanks @MuriloFP!)
    - Fix model search being prefilled on dropdown (thanks @kevinvandijk!)
    - Improve chat UI - add camera icon margin and make placeholder non-selectable (thanks @MuriloFP!)
    - Delete .roo/rules-{mode} folder when custom mode is deleted
    - Enforce file restrictions for all edit tools in architect mode
    - Add User-Agent header to API providers
    - Fix auto question timer unmount (thanks @liwilliam2021!)
    - Fix new_task tool streaming issue
    - Optimize file listing when maxWorkspaceFiles is 0 (thanks @daniel-lxs!)
    - Correct export/import of OpenAI Compatible codebase indexing settings (thanks @MuriloFP!)
    - Resolve workspace path inconsistency in code indexing for multi-workspace scenarios
    - Always show the code indexing dot under the chat text area
    - Fix bug where auto-approval was intermittently failing
    - Remove erroneous line from announcement modal
    - Update chat area icons for better discoverability & consistency
    - Fix a bug that allowed list_files to return directory results that should be excluded by .gitignore
    - Add an overflow header menu to make the UI a little tidier (thanks @dlab-anton)
    - Fix a bug the issue where null custom modes configuration files cause a 'Cannot read properties of null' error (thanks @daniel-lxs!)
    - Replace native title attributes with StandardTooltip component for consistency (thanks @daniel-lxs!)
    - Fix: use decodeURIComponent in openFile (thanks @vivekfyi!)
    - Fix(embeddings): Translate error messages before sending to UI (thanks @daniel-lxs!)
    - Make account tab visible
    - Grok 4

### Patch Changes

- [#1324](https://github.com/Kilo-Org/kilocode/pull/1324) [`0ff6960`](https://github.com/Kilo-Org/kilocode/commit/0ff69600cefd24190c607ca9001de5e03d7c03a7) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add Kimi K2 model to Grok (thanks @mrubens)

## [v4.57.4]

- [#1293](https://github.com/Kilo-Org/kilocode/pull/1293) [`2371a08`](https://github.com/Kilo-Org/kilocode/commit/2371a086199503e68bb8b2a7a909c14da60a2532) Thanks [@Autumnlight02](https://github.com/Autumnlight02)! - A few Mistral models (including devstral) were added.

## [v4.57.3]

- [#1297](https://github.com/Kilo-Org/kilocode/pull/1297) [`1dd349c`](https://github.com/Kilo-Org/kilocode/commit/1dd349ca12fe0a75f7b058ae1c2bd56955350c9b) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - More details are included in the "Cannot complete request, make sure you are connected and logged in with the selected provider" error message

## [v4.57.2]

- [#1274](https://github.com/Kilo-Org/kilocode/pull/1274) [`e9fe0da`](https://github.com/Kilo-Org/kilocode/commit/e9fe0daa60f2afdcf4ef2ce9680ca5f47faa26b2) Thanks [@raziel5746](https://github.com/raziel5746)! - ENAMETOOLONG error in Claude Code integration on Windows is resolved

## [v4.57.1]

- [#1280](https://github.com/Kilo-Org/kilocode/pull/1280) [`6954e16`](https://github.com/Kilo-Org/kilocode/commit/6954e1619bfd46904c80ec65ce945c5f17aa172a) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Show idea suggestions when there is no task history

## [v4.57.0]

- [#1265](https://github.com/Kilo-Org/kilocode/pull/1265) [`0b89829`](https://github.com/Kilo-Org/kilocode/commit/0b89829af4067acfaf2b7a13c5ee8e061d1ea6d6) Thanks [@hassoncs](https://github.com/hassoncs)! - Add 'max requests' section to the Auto-Approve Settings page

## [v4.56.4]

- [#1263](https://github.com/Kilo-Org/kilocode/pull/1263) [`32685c1`](https://github.com/Kilo-Org/kilocode/commit/32685c128a35ce38e3d9c27c833c3592e61e5cc0) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The current time is now provided in ISO format, which is non-ambiguous and less likely to confuse the AI.

## [v4.56.3]

- [#1259](https://github.com/Kilo-Org/kilocode/pull/1259) [`4d55c91`](https://github.com/Kilo-Org/kilocode/commit/4d55c9102cb72e927609b4ce07d78d1f32fe27b0) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix model dropdown to show Kilo Code preferred models for the Kilo Code provider first

## [v4.56.2]

- [#1255](https://github.com/Kilo-Org/kilocode/pull/1255) [`acc2aaf`](https://github.com/Kilo-Org/kilocode/commit/acc2aaf4fb56290424db0d6533caee507fedbd5b) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix autocomplete init with custom openrouter models

## [v4.56.1]

- [#1242](https://github.com/Kilo-Org/kilocode/pull/1242) [`c0ec484`](https://github.com/Kilo-Org/kilocode/commit/c0ec4843a286d644580bd82d8db37d5a1e46394e) Thanks [@hassoncs](https://github.com/hassoncs)! - Continue to show commit message generation progress while waiting for LLM response

## [v4.56.0]

- [#785](https://github.com/Kilo-Org/kilocode/pull/785) [`24cc186`](https://github.com/Kilo-Org/kilocode/commit/24cc1860fe6f220a0df95f7d81ffbd9e21022d7a) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add idea suggestion box to get you inspired with some ideas when starting out fresh

## [v4.55.3]

- [#1238](https://github.com/Kilo-Org/kilocode/pull/1238) [`c0b075c`](https://github.com/Kilo-Org/kilocode/commit/c0b075cd73557f2a3af1a12fcf237f66ece97f34) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add Grok 4 support (thanks @mrubens!)

## [v4.55.2]

- [#1183](https://github.com/Kilo-Org/kilocode/pull/1183) [`e3ba400`](https://github.com/Kilo-Org/kilocode/commit/e3ba400e17254a53b6be2147f70c4d107bdda576) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The default mode is now automatically selected if the previous mode doesn't exist anymore (this can happen with custom modes).

## [v4.55.1]

- [#885](https://github.com/Kilo-Org/kilocode/pull/885) [`02288f5`](https://github.com/Kilo-Org/kilocode/commit/02288f5ca7fde811a0477ba99b6d4c33dc239afb) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improve UI responsiveness when the user cancel the current operation

- [#1203](https://github.com/Kilo-Org/kilocode/pull/1203) [`5c21b8b`](https://github.com/Kilo-Org/kilocode/commit/5c21b8bcab5d584683c5c643d4075c01cd7265fe) Thanks [@hassoncs](https://github.com/hassoncs)! - Kilocode rules will now be included in the commit message generation prompt

## [v4.55.0]

- [#1197](https://github.com/Kilo-Org/kilocode/pull/1197) [`2ceb643`](https://github.com/Kilo-Org/kilocode/commit/2ceb643a35f4a4c04680c119b14e0072d273ee13) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Kilo Code now optionally sends error and usage data to help us fix bugs and improve the extension. No code, prompts, or personal information is ever sent. You can always opt-out in the Settings.

### Patch Changes

- [#1191](https://github.com/Kilo-Org/kilocode/pull/1191) [`ce2b45a`](https://github.com/Kilo-Org/kilocode/commit/ce2b45aec7845719754f892717f2c2eee548bff2) Thanks [@NyxJae](https://github.com/NyxJae)! - Improve Chinese translations

- [#1194](https://github.com/Kilo-Org/kilocode/pull/1194) [`dee59c6`](https://github.com/Kilo-Org/kilocode/commit/dee59c6f8d8438fb5c8f7bf15ca7d58ed561f3be) Thanks [@markijbema](https://github.com/markijbema)! - Minor improvement to login process for Kilocode provider

- [#1186](https://github.com/Kilo-Org/kilocode/pull/1186) [`e16aded`](https://github.com/Kilo-Org/kilocode/commit/e16aded354d5180fb651767c540267f3fdec70dc) Thanks [@hassoncs](https://github.com/hassoncs)! - Improve the progress bar during commit message generation

## [v4.54.0]

- [#1124](https://github.com/Kilo-Org/kilocode/pull/1124) [`468019d`](https://github.com/Kilo-Org/kilocode/commit/468019dc7c07e3994a5cac1103bae658befcf948) Thanks [@alexandrevilain](https://github.com/alexandrevilain)! - Allow configuring autocomplete API provider

### Patch Changes

- [#1187](https://github.com/Kilo-Org/kilocode/pull/1187) [`53ed102`](https://github.com/Kilo-Org/kilocode/commit/53ed102ab42d98c43acc5a5faac773bf6e114a48) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix multiple broken documentation links

## [v4.53.0]

- [#1118](https://github.com/Kilo-Org/kilocode/pull/1118) [`a9f6464`](https://github.com/Kilo-Org/kilocode/commit/a9f6464a34398256427005354fe7cc85fe58e243) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Support MCP notifications (feature from Cline)

### Patch Changes

- [#1158](https://github.com/Kilo-Org/kilocode/pull/1158) [`359cf61`](https://github.com/Kilo-Org/kilocode/commit/359cf61618083546f1da7604480e4147f1e843f9) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Kilo Code provider config UI rework

## [v4.52.0]

- [#1084](https://github.com/Kilo-Org/kilocode/pull/1084) [`c97d2f5`](https://github.com/Kilo-Org/kilocode/commit/c97d2f59edd28a875881bf29da616361bfce6fad) Thanks [@hassoncs](https://github.com/hassoncs)! - Generate commit messages based on unstaged changes if there's nothing staged

## [v4.51.2]

- [#1164](https://github.com/Kilo-Org/kilocode/pull/1164) [`ceed4e3`](https://github.com/Kilo-Org/kilocode/commit/ceed4e3191557c6ad6adb91e705cc462edb08ea3) Thanks [@philipvas](https://github.com/philipvas)! - Fix browser mode JSON snippets appearing in chat

## [v4.51.1]

- [#1163](https://github.com/Kilo-Org/kilocode/pull/1163) [`3f0592a`](https://github.com/Kilo-Org/kilocode/commit/3f0592a95282b6f2b6486b31146f322ea3324916) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Context condensing error messages are now more detailed

- [#1165](https://github.com/Kilo-Org/kilocode/pull/1165) [`fe6ed81`](https://github.com/Kilo-Org/kilocode/commit/fe6ed81e73dd666043441c339e040d17dbb12aea) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix double scrollbar in dropdowns

- [#1155](https://github.com/Kilo-Org/kilocode/pull/1155) [`2cbd9f8`](https://github.com/Kilo-Org/kilocode/commit/2cbd9f80a3d0f535d9839fefcf4812e0c59eebab) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Customer Support email address link was replaced by a web link, which works more reliably.

## [v4.51.0]

- [#841](https://github.com/Kilo-Org/kilocode/pull/841) [`1615ec7`](https://github.com/Kilo-Org/kilocode/commit/1615ec74cec2198d49cf1cd6942d883c0b717f4f) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Quick model selector on the chatbox

- [#1149](https://github.com/Kilo-Org/kilocode/pull/1149) [`62786a8`](https://github.com/Kilo-Org/kilocode/commit/62786a8d09e42f51ac61c15216a168c172e87785) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.22.6

    - Add timer-based auto approve for follow up questions (thanks @liwilliam2021!)
    - Add import/export modes functionality
    - Add persistent version indicator on chat screen
    - Add automatic configuration import on extension startup (thanks @takakoutso!)
    - Add user-configurable search score threshold slider for semantic search (thanks @hannesrudolph!)
    - Add default headers and testing for litellm fetcher (thanks @andrewshu2000!)
    - Fix consistent cancellation error messages for thinking vs streaming phases
    - Fix AWS Bedrock cross-region inference profile mapping (thanks @KevinZhao!)
    - Fix URL loading timeout issues in @ mentions (thanks @MuriloFP!)
    - Fix API retry exponential backoff capped at 10 minutes (thanks @MuriloFP!)
    - Fix Qdrant URL field auto-filling with default value (thanks @SannidhyaSah!)
    - Fix profile context condensation threshold (thanks @PaperBoardOfficial!)
    - Fix apply_diff tool documentation for multi-file capabilities
    - Fix cache files excluded from rules compilation (thanks @MuriloFP!)
    - Add streamlined extension installation and documentation (thanks @devxpain!)
    - Prevent Architect mode from providing time estimates
    - Remove context size from environment details
    - Change default mode to architect for new installations
    - Suppress Mermaid error rendering
    - Improve Mermaid buttons with light background in light mode (thanks @chrarnoldus!)
    - Add .vscode/ to write-protected files/directories
    - Update AWS Bedrock cross-region inference profile mapping (thanks @KevinZhao!)

## [v4.50.0]

- [#1111](https://github.com/Kilo-Org/kilocode/pull/1111) [`fe40949`](https://github.com/Kilo-Org/kilocode/commit/fe4094938ffc14fdbc19fde874a45d80f0431c6c) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Make MCP server toggles easier accessible with button in the top bar

### Patch Changes

- [#967](https://github.com/Kilo-Org/kilocode/pull/967) [`cd574a5`](https://github.com/Kilo-Org/kilocode/commit/cd574a5d1076c671a7abe2ca5f0f6c45fd524cd7) Thanks [@catrielmuller](https://github.com/catrielmuller)! - System Notification Setting

## [v4.49.5]

- [#1083](https://github.com/Kilo-Org/kilocode/pull/1083) [`d2f5c4f`](https://github.com/Kilo-Org/kilocode/commit/d2f5c4f3448bcf573663a8bef96a044b1f7f287e) Thanks [@IAmABear](https://github.com/IAmABear)! - Fix project mcp settings button not opening file

- [#1107](https://github.com/Kilo-Org/kilocode/pull/1107) [`77cdbc9`](https://github.com/Kilo-Org/kilocode/commit/77cdbc9c3f70393ca9f1de15898a1ef74c107834) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Exclude binary and cache files from rules compilation

## [v4.49.4]

- [#942](https://github.com/Kilo-Org/kilocode/pull/942) [`873e6c8`](https://github.com/Kilo-Org/kilocode/commit/873e6c8f671f5505e6fca8c7ed19ac5e89c73d43) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix auto-generate commit message fails when git diff too large

    Now we automatically exclude lockfiles when generating commit message diffs to avoid overflowing the context window.

- [#956](https://github.com/Kilo-Org/kilocode/pull/956) [`7219c34`](https://github.com/Kilo-Org/kilocode/commit/7219c342501d36b6e85a15ae09f3eed2796d0f7a) Thanks [@markijbema](https://github.com/markijbema)! - do not autocomplete when we are indenting a line

- [#1060](https://github.com/Kilo-Org/kilocode/pull/1060) [`8b149e1`](https://github.com/Kilo-Org/kilocode/commit/8b149e1e54319d2b6737ad7ed5a65ad4e921240f) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix model search being prefilled in dropdown to prevent confusion in available models

## [v4.49.3]

- [#981](https://github.com/Kilo-Org/kilocode/pull/981) [`66a4d0f`](https://github.com/Kilo-Org/kilocode/commit/66a4d0f58821e4321f6c127bbbf95d96450ba054) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - No longer steal focus from the chat text area when a file is being edited.

## [v4.49.2]

- [#947](https://github.com/Kilo-Org/kilocode/pull/947) [`eae4b74`](https://github.com/Kilo-Org/kilocode/commit/eae4b74a68720013c30547865ad9423e0154b89a) Thanks [@kamilchm](https://github.com/kamilchm)! - Add support for project id set in env.GOOGLE_CLOUD_PROJECT for Gemini CLI (thanks @kamilchm!)

## [v4.49.1]

- [#949](https://github.com/Kilo-Org/kilocode/pull/949) [`1043c8b`](https://github.com/Kilo-Org/kilocode/commit/1043c8b3484bfe18baa0a0267f3a967469a84b4c) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Mermaid diagram toolbar is now light in light mode (bugfix)

- [#945](https://github.com/Kilo-Org/kilocode/pull/945) [`e3580b8`](https://github.com/Kilo-Org/kilocode/commit/e3580b83cdf59cec0e2b0ae22975d87cd0218329) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improved Arabic translation by AL38lAlmdbeR

## [v4.49.0]

- [#894](https://github.com/Kilo-Org/kilocode/pull/894) [`421d57e`](https://github.com/Kilo-Org/kilocode/commit/421d57e44537b13760551e0a1484aae1e8735bc7) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Kilo Code will no longer process file reads or MCP tool outputs if the estimated size is over 80% of the context window. If this behavior breaks your workflow, it can be re-enabled by checking Settings > Context > Allow very large file reads.

- [#929](https://github.com/Kilo-Org/kilocode/pull/929) [`641d264`](https://github.com/Kilo-Org/kilocode/commit/641d2647d57049b6633664d6f9b31c6986684e00) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Edit and resend user feedback messages

### Patch Changes

- [#938](https://github.com/Kilo-Org/kilocode/pull/938) [`a606053`](https://github.com/Kilo-Org/kilocode/commit/a606053a3b55b140bab9ebc4bf3ae53969380644) Thanks [@markijbema](https://github.com/markijbema)! - Add debugging info for when we cannot read a task file

- [#943](https://github.com/Kilo-Org/kilocode/pull/943) [`8178463`](https://github.com/Kilo-Org/kilocode/commit/81784632209960e93ffedf9c9b08235a12c238d5) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix checkpoints do not always include a revert option

## [v4.48.0]

- [#926](https://github.com/Kilo-Org/kilocode/pull/926) [`75b6c80`](https://github.com/Kilo-Org/kilocode/commit/75b6c80878f61f9f5d2b0c7499bee56eb8f09d06) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Arabic translation added (support for right-to-left languages is experimental)

- [#930](https://github.com/Kilo-Org/kilocode/pull/930) [`047b30e`](https://github.com/Kilo-Org/kilocode/commit/047b30ec1ca8b30c86ad7708dea16bf404ed94f8) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.22.4

    - Fix: resolve E2BIG error by passing large prompts via stdin to Claude CLI (thanks @Fovty!)
    - Add optional mode suggestions to follow-up questions
    - Restore JSON backwards compatibility for .roomodes files (thanks @daniel-lxs!)
    - Fix: eliminate XSS vulnerability in CodeBlock component (thanks @KJ7LNW!)
    - Fix terminal keyboard shortcut error when adding content to context (thanks @MuriloFP!)
    - Fix checkpoint popover not opening due to StandardTooltip wrapper conflict (thanks @daniel-lxs!)
    - Fix(i18n): correct gemini cli error translation paths (thanks @daniel-lxs!)
    - Code Index (Qdrant) recreate services when change configurations (thanks @catrielmuller!)
    - Fix undefined mcp command (thanks @qdaxb!)
    - Use upstream_inference_cost for OpenRouter BYOK cost calculation and show cached token count (thanks @chrarnoldus!)
    - Update maxTokens value for qwen/qwen3-32b model on Groq (thanks @KanTakahiro!)
    - Standardize tooltip delays to 300ms
    - Add support for loading rules from a global .kilocode directory (thanks @samhvw8!)
    - Modes selector improvements (thanks @brunobergher!)
    - Use safeWriteJson for all JSON file writes to avoid task history corruption (thanks @KJ7LNW!)
    - Improve YAML error handling when editing modes
    - Add default task names for empty tasks (thanks @daniel-lxs!)
    - Improve translation workflow to avoid unnecessary file reads (thanks @KJ7LNW!)
    - Allow write_to_file to handle newline-only and empty content (thanks @Githubguy132010!)
    - Address multiple memory leaks in CodeBlock component (thanks @kiwina!)
    - Memory cleanup (thanks @xyOz-dev!)
    - Fix port handling bug in code indexing for HTTPS URLs (thanks @benashby!)
    - Improve Bedrock error handling for throttling and streaming contexts
    - Handle long Claude code messages (thanks @daniel-lxs!)
    - Fixes to Claude Code caching and image upload
    - Disable reasoning budget UI controls for Claude Code provider
    - Remove temperature parameter for Azure OpenAI reasoning models (thanks @ExactDoug!)
    - Add VS Code setting to disable quick fix context actions (thanks @OlegOAndreev!)

### Patch Changes

- [#931](https://github.com/Kilo-Org/kilocode/pull/931) [`351ebde`](https://github.com/Kilo-Org/kilocode/commit/351ebdec10833328ec9069ddacb41ea37660eae8) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The /newtask command now starts a task more reliably.

## [v4.47.0]

- [#905](https://github.com/Kilo-Org/kilocode/pull/905) [`4224ba9`](https://github.com/Kilo-Org/kilocode/commit/4224ba978c4ebd5eeee7bc879bc3d860f36a64fb) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Improve MCP marketplace and installed MCP servers views (thanks Roo Code!)

## [v4.46.0]

- [#921](https://github.com/Kilo-Org/kilocode/pull/921) [`4d0d1ed`](https://github.com/Kilo-Org/kilocode/commit/4d0d1ed6081266a24b3b715f3450a5bd82718dbb) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Enable browser tool for Gemini, GPT and all other models that can read images

### Patch Changes

- [#889](https://github.com/Kilo-Org/kilocode/pull/889) [`7f72a33`](https://github.com/Kilo-Org/kilocode/commit/7f72a33278100f3a7679d7b2761f1380a54bfc90) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Refresh CodeIndex Services (Qdrant) when change the configuration

- [#911](https://github.com/Kilo-Org/kilocode/pull/911) [`ef17629`](https://github.com/Kilo-Org/kilocode/commit/ef17629f278e759345ae4aa4bb3ea27006ff7918) Thanks [@NyxJae](https://github.com/NyxJae)! - Improve Chinese translation: Kilo Code should be a proper noun

- [#910](https://github.com/Kilo-Org/kilocode/pull/910) [`91ce5a6`](https://github.com/Kilo-Org/kilocode/commit/91ce5a649f7b2d9cb0911b3b5c4fcf3a133b420a) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix not being able to open Mermaid diagrams in a tab or save them

## [v4.45.0]

- [#867](https://github.com/Kilo-Org/kilocode/pull/867) [`717823f`](https://github.com/Kilo-Org/kilocode/commit/717823f40419bda32813b3e1f9f357fdabfa89df) Thanks [@Juice10](https://github.com/Juice10)! - Add copy prompt button to task actions. Based on [@vultrnerd's feedback](https://github.com/Kilo-Org/kilocode/discussions/850).

### Patch Changes

- [#890](https://github.com/Kilo-Org/kilocode/pull/890) [`1a35cfe`](https://github.com/Kilo-Org/kilocode/commit/1a35cfe2c0dbfee68c09c7abeb42199e8713095f) Thanks [@hassoncs](https://github.com/hassoncs)! - Only show the colorful gutter bars when hovering over the Task Timeline

## [v4.44.1]

### Patch Changes

- [#887](https://github.com/Kilo-Org/kilocode/pull/887) [`df10163`](https://github.com/Kilo-Org/kilocode/commit/df101636d0f9851b2f3ee4820c84cb09b3c41f33) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Update text on welcome screen

- [#886](https://github.com/Kilo-Org/kilocode/pull/886) [`084cee7`](https://github.com/Kilo-Org/kilocode/commit/084cee76dc59a2f83ddf36dfdf71666f89a2898a) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed crashes with the error message "Bad substitution" and "Cannot read properties of undefined (reading 'includes')"

## [v4.44.0]

- [#881](https://github.com/Kilo-Org/kilocode/pull/881) [`30836f4`](https://github.com/Kilo-Org/kilocode/commit/30836f4d11a02769787af91c552789c14118ebdf) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add support for Gemini CLI provider (thanks Roo & Cline!)

## [v4.43.1]

- [#842](https://github.com/Kilo-Org/kilocode/pull/842) [`32e4c30`](https://github.com/Kilo-Org/kilocode/commit/32e4c304506b4042b76265446a3169206eb243a5) Thanks [@markijbema](https://github.com/markijbema)! - add a button to fix mermaid syntax errors by calling the LLM

## [v4.43.0]

- [#871](https://github.com/Kilo-Org/kilocode/pull/871) [`52f216d`](https://github.com/Kilo-Org/kilocode/commit/52f216de21ea5be0366976a9108e3c9edd993620) Thanks [@hassoncs](https://github.com/hassoncs)! - Add a colorful gutter to chat messages corresponding to the Task Timeline

- [#861](https://github.com/Kilo-Org/kilocode/pull/861) [`8e9df82`](https://github.com/Kilo-Org/kilocode/commit/8e9df820f22b3ea833a00dc490ad05bfaa6f1645) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add language support for Filipino, Thai, Ukrainian, Czech, Greek and Swedish

- [#847](https://github.com/Kilo-Org/kilocode/pull/847) [`fbe3c75`](https://github.com/Kilo-Org/kilocode/commit/fbe3c75c1fbaf2b16cea43554cf7e9be2ef8849f) Thanks [@hassoncs](https://github.com/hassoncs)! - Highlight the context window progress bar red when near the limit

### Patch Changes

- [#853](https://github.com/Kilo-Org/kilocode/pull/853) [`e9452f1`](https://github.com/Kilo-Org/kilocode/commit/e9452f11035c8daa40c5afd752bad4c18f7f3f64) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix @ mentions not working after slash commands

- [#854](https://github.com/Kilo-Org/kilocode/pull/854) [`81d8b06`](https://github.com/Kilo-Org/kilocode/commit/81d8b0657ec045efa67b41bb7af493ef4753a8ae) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix allowed commands export/import

- [#871](https://github.com/Kilo-Org/kilocode/pull/871) [`52f216d`](https://github.com/Kilo-Org/kilocode/commit/52f216de21ea5be0366976a9108e3c9edd993620) Thanks [@hassoncs](https://github.com/hassoncs)! - Enable the Task Timeline by default

## [v4.42.0]

- [#844](https://github.com/Kilo-Org/kilocode/pull/844) [`8f33721`](https://github.com/Kilo-Org/kilocode/commit/8f3372102d8a06cfbe0dd2889287befea6a347a4) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.21.5

    - Fix Qdrant URL prefix handling for QdrantClient initialization (thanks @CW-B-W!)
    - Improve LM Studio model detection to show all downloaded models (thanks @daniel-lxs!)
    - Resolve Claude Code provider JSON parsing and reasoning block display
    - Fix start line not working in multiple apply diff (thanks @samhvw8!)
    - Resolve diff editor issues with markdown preview associations (thanks @daniel-lxs!)
    - Resolve URL port handling bug for HTTPS URLs in Qdrant (thanks @benashby!)
    - Mark unused Ollama schema properties as optional (thanks @daniel-lxs!)
    - Close the local browser when used as fallback for remote (thanks @markijbema!)
    - Add Claude Code provider for local CLI integration (thanks @BarreiroT!)
    - Add profile-specific context condensing thresholds (thanks @SannidhyaSah!)
    - Fix context length for lmstudio and ollama (thanks @thecolorblue!)
    - Resolve MCP tool eye icon state and hide in chat context (thanks @daniel-lxs!)
    - Add LaTeX math equation rendering in chat window
    - Add toggle for excluding MCP server tools from the prompt (thanks @Rexarrior!)
    - Add symlink support to list_files tool
    - Fix marketplace blanking after populating
    - Fix recursive directory scanning in @ mention "Add Folder" functionality (thanks @village-way!)
    - Resolve phantom subtask display on cancel during API retry
    - Correct Gemini 2.5 Flash pricing (thanks @daniel-lxs!)
    - Resolve marketplace timeout issues and display installed MCPs (thanks @daniel-lxs!)
    - Onboarding tweaks to emphasize modes (thanks @brunobergher!)
    - Rename 'Boomerang Tasks' to 'Task Orchestration' for clarity
    - Remove command execution from attempt_completion
    - Fix markdown for links followed by punctuation (thanks @xyOz-dev!)

### Patch Changes

- [#845](https://github.com/Kilo-Org/kilocode/pull/845) [`8e53c23`](https://github.com/Kilo-Org/kilocode/commit/8e53c237151787523f7338037d5442e9e0225e94) Thanks [@hassoncs](https://github.com/hassoncs)! - Improved Task Timeline tooltips

- [#825](https://github.com/Kilo-Org/kilocode/pull/825) [`b7b7f8c`](https://github.com/Kilo-Org/kilocode/commit/b7b7f8c165a0b85f504076432e2fa4ce695077b8) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Show number of cache reads for Gemini models

## [v4.41.0]

- [#794](https://github.com/Kilo-Org/kilocode/pull/794) [`7113260`](https://github.com/Kilo-Org/kilocode/commit/711326037cbb38db49f6a2d12671c7974a981787) Thanks [@markijbema](https://github.com/markijbema)! - Include changes from Roo Code v3.21.1

    - Fix tree-sitter issues that were preventing codebase indexing from working correctly
    - Improve error handling for codebase search embeddings
    - Resolve MCP server execution on Windows with node version managers
    - Default 'Enable MCP Server Creation' to false
    - Rate limit correctly when starting a subtask (thanks @olweraltuve!)
    - Add Gemini 2.5 models (Pro, Flash and Flash Lite) (thanks @daniel-lxs!)
    - Add max tokens checkbox option for OpenAI compatible provider (thanks @AlexandruSmirnov!)
    - Update provider models and prices for Groq & Mistral (thanks @KanTakahiro!)
    - Add proper error handling for API conversation history issues (thanks @KJ7LNW!)
    - Fix ambiguous model id error (thanks @elianiva!)
    - Fix save/discard/revert flow for Prompt Settings (thanks @hassoncs!)
    - Fix codebase indexing alignment with list-files hidden directory filtering (thanks @daniel-lxs!)
    - Fix subtask completion mismatch (thanks @feifei325!)
    - Fix Windows path normalization in MCP variable injection (thanks @daniel-lxs!)
    - Update marketplace branding to 'Roo Marketplace' (thanks @SannidhyaSah!)
    - Refactor to more consistent history UI (thanks @elianiva!)
    - Adjust context menu positioning to be near Copilot
    - Update evals Docker setup to work on Windows (thanks @StevenTCramer!)
    - Include current working directory in terminal details
    - Encourage use of start_line in multi-file diff to match legacy diff
    - Always focus the panel when clicked to ensure menu buttons are visible (thanks @hassoncs!)

### Patch Changes

- [#829](https://github.com/Kilo-Org/kilocode/pull/829) [`8fbae6b`](https://github.com/Kilo-Org/kilocode/commit/8fbae6bf6adc6ad7f7db5a2ce5aaa8a449cc417c) Thanks [@hassoncs](https://github.com/hassoncs)! - Fixed issue causing workflows and rules not to load immediately when the extension loads

## [v4.40.1]

- [#801](https://github.com/Kilo-Org/kilocode/pull/801) [`e64e172`](https://github.com/Kilo-Org/kilocode/commit/e64e172b7ccc21e7d3e1e278c3ada368b19ab43f) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix minor task timeline layout shift from hidden scrollbar

- [#812](https://github.com/Kilo-Org/kilocode/pull/812) [`40bb083`](https://github.com/Kilo-Org/kilocode/commit/40bb0838bdeae01a044f91579a9ce2007df390f7) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix TelemetryService not initialized error when applying diff fails

## [v4.40.0]

### Minor Changes

- [#770](https://github.com/Kilo-Org/kilocode/pull/770) [`f2fe2f1`](https://github.com/Kilo-Org/kilocode/commit/f2fe2f1f93a97f49004072ae3feaa25edafe2b78) Thanks [@hassoncs](https://github.com/hassoncs)! - Add $WORKSPACE_ROOT environment variable to terminal sessions for easier workspace navigation

    Terminal sessions now automatically include a `$WORKSPACE_ROOT` environment variable that points to your current workspace root directory. This makes it easier for the agent to run terminal commands in sub-directories, for example, running just one directory's tests: `cd $WORKSPACE_ROOT && npx jest`.

    This enhancement is particularly useful when working in deeply nested directories or when you need to quickly reference files or tests at the root level. In multi-workspace setups, this points to the workspace folder containing your currently active file.

## [v4.39.2]

### Patch Changes

- [#788](https://github.com/Kilo-Org/kilocode/pull/788) [`120f6ce`](https://github.com/Kilo-Org/kilocode/commit/120f6cee1dac1a1e05a715eee82b0bd12f127344) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix cache read stats not being shown in the Chat window

## [v4.39.1]

### Patch Changes

- [#773](https://github.com/Kilo-Org/kilocode/pull/773) [`28b90f1`](https://github.com/Kilo-Org/kilocode/commit/28b90f14b50526c414cdc22872a9095a67d90b5c) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Rename Roo to Kilo in the diff view

## [v4.39.0]

- [#777](https://github.com/Kilo-Org/kilocode/pull/777) [`b04ad66`](https://github.com/Kilo-Org/kilocode/commit/b04ad661e195ca42430bd7d1c6f5a247cf3ff49b) Thanks [@markijbema](https://github.com/markijbema)! - Added Cerebras API provider (from Cline)

- [#768](https://github.com/Kilo-Org/kilocode/pull/768) [`fc7a357`](https://github.com/Kilo-Org/kilocode/commit/fc7a357fa6460d54eec58800af60d335fbc71a96) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.20.3

    - Resolve diff editor race condition in multi-monitor setups (thanks @daniel-lxs!)
    - Add logic to prevent auto-approving edits of configuration files
    - Adjust searching and listing files outside of the workspace to respect the auto-approve settings
    - Fix multi-file diff error handling and UI feedback (thanks @daniel-lxs!)
    - Improve prompt history navigation to not interfere with text editing (thanks @daniel-lxs!)
    - Fix errant maxReadFileLine default
    - Limit search_files to only look within the workspace for improved security
    - Force tar-fs >=2.1.3 for security vulnerability fix
    - Add cache breakpoints for custom vertex models on Unbound (thanks @pugazhendhi-m!)
    - Reapply reasoning for bedrock with fix (thanks @daniel-lxs!)
    - Sync BatchDiffApproval styling with BatchFilePermission for UI consistency (thanks @samhvw8!)
    - Add max height constraint to MCP execution response for better UX (thanks @samhvw8!)
    - Prevent MCP 'installed' label from being squeezed #4630 (thanks @daniel-lxs!)
    - Allow a lower context condesning threshold (thanks @SECKainersdorfer!)
    - Avoid type system duplication for cleaner codebase (thanks @EamonNerbonne!)
    - Temporarily revert thinking support for Bedrock models
    - Improve performance of MCP execution block
    - Add indexing status badge to chat view
    - Add experimental multi-file edits (thanks @samhvw8!)
    - Move concurrent reads setting to context settings with default of 5
    - Improve MCP execution UX (thanks @samhvw8!)
    - Add magic variables support for MCPs with `workspaceFolder` injection (thanks @NamesMT!)
    - Add prompt history navigation via arrow up/down in prompt field
    - Add support for escaping context mentions (thanks @KJ7LNW!)
    - Add DeepSeek R1 support to Chutes provider
    - Add reasoning budget support to Bedrock models for extended thinking
    - Add mermaid diagram support buttons (thanks @qdaxb!)
    - Update XAI models and pricing (thanks @edwin-truthsearch-io!)
    - Update O3 model pricing
    - Add manual OpenAI-compatible format specification and parsing (thanks @dflatline!)
    - Add core tools integration tests for comprehensive coverage
    - Add JSDoc documentation for ClineAsk and ClineSay types (thanks @hannesrudolph!)
    - Populate whenToUse descriptions for built-in modes
    - Fix file write tool with early relPath & newContent validation checks (thanks @Ruakij!)
    - Fix TaskItem display and copy issues with HTML tags in task messages (thanks @forestyoo!)
    - Fix OpenRouter cost calculation with BYOK (thanks @chrarnoldus!)
    - Fix terminal busy state reset after manual commands complete
    - Fix undefined output on multi-file apply_diff operations (thanks @daniel-lxs!)

- [#769](https://github.com/Kilo-Org/kilocode/pull/769) [`d12f4a3`](https://github.com/Kilo-Org/kilocode/commit/d12f4a358af696fa8f8877446661345125c4bb52) Thanks [@hassoncs](https://github.com/hassoncs)! - Add task timeline visualization to help you navigate chat history

    We've added a new task timeline that gives you a visual overview of your conversation flow. You can click on timeline messages to quickly jump to specific points in your chat history, making it much easier to understand what happened during your session and navigate back to important moments.

    This feature is available as a new setting in Display Settings. Enable it when you want that extra visibility into your task progress!

## [v4.38.1]

- [#747](https://github.com/Kilo-Org/kilocode/pull/747) [`943c7dd`](https://github.com/Kilo-Org/kilocode/commit/943c7ddb671ed19bb4b9a35ec32ee7898424bf31) Thanks [@markijbema](https://github.com/markijbema)! - Close the browsertool properly when a remote browser is configured but a fallback local one is used

- [#746](https://github.com/Kilo-Org/kilocode/pull/746) [`701db76`](https://github.com/Kilo-Org/kilocode/commit/701db768e4bb7006cd4601983cf8ad0ab9579cda) Fix possible CSP error when loading OpenRouter endpoints from custom URL

## [v4.38.0]

- [#719](https://github.com/Kilo-Org/kilocode/pull/719) [`cc77370`](https://github.com/Kilo-Org/kilocode/commit/cc77370eb451348d3929ab1b94ca34af4de517f3) Thanks [@hassoncs](https://github.com/hassoncs)! - ## New Features

    Add ability to customize git commit generation prompt and provider

    ### Customized Commit Message Generation Prompts & Providers

    - **Custom API Configuration**: Added support for selecting a specific API configuration for commit message generation in Settings > Prompts
    - **Enhanced Commit Message Support**: Introduced a new `COMMIT_MESSAGE` support prompt type with comprehensive conventional commit format guidance

    ### Bug Fixes

    - The support prompts can now be saved/discarded like other settings

### Patch Changes

- [#706](https://github.com/Kilo-Org/kilocode/pull/706) [`48af442`](https://github.com/Kilo-Org/kilocode/commit/48af4429e0815eb6366cfa3a37015eadbd1df126) Thanks [@cobra91](https://github.com/cobra91)! - The OpenRouter provider now uses the custom base URL when fetching the model list.

## [v4.37.0]

### Minor Changes

- [#724](https://github.com/Kilo-Org/kilocode/pull/724) [`a3d70ac`](https://github.com/Kilo-Org/kilocode/commit/a3d70ac457c41ccb01f892237c948156cea20b86) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Added support for Excel (.xlsx) files

## [v4.36.0]

- [#690](https://github.com/Kilo-Org/kilocode/pull/690) [`9b1451a`](https://github.com/Kilo-Org/kilocode/commit/9b1451a47bd2bc567646a4a0c2a12b42826ab9d1) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.19.7:

    - Fix McpHub sidebar focus behavior to prevent unwanted focus grabbing
    - Disable checkpoint functionality when nested git repositories are detected to prevent conflicts
    - Remove unused Storybook components and dependencies to reduce bundle size
    - Add data-testid ESLint rule for improved testing standards (thanks @elianiva!)
    - Update development dependencies including eslint, knip, @types/node, i18next, fast-xml-parser, and @google/genai
    - Improve CI infrastructure with GitHub Actions and Blacksmith runner migrations
    - Replace explicit caching with implicit caching to reduce latency for Gemini models
    - Clarify that the default concurrent file read limit is 15 files (thanks @olearycrew!)
    - Fix copy button logic (thanks @samhvw8!)
    - Fade buttons on history preview if no interaction in progress (thanks @sachasayan!)
    - Allow MCP server refreshing, fix state changes in MCP server management UI view (thanks @taylorwilsdon!)
    - Remove unnecessary npx usage in some npm scripts (thanks @user202729!)
    - Bug fix for trailing slash error when using LiteLLM provider (thanks @kcwhite!)
    - Fix Gemini 2.5 Pro Preview thinking budget bug
    - Add Gemini Pro 06-05 model support (thanks @daniel-lxs and @shariqriazz!)
    - Fix reading PDF, DOCX, and IPYNB files in read_file tool (thanks @samhvw8!)
    - Fix Mermaid CSP errors with enhanced bundling strategy (thanks @KJ7LNW!)
    - Improve model info detection for custom Bedrock ARNs (thanks @adamhill!)
    - Add OpenAI Compatible embedder for codebase indexing (thanks @SannidhyaSah!)
    - Fix multiple memory leaks in ChatView component (thanks @kiwina!)
    - Fix WorkspaceTracker resource leaks by disposing FileSystemWatcher (thanks @kiwina!)
    - Fix RooTips setTimeout cleanup to prevent state updates on unmounted components (thanks @kiwina!)
    - Fix FileSystemWatcher leak in RooIgnoreController (thanks @kiwina!)
    - Fix clipboard memory leak by clearing setTimeout in useCopyToClipboard (thanks @kiwina!)
    - Fix ClineProvider instance cleanup (thanks @xyOz-dev!)
    - Enforce codebase_search as primary tool for code understanding tasks (thanks @hannesrudolph!)
    - Improve Docker setup for evals
    - Move evals into pnpm workspace, switch from SQLite to Postgres
    - Refactor MCP to use getDefaultEnvironment for stdio client transport (thanks @samhvw8!)
    - Get rid of "partial" component in names referencing not necessarily partial messages (thanks @wkordalski!)
    - Improve feature request template (thanks @elianiva!)

- [#592](https://github.com/Kilo-Org/kilocode/pull/592) [`68c3d6e`](https://github.com/Kilo-Org/kilocode/commit/68c3d6e7a1250e08e2bd2b9cbbbd6b4312bad045) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Workflow and rules configuration screen added

### Patch Changes

- [#697](https://github.com/Kilo-Org/kilocode/pull/697) [`9514f22`](https://github.com/Kilo-Org/kilocode/commit/9514f22a9d77b2d838ddcb97b5f2c5909aaea68a) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add correct path to walkthrough files to show walkthrough on first load (thanks for the report @adamhill!)

## [v4.35.1]

- [#695](https://github.com/Kilo-Org/kilocode/pull/695) [`a7910eb`](https://github.com/Kilo-Org/kilocode/commit/a7910eba54a4ede296bfa82beddae71a1d9f77c5) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix: Feedback button overlaps new mode creation dialog

- [#693](https://github.com/Kilo-Org/kilocode/pull/693) [`2a9edf8`](https://github.com/Kilo-Org/kilocode/commit/2a9edf85ca2062d0b296430348ebac967f28febb) Thanks [@hassoncs](https://github.com/hassoncs)! - Temporarily remove .kilocode/rule loading for commit message generation until it works better

## [v4.35.0]

- [#633](https://github.com/Kilo-Org/kilocode/pull/633) [`347cf9e`](https://github.com/Kilo-Org/kilocode/commit/347cf9e6dc10d5b8706af5e111ccc854f7742566) Thanks [@hassoncs](https://github.com/hassoncs)! - # AI-Powered Git Commit Message Generation

    Automatically generate meaningful Git commit messages using AI

    ## How It Works

    1. Stage your changes in Git as usual
    2. Click the [KILO] square icon in the Source Control panel
    3. The AI analyzes your staged changes and generates an appropriate commit message
    4. The generated message is automatically populated in the commit input box

- [#638](https://github.com/Kilo-Org/kilocode/pull/638) [`3d2e749`](https://github.com/Kilo-Org/kilocode/commit/3d2e749d51797681c018bc390757fdabefd60620) Thanks [@tru-kilo](https://github.com/tru-kilo)! - Added ability to favorite tasks

## [v4.34.1]

### Patch Changes

- [#612](https://github.com/Kilo-Org/kilocode/pull/612) [`793cfdd`](https://github.com/Kilo-Org/kilocode/commit/793cfdd4fc1411c63c818e14b0b6ca8c5225a859) Thanks [@HadesArchitect](https://github.com/HadesArchitect)! - - #611 Customer Support Visibility (Added links to contact customer support)

- [#672](https://github.com/Kilo-Org/kilocode/pull/672) [`c3d955c`](https://github.com/Kilo-Org/kilocode/commit/c3d955c2280258601d5f4b05101710e34d540075) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed response times for gemini-2.5-pro-preview being very slow (minutes instead of seconds)

- [#671](https://github.com/Kilo-Org/kilocode/pull/671) [`e0a3740`](https://github.com/Kilo-Org/kilocode/commit/e0a37406fe8102b1acd4f8e9005652e828a14e36) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - OpenRouter bring-your-own-key models now have much more accurate cost estimates.

## [v4.34.0]

### Minor Changes

- [#636](https://github.com/Kilo-Org/kilocode/pull/636) [`6193029`](https://github.com/Kilo-Org/kilocode/commit/6193029fb1d5e5ec09dd57acb9547179ff01c2b1) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.19.4

## [v4.33.2]

### Patch Changes

- [#628](https://github.com/Kilo-Org/kilocode/pull/628) [`3bfd49e`](https://github.com/Kilo-Org/kilocode/commit/3bfd49e495400d2be89f9754255a0af32db8f942) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add clarification about adding context and how to add files/images

## [v4.33.1]

### Patch Changes

- [#614](https://github.com/Kilo-Org/kilocode/pull/614) [`1753220`](https://github.com/Kilo-Org/kilocode/commit/1753220ef0dc9e56d4017c82153c7c022609ad21) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix issue with attempt_completion wanting to initialize telemetry (Roo leftover), we don't want telemetry

## [v4.33.0]

- [#597](https://github.com/Kilo-Org/kilocode/pull/597) [`7e9789c`](https://github.com/Kilo-Org/kilocode/commit/7e9789ce160f6fa82365b8bc8b5331ea99848f73) Thanks [@hassoncs](https://github.com/hassoncs)! - Experimental Autocomplete

    Introduces early support for "Kilo Complete", Kilo Code's new autocomplete engine. In this initial release, the Kilo Code provider is required and model selection isn’t yet configurable. Stay tuned for additional features, improvements to the completions, and customization options coming soon!

- [#610](https://github.com/Kilo-Org/kilocode/pull/610) [`9aabc2c`](https://github.com/Kilo-Org/kilocode/commit/9aabc2cf5214408d54124c97d0309c06396ad641) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add way to go back to active agent session from profile page, resolves #556 (thanks for the issue @karrots)

- [#603](https://github.com/Kilo-Org/kilocode/pull/603) [`99cb0a4`](https://github.com/Kilo-Org/kilocode/commit/99cb0a49e681b259c1089da07c9d3624a329b2a9) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.19.3

### Patch Changes

- [#541](https://github.com/Kilo-Org/kilocode/pull/541) [`6e14fce`](https://github.com/Kilo-Org/kilocode/commit/6e14fce02686c16482b0d5181c8fde9e4c3a7ca5) Thanks [@tru-kilo](https://github.com/tru-kilo)! - Fixed double scrollbars in profile dropdown

- [#584](https://github.com/Kilo-Org/kilocode/pull/584) [`0b8b9ae`](https://github.com/Kilo-Org/kilocode/commit/0b8b9ae0cb4819d93691a6552e140197355fc980) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix being unable to select certain Kilo Code Provider Models (a similarly named but different model would be selected instead)

## [v4.32.0]

### Minor Changes

- [#566](https://github.com/Kilo-Org/kilocode/pull/566) [`1cd5234`](https://github.com/Kilo-Org/kilocode/commit/1cd5234d01e46a53956dd22637a14a96a68b3a90) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.18.5

### Patch Changes

- [#568](https://github.com/Kilo-Org/kilocode/pull/568) [`d1afa39`](https://github.com/Kilo-Org/kilocode/commit/d1afa392c0285b79ce6133ed49d250baed99938a) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix Claude not supporting computer use

### Minor Changes

- [#561](https://github.com/Kilo-Org/kilocode/pull/561) [`4e8c7f2`](https://github.com/Kilo-Org/kilocode/commit/4e8c7f2394af0e0bef642a209acc6d6572602297) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Revert previous update, we found some issues, apologies

## [v4.30.0]

### Minor Changes

- [#546](https://github.com/Kilo-Org/kilocode/pull/546) [`3895af3`](https://github.com/Kilo-Org/kilocode/commit/3895af359e969c60572f50d9bb89f0be1a1fa3f6) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.18.5

- [#554](https://github.com/Kilo-Org/kilocode/pull/554) [`e8a6759`](https://github.com/Kilo-Org/kilocode/commit/e8a675935cb6470f5d9c0bcb84862f76c64f1e5f) Thanks [@seuros](https://github.com/seuros)! - Add fallback Support for Root-Level .mcp.json (thanks @seuros!)

### Patch Changes

- [#558](https://github.com/Kilo-Org/kilocode/pull/558) [`d5a0dad`](https://github.com/Kilo-Org/kilocode/commit/d5a0dad04263db3a38169b35c7bdd65600ee07e9) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Some text on the Providers Settings tab has been translated into languages other than English.

- [#539](https://github.com/Kilo-Org/kilocode/pull/539) [`a5958c9`](https://github.com/Kilo-Org/kilocode/commit/a5958c9b4c361fbd84fac0e03d495f8e0c7b600e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Include changes from Roo Code v3.18.1

- [#551](https://github.com/Kilo-Org/kilocode/pull/551) [`b6bc484`](https://github.com/Kilo-Org/kilocode/commit/b6bc4845b9e545d913bc76db2dae63fb744f87d1) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Kilo Code now has a menu item label on the right side panel

## [v4.29.2]

- [#524](https://github.com/Kilo-Org/kilocode/pull/524) [`e1d59f1`](https://github.com/Kilo-Org/kilocode/commit/e1d59f1278916b98ac4f1fa8a02cb694633b475e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix menu stops working when Kilo Code is moved between primary and secondary sidebars

## [v4.29.1]

- [#520](https://github.com/Kilo-Org/kilocode/pull/520) [`2e53902`](https://github.com/Kilo-Org/kilocode/commit/2e539020b1d4d19beba9c9a5929055cacd11f292) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Change recommended model to Claude 4 Sonnet

## [v4.29.0]

### Minor Changes

- [#514](https://github.com/Kilo-Org/kilocode/pull/514) [`c3581e9`](https://github.com/Kilo-Org/kilocode/commit/c3581e9edc18b9a1d6c6a5c5465078027b5669d9) Thanks [@PeterDaveHello](https://github.com/PeterDaveHello)! - Update xAI grok-3 with non-beta versions

- [#513](https://github.com/Kilo-Org/kilocode/pull/513) [`67aa950`](https://github.com/Kilo-Org/kilocode/commit/67aa950a0db745fab5490ee8245f9286fdb9dfeb) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Include changes from Roo Code v3.18.0

- [#490](https://github.com/Kilo-Org/kilocode/pull/490) [`c9693d7`](https://github.com/Kilo-Org/kilocode/commit/c9693d788b33eb7c52ffa919cc96e0f43125c971) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add Indonesian language support

### Patch Changes

- [#507](https://github.com/Kilo-Org/kilocode/pull/507) [`6734fd9`](https://github.com/Kilo-Org/kilocode/commit/6734fd903eaa8617369dd2a07a1a03610970017e) Thanks [@daliovic](https://github.com/daliovic)! - Also include support for claude 4 models via the Anthropic provider

## [v4.28.1]

- [#488](https://github.com/Kilo-Org/kilocode/pull/488) [`cd22ade`](https://github.com/Kilo-Org/kilocode/commit/cd22adee2290bb45951973584f37ed731065c63b) Thanks [@EamonNerbonne](https://github.com/EamonNerbonne)! - Enable caching for the new anthropic models

## [v4.28.0]

### Minor Changes

- [#483](https://github.com/Kilo-Org/kilocode/pull/483) [`29cb981`](https://github.com/Kilo-Org/kilocode/commit/29cb981650b11bd9772e2b140f9739457ee6c850) Thanks [@drakonen](https://github.com/drakonen)! - Added cline's workflow tool

### Patch Changes

- [#484](https://github.com/Kilo-Org/kilocode/pull/484) [`dd15860`](https://github.com/Kilo-Org/kilocode/commit/dd158603d42a996094de6bce7ead5bcc5077c754) Thanks [@RSO](https://github.com/RSO)! - Fixed rendering of avatars in the Profile section

## [v4.27.0]

### Minor Changes

- [#470](https://github.com/Kilo-Org/kilocode/pull/470) [`1715429`](https://github.com/Kilo-Org/kilocode/commit/17154292feeaa3cb364258a09e1a44916292ec3a) Thanks [@RSO](https://github.com/RSO)! - Added a profile view that shows your current Kilo Code balance

- [#476](https://github.com/Kilo-Org/kilocode/pull/476) [`262e7a2`](https://github.com/Kilo-Org/kilocode/commit/262e7a23c6c8f28742d11160982454762240940e) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add /smol command (thanks Cline and @0xToshii)

## [v4.26.0]

### Minor Changes

- [#473](https://github.com/Kilo-Org/kilocode/pull/473) [`9be2dc0`](https://github.com/Kilo-Org/kilocode/commit/9be2dc0773a00ca254d3e2f7dc92e5e06621e4d1) Thanks [@tru-kilo](https://github.com/tru-kilo)! - Added a slash reportbug command to report bugs directly from the extension to the kilocode repo

- [#437](https://github.com/Kilo-Org/kilocode/pull/437) [`84a7f07`](https://github.com/Kilo-Org/kilocode/commit/84a7f07ef529c4c5a70926ae90fae5023b637fc9) Thanks [@tru-kilo](https://github.com/tru-kilo)! - Added a slash newrule command

- [#442](https://github.com/Kilo-Org/kilocode/pull/442) [`b1b0f58`](https://github.com/Kilo-Org/kilocode/commit/b1b0f5857a5d86ac6b8fd455171c6fcdaef31722) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The Kilo Code Provider now supports web-based IDEs, such as FireBase Studio, through an alternative authentication flow. The user should copy and paste the API Key manually in this case.

## [v4.25.0]

### Minor Changes

- [#432](https://github.com/Kilo-Org/kilocode/pull/432) [`adfed7c`](https://github.com/Kilo-Org/kilocode/commit/adfed7c6df8cd9979df4ed152df8bda4017dc997) Thanks [@seuros](https://github.com/seuros)! - Support Streamable HTTP for MCP according to the [2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26) spec

- [#440](https://github.com/Kilo-Org/kilocode/pull/440) [`64adc9c`](https://github.com/Kilo-Org/kilocode/commit/64adc9cc5ac5ea8cbe03305d586de24dc7a989cc) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.17.2

### Patch Changes

- [#430](https://github.com/Kilo-Org/kilocode/pull/430) [`44ed7ad`](https://github.com/Kilo-Org/kilocode/commit/44ed7adf365d1103bed76e94458f6a661b4e382e) Thanks [@drakonen](https://github.com/drakonen)! - Added a notification when using non-kilocode-rules files

- [#436](https://github.com/Kilo-Org/kilocode/pull/436) [`c6f54b7`](https://github.com/Kilo-Org/kilocode/commit/c6f54b76be170b841bfce9c36f4565f40d868979) Thanks [@RSO](https://github.com/RSO)! - Make the prompts view accessible through the topbar

- [#434](https://github.com/Kilo-Org/kilocode/pull/434) [`f38e83c`](https://github.com/Kilo-Org/kilocode/commit/f38e83c3b640772bb376504ed65804e2da921fa0) Thanks [@RSO](https://github.com/RSO)! - Fixed bug in SettingsView that caused issues with detecting/saving changes

## [v4.24.0]

### Minor Changes

- [#401](https://github.com/Kilo-Org/kilocode/pull/401) [`d077452`](https://github.com/Kilo-Org/kilocode/commit/d0774527bbedad4478ce3767fae6cff7de864e50) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add ability to attach an image from within the context menu

- Include changes from Roo Code v3.16.6

### Patch Changes

- [#386](https://github.com/Kilo-Org/kilocode/pull/386) [`5caba61`](https://github.com/Kilo-Org/kilocode/commit/5caba61f49a0f87dabf1e50fcf2b6111452a45e0) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Clearly display Kilo Code recommended models

- [#354](https://github.com/Kilo-Org/kilocode/pull/354) [`106b722`](https://github.com/Kilo-Org/kilocode/commit/106b722e747f98edb15b5a8e7a65e19db31028db) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix wrong model after login (#213)

## [v4.23.0]

### Minor Changes

- [#381](https://github.com/Kilo-Org/kilocode/pull/381) [`60892c8`](https://github.com/Kilo-Org/kilocode/commit/60892c86cb88ff509e5fb38a80fdfd6b85b793b7) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.16.3

- [#303](https://github.com/Kilo-Org/kilocode/pull/303) [`b69a57e`](https://github.com/Kilo-Org/kilocode/commit/b69a57e316a740470a8be40d77dad50efde5c35c) Thanks [@drakonen](https://github.com/drakonen)! - Kilo Code Provider can now do all the OpenRouter models

## [v4.22.0]

### Minor Changes

- Switch mode icons from unicode emojis to codicons

### Patch Changes

- Fixed UI Issue - Unreadable transparent section at bottom of chat textArea. Thanks to @agape-apps for reporting this issue! See [Kilo-Org/kilocode#306](https://github.com/Kilo-Org/kilocode/issues/306)
- Fix feedback button overlapping selection action button in history view

## [v4.21.0]

### Minor Changes

- Include changes from Roo Code v3.15.5

### Patch Changes

- Fix issue with removed slash commands for changing modes

## [v4.20.1]

### Patch Changes

- Use the phrase feature-merge instead of superset in displayName and README
- Fix "Some text unreadable in Light high contrast theme" issue

## [v4.20.0]

- Include slash commands from Cline, include /newtask command

## [v4.19.1]

### Patch Changes

- Fix translations for system notifications
- Include changes from Roo Code v3.14.3

## [v4.19.0]

### Minor Changes

- Add easier way to add Kilo Code credit when balance is low

### Patch Changes

- Small UI improvements for dark themes

## [v4.18.0]

### Minor Changes

- Include changes from Roo Code v3.14.2

### Patch Changes

- Fix settingview appearing not to save when hitting save button
- Fix dark buttons on light vscode themes (thanks @Aikiboy123)

## [v4.17.0]

### Minor Changes

- Improve UI for new tasks, history and MCP servers
- Add commands for importing and exporting settings
- Include changes from Roo Code v3.13.2

### Patch Changes

- Fix chat window buttons overlapping on small sizes (thanks @Aikiboy123)
- Fix feedback button overlapping create mode button in prompts view
- Fix image thumbnails after pasting image (thanks @Aikiboy123)

## [v4.16.2]

- Include Roo Code v3.12.3 changes

## [v4.16.1]

- Fix http referer header

## [v4.16.0]

### Minor Changes

- Add better first time experience flow

### Patch Changes

- Fix confirmation dialog not closing in settings view
- Add support for Gemini 2.5 Flash Preview for Kilo Code provider

## [v4.15.0]

- Pull in updates from Roo Code v3.11.7
