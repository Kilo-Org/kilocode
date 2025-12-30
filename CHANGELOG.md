# kilo-code

## 4.141.0

### Minor Changes

- [#4702](https://github.com/Kilo-Org/kilocode/pull/4702) [`b84a66f`](https://github.com/Kilo-Org/kilocode/commit/b84a66f5923cf2600a6d5c8e2b5fd49759406696) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add support for skills

### Patch Changes

- [#4710](https://github.com/Kilo-Org/kilocode/pull/4710) [`c128319`](https://github.com/Kilo-Org/kilocode/commit/c1283192df1b0e59fef8b9ab2d3442bf4a07abde) Thanks [@sebastiand-cerebras](https://github.com/sebastiand-cerebras)! - Update Cerebras maxTokens from 8192 to 16384 for all models

- [#4718](https://github.com/Kilo-Org/kilocode/pull/4718) [`9a465b0`](https://github.com/Kilo-Org/kilocode/commit/9a465b06fe401f70dd166fb5b320a8070f07c727) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix terminal scroll-flicker in CLI by disabling streaming output and enabling Ink incremental rendering

- [#4719](https://github.com/Kilo-Org/kilocode/pull/4719) [`57b0873`](https://github.com/Kilo-Org/kilocode/commit/57b08737788cd504954563d46eb1e6323d619301) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Confirm before exiting the CLI on Ctrl+C/Cmd+C.

## 4.140.3

### Patch Changes

- [#4648](https://github.com/Kilo-Org/kilocode/pull/4648) [`4710d11`](https://github.com/Kilo-Org/kilocode/commit/4710d119ba6ead7f0198c22ae4e902478a63867e) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix Agent Manager multi-version sessions to wait for pending CLI processes so terminals are available per worktree.

- [#4658](https://github.com/Kilo-Org/kilocode/pull/4658) [`e189583`](https://github.com/Kilo-Org/kilocode/commit/e1895837b7dde1b8302f3d3eb49dad2b417fc1bb) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Improve Agent Manager telemetry

- [#4647](https://github.com/Kilo-Org/kilocode/pull/4647) [`c1a0692`](https://github.com/Kilo-Org/kilocode/commit/c1a06926e838af15e4be27a476ea3e35be430551) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - fix: reduce GPU usage in Agent Manager with message virtualization

- [#4693](https://github.com/Kilo-Org/kilocode/pull/4693) [`eb5e835`](https://github.com/Kilo-Org/kilocode/commit/eb5e835be3f3c5a7cf5f7cc4baec87bfade6e2b2) Thanks [@keeganwitt](https://github.com/keeganwitt)! - Add Requesty Codestral to autocomplete provider models

- [#4659](https://github.com/Kilo-Org/kilocode/pull/4659) [`fa42cfa`](https://github.com/Kilo-Org/kilocode/commit/fa42cfaa7b77a7f410c26eaf3810808cf3631ced) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix Agent Manager CLI detection and Windows spawn by sanitizing shell output and running .cmd via cmd.exe.

- [#4692](https://github.com/Kilo-Org/kilocode/pull/4692) [`1401220`](https://github.com/Kilo-Org/kilocode/commit/140122089a4de591c80573306ce81cd49091b510) Thanks [@mcowger](https://github.com/mcowger)! - Fix loss of Synthetic auto model refresh

## 4.140.2

### Patch Changes

- [#4628](https://github.com/Kilo-Org/kilocode/pull/4628) [`ab0085e`](https://github.com/Kilo-Org/kilocode/commit/ab0085ea0ba6226f6adce508965302b101f60233) Thanks [@kiloconnect](https://github.com/apps/kiloconnect)! - Add GLM-4.7 model support to Z.ai provider

- [#4622](https://github.com/Kilo-Org/kilocode/pull/4622) [`25de94b`](https://github.com/Kilo-Org/kilocode/commit/25de94b22fc103ebb9747433444f3fef9a7eeeb8) Thanks [@alvinward](https://github.com/alvinward)! - Added model selection support below prompt for Z.ai

- [#4637](https://github.com/Kilo-Org/kilocode/pull/4637) [`b47994f`](https://github.com/Kilo-Org/kilocode/commit/b47994f0b6186490230c7eac01c5b9b75146d47a) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add MiniMax-M2.1 model for MiniMax provider

## 4.140.1

### Patch Changes

- [#4615](https://github.com/Kilo-Org/kilocode/pull/4615) [`6909640`](https://github.com/Kilo-Org/kilocode/commit/690964040770cd21248e1bea964c995d8620d8e8) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add Agent Manager terminal switching so existing session terminals are revealed when changing sessions.

- [#4586](https://github.com/Kilo-Org/kilocode/pull/4586) [`a3988cd`](https://github.com/Kilo-Org/kilocode/commit/a3988cd201f21f7b7616d68cb2bb2c0387dd91c2) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix Agent Manager failing to start on macOS when launched from Finder/Spotlight

- [#4561](https://github.com/Kilo-Org/kilocode/pull/4561) [`3c18860`](https://github.com/Kilo-Org/kilocode/commit/3c188603cc4d8375be4abf6e1bb9217b64e9cd2b) Thanks [@jrf0110](https://github.com/jrf0110)! - Introduces AI contribution tracking so users can better understand agentic coding impact

- [#4526](https://github.com/Kilo-Org/kilocode/pull/4526) [`10b4d6c`](https://github.com/Kilo-Org/kilocode/commit/10b4d6c02f5b310dd6e44204fa40675ca4d3d99b) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Reduce the incidence of read_file errors when using Claude models.

- [#4560](https://github.com/Kilo-Org/kilocode/pull/4560) [`5bdfe6b`](https://github.com/Kilo-Org/kilocode/commit/5bdfe6b9b68acf345e302791c15291c05a043204) Thanks [@crazyrabbit0](https://github.com/crazyrabbit0)! - chore: update Gemini Cli models and metadata

    - Added gemini-3-flash-preview model configuration.
    - Updated maxThinkingTokens for gemini-3-pro-preview to 32,768.
    - Reordered model definitions to prioritize newer versions.

- [#4596](https://github.com/Kilo-Org/kilocode/pull/4596) [`1c33884`](https://github.com/Kilo-Org/kilocode/commit/1c3388442bd9a06dcb8aed29431c138726dbedc8) Thanks [@hank9999](https://github.com/hank9999)! - Fix duplicate tool use in Anthropic

- [#4620](https://github.com/Kilo-Org/kilocode/pull/4620) [`ae6818b`](https://github.com/Kilo-Org/kilocode/commit/ae6818b5ea2d5504f9ee5eff9bdd963d9d82c51e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix duplictate tool call processing in Chutes, DeepInfra, LiteLLM and xAI providers.

- [#4597](https://github.com/Kilo-Org/kilocode/pull/4597) [`e2bb5c1`](https://github.com/Kilo-Org/kilocode/commit/e2bb5c1891b6319954b46fcca3b35807fc1f8f90) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix Agent Manager not showing error when CLI is misconfigured. When the CLI exits with a configuration error (e.g., missing kilocodeToken), the extension now detects this and shows an error popup with options to run `kilocode auth` or `kilocode config`.

- [#4590](https://github.com/Kilo-Org/kilocode/pull/4590) [`f2cc065`](https://github.com/Kilo-Org/kilocode/commit/f2cc0657870ae77a5720a872c9cd11b8315799b7) Thanks [@kiloconnect](https://github.com/apps/kiloconnect)! - feat: add session_title_generated event emission to CLI

- [#4523](https://github.com/Kilo-Org/kilocode/pull/4523) [`e259b04`](https://github.com/Kilo-Org/kilocode/commit/e259b04037c71a9bdd9e53c174b70a975e772833) Thanks [@markijbema](https://github.com/markijbema)! - Add chat autocomplete telemetry

- [#4582](https://github.com/Kilo-Org/kilocode/pull/4582) [`3de2547`](https://github.com/Kilo-Org/kilocode/commit/3de254757049d08d3c0c100768acc564d6de4888) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains - Autocomplete Telemetry

- [#4488](https://github.com/Kilo-Org/kilocode/pull/4488) [`f7c3715`](https://github.com/Kilo-Org/kilocode/commit/f7c3715b4b7fea9fcd363d12bfb9467e9f169729) Thanks [@lifesized](https://github.com/lifesized)! - fix(ollama): fix model not found error and context window display

## 4.140.0

### Minor Changes

- [#4538](https://github.com/Kilo-Org/kilocode/pull/4538) [`459b95c`](https://github.com/Kilo-Org/kilocode/commit/459b95cbf78de10fce597e3467120e52020d1114) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Added gemini-3-flash-preview model

### Patch Changes

- [#4530](https://github.com/Kilo-Org/kilocode/pull/4530) [`782347e`](https://github.com/Kilo-Org/kilocode/commit/782347e9ed6cbaf42c88285cb8576801cd178d96) Thanks [@alvinward](https://github.com/alvinward)! - Add GLM-4.6V model support for z.ai provider

- [#4509](https://github.com/Kilo-Org/kilocode/pull/4509) [`8a9fddd`](https://github.com/Kilo-Org/kilocode/commit/8a9fddd8311633c3085516ab6255bb027aff81d6) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.36.6

    - Add tool alias support for model-specific tool customization, allowing users to configure how tools are presented to different AI models (PR #9989 by @daniel-lxs)
    - Sanitize MCP server and tool names for API compatibility, ensuring special characters don't cause issues with API calls (PR #10054 by @daniel-lxs)
    - Improve auto-approve timer visibility in follow-up suggestions for better user awareness of pending actions (PR #10048 by @brunobergher)
    - Fix: Cancel auto-approval timeout when user starts typing, preventing accidental auto-approvals during user interaction (PR #9937 by @roomote)
    - Add WorkspaceTaskVisibility type for organization cloud settings to support team visibility controls (PR #10020 by @roomote)
    - Fix: Extract raw error message from OpenRouter metadata for clearer error reporting (PR #10039 by @daniel-lxs)
    - Fix: Show tool protocol dropdown for LiteLLM provider, restoring missing configuration option (PR #10053 by @daniel-lxs)
    - Add: GPT-5.2 model to openai-native provider (PR #10024 by @hannesrudolph)
    - Fix: Handle empty Gemini responses and reasoning loops to prevent infinite retries (PR #10007 by @hannesrudolph)
    - Fix: Add missing tool_result blocks to prevent API errors when tool results are expected (PR #10015 by @daniel-lxs)
    - Fix: Filter orphaned tool_results when more results than tool_uses to prevent message validation errors (PR #10027 by @daniel-lxs)
    - Fix: Add general API endpoints for Z.ai provider (#9879 by @richtong, PR #9894 by @roomote)
    - Remove: Deprecated list_code_definition_names tool (PR #10005 by @hannesrudolph)
    - Add error details modal with on-demand display for improved error visibility when debugging issues (PR #9985 by @roomote)
    - Fix: Prevent premature rawChunkTracker clearing for MCP tools, improving reliability of MCP tool streaming (PR #9993 by @daniel-lxs)
    - Fix: Filter out 429 rate limit errors from API error telemetry for cleaner metrics (PR #9987 by @daniel-lxs)
    - Fix: Correct TODO list display order in chat view to show items in proper sequence (PR #9991 by @roomote)
    - Refactor: Unified context-management architecture with improved UX for better context control (PR #9795 by @hannesrudolph)
    - Add new `search_replace` native tool for single-replacement operations with improved editing precision (PR #9918 by @hannesrudolph)
    - Streaming tool stats and token usage throttling for better real-time feedback during generation (PR #9926 by @hannesrudolph)
    - Add versioned settings support with minPluginVersion gating for Roo provider (PR #9934 by @hannesrudolph)
    - Make Architect mode save plans to `/plans` directory and gitignore it (PR #9944 by @brunobergher)
    - Add ability to save screenshots from the browser tool (PR #9963 by @mrubens)
    - Refactor: Decouple tools from system prompt for cleaner architecture (PR #9784 by @daniel-lxs)
    - Update DeepSeek models to V3.2 with new pricing (PR #9962 by @hannesrudolph)
    - Add minimal and medium reasoning effort levels for Gemini models (PR #9973 by @hannesrudolph)
    - Update xAI models catalog with latest model options (PR #9872 by @hannesrudolph)
    - Add DeepSeek V3-2 support for Baseten provider (PR #9861 by @AlexKer)
    - Tweaks to Baseten model definitions for better defaults (PR #9866 by @mrubens)
    - Fix: Add xhigh reasoning effort support for gpt-5.1-codex-max (#9891 by @andrewginns, PR #9900 by @andrewginns)
    - Fix: Add Kimi, MiniMax, and Qwen model configurations for Bedrock (#9902 by @jbearak, PR #9905 by @app/roomote)
    - Configure tool preferences for xAI models (PR #9923 by @hannesrudolph)
    - Default to using native tools when supported on OpenRouter (PR #9878 by @mrubens)
    - Fix: Exclude apply_diff from native tools when diffEnabled is false (#9919 by @denis-kudelin, PR #9920 by @app/roomote)
    - Fix: Always show tool protocol selector for openai-compatible provider (#9965 by @bozoweed, PR #9966 by @hannesrudolph)
    - Fix: Respect explicit supportsReasoningEffort array values for proper model configuration (PR #9970 by @hannesrudolph)
    - Add timeout configuration to OpenAI Compatible Provider Client (PR #9898 by @dcbartlett)
    - Revert default tool protocol change from xml to native for stability (PR #9956 by @mrubens)
    - Improve OpenAI error messages to be more useful for debugging (PR #9639 by @mrubens)
    - Better error logs for parseToolCall exceptions (PR #9857 by @cte)
    - Improve cloud job error logging for RCC provider errors (PR #9924 by @cte)
    - Fix: Display actual API error message instead of generic text on retry (PR #9954 by @hannesrudolph)
    - Add API error telemetry to OpenRouter provider for better diagnostics (PR #9953 by @daniel-lxs)
    - Fix: Sanitize removed/invalid API providers to prevent infinite loop (PR #9869 by @hannesrudolph)
    - Fix: Use foreground color for context-management icons (PR #9912 by @hannesrudolph)
    - Fix: Suppress 'ask promise was ignored' error in handleError (PR #9914 by @daniel-lxs)
    - Fix: Process finish_reason to emit tool_call_end events properly (PR #9927 by @daniel-lxs)
    - Fix: Add finish_reason processing to xai.ts provider (PR #9929 by @daniel-lxs)
    - Fix: Validate and fix tool_result IDs before API requests (PR #9952 by @daniel-lxs)
    - Fix: Return undefined instead of 0 for disabled API timeout (PR #9960 by @hannesrudolph)
    - Stop making unnecessary count_tokens requests for better performance (PR #9884 by @mrubens)
    - Refactor: Consolidate ThinkingBudget components and fix disable handling (PR #9930 by @hannesrudolph)
    - Forbid time estimates in architect mode for more focused planning (PR #9931 by @app/roomote

- [#4568](https://github.com/Kilo-Org/kilocode/pull/4568) [`b1702cd`](https://github.com/Kilo-Org/kilocode/commit/b1702cd1c3119a89c96edf23c388b84135b8cbd3) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Remove redundant "New Agent" and "Refresh messages" buttons from agent manager session detail header.

- [#4228](https://github.com/Kilo-Org/kilocode/pull/4228) [`a128228`](https://github.com/Kilo-Org/kilocode/commit/a128228b3649924ad1fd88d040a79c6963a250bd) Thanks [@lambertjosh](https://github.com/lambertjosh)! - Change the default value of auto-approval for reading outside workspace to false

## 4.139.0

### Minor Changes

- [#4481](https://github.com/Kilo-Org/kilocode/pull/4481) [`61c951c`](https://github.com/Kilo-Org/kilocode/commit/61c951c0ad11d60b07406338b6053cc5d1f01cac) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Improved command output rendering in Agent Manager with new CommandExecutionBlock component that displays terminal output with status indicators, collapsible output sections, and proper escape sequence handling.

- [#4483](https://github.com/Kilo-Org/kilocode/pull/4483) [`fd639ab`](https://github.com/Kilo-Org/kilocode/commit/fd639ab78aa4ab62ea2d120bd2844d1160b20067) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add branch picker to Agent Manager for selecting base branch in worktree mode

- [#4539](https://github.com/Kilo-Org/kilocode/pull/4539) [`62a0241`](https://github.com/Kilo-Org/kilocode/commit/62a02418cafa23a733f92a9e14ba904552acdcc4) Thanks [@brianc](https://github.com/brianc)! - Improve managed indexer error handling & backoff.

### Patch Changes

- [#4512](https://github.com/Kilo-Org/kilocode/pull/4512) [`f979b56`](https://github.com/Kilo-Org/kilocode/commit/f979b56b6a631eeeb671caaca276316b63b5fb82) Thanks [@hassoncs](https://github.com/hassoncs)! - Add a tooltip explaining why speech-to-text may be unavailable

- [#4424](https://github.com/Kilo-Org/kilocode/pull/4424) [`cd0cd88`](https://github.com/Kilo-Org/kilocode/commit/cd0cd8833f0e892cc2f1c96bb24ede6254cf12c9) Thanks [@markijbema](https://github.com/markijbema)! - Added a snooze for autocomplete in the settings

- [#4519](https://github.com/Kilo-Org/kilocode/pull/4519) [`a9fd203`](https://github.com/Kilo-Org/kilocode/commit/a9fd2038ecb60fd799d164bcf1b2e4393302d15a) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix text.startsWith is not a function crash

- [#4536](https://github.com/Kilo-Org/kilocode/pull/4536) [`51f4774`](https://github.com/Kilo-Org/kilocode/commit/51f4774adcb90778826e00e9a50c45bb7bf11bc8) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix image generation handler not using Kilo Gateway properly

- [#4491](https://github.com/Kilo-Org/kilocode/pull/4491) [`823b86f`](https://github.com/Kilo-Org/kilocode/commit/823b86f196868f12efc60e5acb9b385d014bc644) Thanks [@markijbema](https://github.com/markijbema)! - Prevent autocomplete from showing suggestions duplicating the previous or next line

- [#4531](https://github.com/Kilo-Org/kilocode/pull/4531) [`9413d73`](https://github.com/Kilo-Org/kilocode/commit/9413d730814d88ac67c88e6eec9a66c2c701613e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix duplicate tool processing in OpenAI-compatible provider

- [#4533](https://github.com/Kilo-Org/kilocode/pull/4533) [`20b2c29`](https://github.com/Kilo-Org/kilocode/commit/20b2c29140f401ac65d437e35c52b48329e5f52d) Thanks [@mcowger](https://github.com/mcowger)! - Add gemini-3-flash-preview model configuration to vertex models

- [#4520](https://github.com/Kilo-Org/kilocode/pull/4520) [`8342fc4`](https://github.com/Kilo-Org/kilocode/commit/8342fc4fbdc2a83601c706e734ef3377ef114f98) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Normalize line endings in search and replace tool

## 4.138.0

### Minor Changes

- [#4472](https://github.com/Kilo-Org/kilocode/pull/4472) [`d2e82a1`](https://github.com/Kilo-Org/kilocode/commit/d2e82a115afac0467787db63d51c696d08ee102d) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Interactive agent manager worktree sessions now start without auto-execution, allowing to manually click "Finish to Branch".

- [#4428](https://github.com/Kilo-Org/kilocode/pull/4428) [`8394da8`](https://github.com/Kilo-Org/kilocode/commit/8394da8715fae4eacf416301885eeee840456700) Thanks [@iscekic](https://github.com/iscekic)! - add parent session id when creating a session

### Patch Changes

- [#4425](https://github.com/Kilo-Org/kilocode/pull/4425) [`6f70448`](https://github.com/Kilo-Org/kilocode/commit/6f70448300567b7ded997231b049346aa2718d92) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Share kilocode extension authentication directly with agent manager

- [#4475](https://github.com/Kilo-Org/kilocode/pull/4475) [`625561f`](https://github.com/Kilo-Org/kilocode/commit/625561f11669d6458729b01dcbe630a551ecfe04) Thanks [@jrf0110](https://github.com/jrf0110)! - Fixes issue on Windows where kilo code would spawn many cmd.exe windows.

- [#4376](https://github.com/Kilo-Org/kilocode/pull/4376) [`3971db3`](https://github.com/Kilo-Org/kilocode/commit/3971db3215d7339514031e094e87e9c889c9372d) Thanks [@sebastiand-cerebras](https://github.com/sebastiand-cerebras)! - Add Cerebras integration header with "kilocode" identifier to all API requests.

- [#4447](https://github.com/Kilo-Org/kilocode/pull/4447) [`0022305`](https://github.com/Kilo-Org/kilocode/commit/0022305558d71957aeb7468a0e8e3ed829997f93) Thanks [@EamonNerbonne](https://github.com/EamonNerbonne)! - Provide a few tips for when an LLM gets stuck in a loop

- [#4456](https://github.com/Kilo-Org/kilocode/pull/4456) [`85a2e31`](https://github.com/Kilo-Org/kilocode/commit/85a2e31a331157f27bfe1c9823e3326ae58779c6) Thanks [@iscekic](https://github.com/iscekic)! - correctly handle deleted tasks

- [#4476](https://github.com/Kilo-Org/kilocode/pull/4476) [`ea9413d`](https://github.com/Kilo-Org/kilocode/commit/ea9413d4fb01846b1aeb872652c92fa8e844d35f) Thanks [@hassoncs](https://github.com/hassoncs)! - Remove check for ffmpeg if the STT experiment is disabled

## 4.137.0

### Minor Changes

- [#4394](https://github.com/Kilo-Org/kilocode/pull/4394) [`01b968b`](https://github.com/Kilo-Org/kilocode/commit/01b968ba4635a162c787169bffe1809fc1ab973a) Thanks [@hassoncs](https://github.com/hassoncs)! - Add Speech-To-Text experiment for the chat input powered by ffmpeg and the OpenAI Whisper API

- [#4388](https://github.com/Kilo-Org/kilocode/pull/4388) [`af93318`](https://github.com/Kilo-Org/kilocode/commit/af93318e3648c235721ba58fe9caab9429608241) Thanks [@iscekic](https://github.com/iscekic)! - send org id and last mode with session data

### Patch Changes

- [#4412](https://github.com/Kilo-Org/kilocode/pull/4412) [`d56879c`](https://github.com/Kilo-Org/kilocode/commit/d56879c58f65c8da1419c9840816720279bec4e6) Thanks [@quantizoor](https://github.com/quantizoor)! - Added support for xhigh reasoning effort

- [#4415](https://github.com/Kilo-Org/kilocode/pull/4415) [`5e670d1`](https://github.com/Kilo-Org/kilocode/commit/5e670d14047054a2f92a9057391286402076b5a5) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix: bottom controls no longer overlap with create mode button

- [#4416](https://github.com/Kilo-Org/kilocode/pull/4416) [`026da65`](https://github.com/Kilo-Org/kilocode/commit/026da65fdb9f16d23216197412e06ca2ed208639) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - fix: resolve AbortSignal memory leak in CLI (MaxListenersExceededWarning)

- [#4392](https://github.com/Kilo-Org/kilocode/pull/4392) [`73681e9`](https://github.com/Kilo-Org/kilocode/commit/73681e9002af4c5aa3fec3bc2a86e8008dc926af) Thanks [@markijbema](https://github.com/markijbema)! - Split autocomplete suggestion in current line and next lines in most cases

- [#4426](https://github.com/Kilo-Org/kilocode/pull/4426) [`fdc0c0a`](https://github.com/Kilo-Org/kilocode/commit/fdc0c0a07d49c4726997121ad540d6c855965e7b) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix API request errors with MCP functions incompatible with OpenAI strict mode

- [#4373](https://github.com/Kilo-Org/kilocode/pull/4373) [`a80ec02`](https://github.com/Kilo-Org/kilocode/commit/a80ec02db75c061163100ce91d099f4fd3846a99) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Handle different cli authentication errors when using agent manager

## 4.136.0

### Minor Changes

- [#4380](https://github.com/Kilo-Org/kilocode/pull/4380) [`802cc70`](https://github.com/Kilo-Org/kilocode/commit/802cc700a6ef4bc2f7537a4cfff1663da01982c3) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add multi-version feature to Agent Manager - launch 1-4 parallel agents in parallel on git worktrees

### Patch Changes

- [#4396](https://github.com/Kilo-Org/kilocode/pull/4396) [`b2a75e6`](https://github.com/Kilo-Org/kilocode/commit/b2a75e6013c6ec1f01a3e735c51b355a5e1e0308) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add support for GPT-5.2

## 4.135.0

### Minor Changes

- [#4326](https://github.com/Kilo-Org/kilocode/pull/4326) [`6d62090`](https://github.com/Kilo-Org/kilocode/commit/6d620905dfc6d8419bdbc9ffcad54109057e709e) Thanks [@iscekic](https://github.com/iscekic)! - improve session sync mechanism (event based instead of timer)

- [#4333](https://github.com/Kilo-Org/kilocode/pull/4333) [`0093fd1`](https://github.com/Kilo-Org/kilocode/commit/0093fd15e1a3baa80a872bc8889c5e219684004c) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.36.2

    - Restrict GPT-5 tool set to apply_patch for improved compatibility (PR #9853 by @hannesrudolph)
    - Fix: Resolve Chutes provider model fetching issue (PR #9854 by @cte)
    - Add MessageManager layer for centralized history coordination, fixing message synchronization issues (PR #9842 by @hannesrudolph)
    - Fix: Prevent cascading truncation loop by only truncating visible messages (PR #9844 by @hannesrudolph)
    - Fix: Handle unknown/invalid native tool calls to prevent extension freeze (PR #9834 by @daniel-lxs)
    - Always enable reasoning for models that require it (PR #9836 by @cte)
    - ChatView: Smoother stick-to-bottom behavior during streaming (PR #8999 by @hannesrudolph)
    - UX: Improved error messages and documentation links (PR #9777 by @brunobergher)
    - Fix: Overly round follow-up question suggestions styling (PR #9829 by @brunobergher)
    - Ignore input to the execa terminal process for safer command execution (PR #9827 by @mrubens)
    - Be safer about large file reads (PR #9843 by @jr)
    - Add gpt-5.1-codex-max model to OpenAI provider (PR #9848 by @hannesrudolph)
    - Evals UI: Add filtering, bulk delete, tool consolidation, and run notes (PR #9837 by @hannesrudolph)
    - Evals UI: Add multi-model launch and UI improvements (PR #9845 by @hannesrudolph)
    - Web: New pricing page (PR #9821 by @brunobergher)
    - Fix: Restore context when rewinding after condense (#8295 by @hannesrudolph, PR #9665 by @hannesrudolph)
    - Enable search_and_replace for Minimax models (PR #9780 by @mrubens)
    - Fix: Resolve Vercel AI Gateway model fetching issues (PR #9791 by @cte)
    - Fix: Apply conservative max tokens for Cerebras provider (PR #9804 by @sebastiand-cerebras)
    - Fix: Remove omission detection logic to eliminate false positives (#9785 by @Michaelzag, PR #9787 by @app/roomote)
    - Refactor: Remove deprecated insert_content tool (PR #9751 by @daniel-lxs)
    - Chore: Hide parallel tool calls experiment and disable feature (PR #9798 by @hannesrudolph)
    - Update next.js documentation site dependencies (PR #9799 by @jr)
    - Fix: Correct download count display on homepage (PR #9807 by @mrubens)
    - Feat: Add provider routing selection for OpenRouter embeddings (#9144 by @SannidhyaSah, PR #9693 by @SannidhyaSah)
    - Default Minimax M2 to native tool calling (PR #9778 by @mrubens)
    - Sanitize the native tool calls to fix a bug with Gemini (PR #9769 by @mrubens)
    - Fix: Handle malformed native tool calls to prevent hanging (PR #9758 by @daniel-lxs)
    - Fix: Remove reasoning toggles for GLM-4.5 and GLM-4.6 on z.ai provider (PR #9752 by @roomote)
    - Refactor: Remove line_count parameter from write_to_file tool (PR #9667 by @hannesrudolph)
    - Switch to new welcome view for improved onboarding experience (PR #9741 by @mrubens)
    - Update homepage with latest changes (PR #9675 by @brunobergher)
    - Improve privacy for stealth models by adding vendor confidentiality section to system prompt (PR #9742 by @mrubens)
    - Allow models to contain default temperature settings for provider-specific optimal defaults (PR #9734 by @mrubens)
    - Enable native tool support for all LiteLLM models by default (PR #9736 by @mrubens)
    - Pass app version to provider for improved request tracking (PR #9730 by @cte)
    - Fix: Flush pending tool results before task delegation (PR #9726 by @daniel-lxs)
    - Improve: Better IPC error logging for easier debugging (PR #9727 by @cte)
    - Metadata-driven subtasks with automatic parent resume and single-open safety for improved task orchestration (#8081 by @hannesrudolph, PR #9090 by @hannesrudolph)
    - Native tool calling support expanded across many providers: Bedrock (PR #9698 by @mrubens), Cerebras (PR #9692 by @mrubens), Chutes with auto-detection from API (PR #9715 by @daniel-lxs), DeepInfra (PR #9691 by @mrubens), DeepSeek and Doubao (PR #9671 by @daniel-lxs), Groq (PR #9673 by @daniel-lxs), LiteLLM (PR #9719 by @daniel-lxs), Ollama (PR #9696 by @mrubens), OpenAI-compatible providers (PR #9676 by @daniel-lxs), Requesty (PR #9672 by @daniel-lxs), Unbound (PR #9699 by @mrubens), Vercel AI Gateway (PR #9697 by @mrubens), Vertex Gemini (PR #9678 by @daniel-lxs), and xAI with new Grok 4 Fast and Grok 4.1 Fast models (PR #9690 by @mrubens)
    - Fix: Preserve tool_use blocks in summary for parallel tool calls (#9700 by @SilentFlower, PR #9714 by @SilentFlower)
    - Default Grok Code Fast to native tools for better performance (PR #9717 by @mrubens)
    - UX toolbar cleanup and settings consolidation for a cleaner interface (PR #9710 by @brunobergher)
    - Add model-specific tool customization via `excludedTools` and `includedTools` configuration (PR #9641 by @daniel-lxs)
    - Add new `apply_patch` native tool for more efficient file editing operations (PR #9663 by @hannesrudolph)
    - Add new `search_and_replace` tool for batch text replacements across files (PR #9549 by @hannesrudolph)
    - Add debug buttons to view API and UI history for troubleshooting (PR #9684 by @hannesrudolph)
    - Include tool format in environment details for better context awareness (PR #9661 by @mrubens)
    - Fix: Display install count in millions instead of thousands (PR #9677 by @app/roomote)
    - Fix: Prevent navigation buttons from wrapping on smaller screens (PR #9721 by @app/roomote)
    - Fix: Race condition in new_task tool for native protocol (PR #9655 by @daniel-lxs)

### Patch Changes

- [#4379](https://github.com/Kilo-Org/kilocode/pull/4379) [`37b90be`](https://github.com/Kilo-Org/kilocode/commit/37b90be866111761dd90c3a0c8f179f5be16242c) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add todo list UI to Agent Manager, displaying task progress above the chat input with a collapsible list view

- [#4266](https://github.com/Kilo-Org/kilocode/pull/4266) [`3ad7248`](https://github.com/Kilo-Org/kilocode/commit/3ad7248effa3b78f93b2f39c875735cd50b78d98) Thanks [@helloGitWorld-ctrl](https://github.com/helloGitWorld-ctrl)! - JetBrains - Improve multiproject conflicts

- [#4366](https://github.com/Kilo-Org/kilocode/pull/4366) [`11c2f87`](https://github.com/Kilo-Org/kilocode/commit/11c2f870a82b39cbbb2d3e9bcdecc8bc13b44adb) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Agent Manager: remind first-time CLI installs to run `kilocode auth` after opening the install terminal, with translations.

- [#4389](https://github.com/Kilo-Org/kilocode/pull/4389) [`ac3350e`](https://github.com/Kilo-Org/kilocode/commit/ac3350e3caff0c3c93e9f3808633d776855cefa8) Thanks [@iscekic](https://github.com/iscekic)! - fix share url handling

- [#4362](https://github.com/Kilo-Org/kilocode/pull/4362) [`d596a08`](https://github.com/Kilo-Org/kilocode/commit/d596a08d6fe5c1a719855616ba5f582407f6769a) Thanks [@iscekic](https://github.com/iscekic)! - extract an extension message handler for extension/cli reuse

- [#4361](https://github.com/Kilo-Org/kilocode/pull/4361) [`24813e9`](https://github.com/Kilo-Org/kilocode/commit/24813e900e50bf63dbb553a951970467221ce73d) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix Kilo Auth flow

- [#4374](https://github.com/Kilo-Org/kilocode/pull/4374) [`612e472`](https://github.com/Kilo-Org/kilocode/commit/612e47277d32eb4c481e15fa47c4216015597e88) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix styling issue on task headers

- [#4308](https://github.com/Kilo-Org/kilocode/pull/4308) [`a9eab93`](https://github.com/Kilo-Org/kilocode/commit/a9eab931b11baf20e229dd328dd47557fa29fe49) Thanks [@markijbema](https://github.com/markijbema)! - Minor tuning to autocomplete

- [#4375](https://github.com/Kilo-Org/kilocode/pull/4375) [`58c4096`](https://github.com/Kilo-Org/kilocode/commit/58c40964bb07135a0e9df29a253651a255ccffa2) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Agent Manager - Local CLI install for immutable environments

- [#4369](https://github.com/Kilo-Org/kilocode/pull/4369) [`5195bd0`](https://github.com/Kilo-Org/kilocode/commit/5195bd00067d83474606dfca0df71abfed13566a) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Agent-Manager - Fix Chat Input scroll

## 4.134.0

### Minor Changes

- [#4330](https://github.com/Kilo-Org/kilocode/pull/4330) [`57dc5a9`](https://github.com/Kilo-Org/kilocode/commit/57dc5a9379b25eb2e1f9902486ff71db731a5aaf) Thanks [@catrielmuller](https://github.com/catrielmuller)! - JetBrains IDEs: Autocomplete is now available and can be enabled in Settings > Autocomplete.

- [#4178](https://github.com/Kilo-Org/kilocode/pull/4178) [`414282a`](https://github.com/Kilo-Org/kilocode/commit/414282a5a5c6cdfe528c3a7775bf07cd3e0739aa) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Added a new device authorization flow for Kilo Gateway that makes it easier to connect your editor to your Kilo account. Instead of manually copying API tokens, you can now:

    - Scan a QR code with your phone or click to open the authorization page in your browser
    - Approve the connection from your browser
    - Automatically get authenticated without copying any tokens

    This streamlined workflow provides a more secure and user-friendly way to authenticate, similar to how you connect devices to services like Netflix or YouTube.

- [#4334](https://github.com/Kilo-Org/kilocode/pull/4334) [`5bdab7c`](https://github.com/Kilo-Org/kilocode/commit/5bdab7caca867970a5ee7faccfb76e36e01c6471) Thanks [@brianc](https://github.com/brianc)! - Updated managed indexing gate logic to be able to roll it out to individuals instead of just organizations.

- [#3999](https://github.com/Kilo-Org/kilocode/pull/3999) [`7f349d0`](https://github.com/Kilo-Org/kilocode/commit/7f349d04749f74a9b84de8cb68f44d8d8d71cbc5) Thanks [@hassoncs](https://github.com/hassoncs)! - Add Autocomplete support to the chat text box. It can be enabled/disabled using a new toggle in the autocomplete settings menu

### Patch Changes

- [#4327](https://github.com/Kilo-Org/kilocode/pull/4327) [`52fc352`](https://github.com/Kilo-Org/kilocode/commit/52fc3524151f30d3925408d30fd8af9265890b77) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - fix agent creation getting stuck when CLI doesn't respond with session_created event

- [#4182](https://github.com/Kilo-Org/kilocode/pull/4182) [`33c9eab`](https://github.com/Kilo-Org/kilocode/commit/33c9eabd2ef395e585f37542980e996054bf3fcb) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains - Fix open external urls

## 4.133.0

### Minor Changes

- [#4317](https://github.com/Kilo-Org/kilocode/pull/4317) [`797c959`](https://github.com/Kilo-Org/kilocode/commit/797c9594a527f19e0d39b7402fb031cd9eb4e2a7) Thanks [@iscekic](https://github.com/iscekic)! - add session versioning

### Patch Changes

- [#3571](https://github.com/Kilo-Org/kilocode/pull/3571) [`ea2702c`](https://github.com/Kilo-Org/kilocode/commit/ea2702c6f29e7ff2bfe55714716f72bb43cfbede) Thanks [@yadue](https://github.com/yadue)! - Add batch size and number of retries to the indexing options

- [#4310](https://github.com/Kilo-Org/kilocode/pull/4310) [`e5e6085`](https://github.com/Kilo-Org/kilocode/commit/e5e6085d1f9b4f142130eddd3eaddb52bd5cde17) Thanks [@iscekic](https://github.com/iscekic)! - check token before syncing session

- [#4272](https://github.com/Kilo-Org/kilocode/pull/4272) [`3ad35d9`](https://github.com/Kilo-Org/kilocode/commit/3ad35d94a5560ca1b87b2b393c6d064703c144d4) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix: reset state errors when clearing indexing state

## 4.132.0

### Minor Changes

- [#4305](https://github.com/Kilo-Org/kilocode/pull/4305) [`e7b0aa2`](https://github.com/Kilo-Org/kilocode/commit/e7b0aa2290cbffef7aeb66b8bbcbf2ca71bcdb28) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add Agent Manager for running multiple Kilo Code agents in parallel from a single panel.

### Patch Changes

- [#4117](https://github.com/Kilo-Org/kilocode/pull/4117) [`2224b90`](https://github.com/Kilo-Org/kilocode/commit/2224b90019f9cc1efacd2e638902732fc6aade02) Thanks [@ShirleyRex](https://github.com/ShirleyRex)! - fix chat textarea autoscroll to keep caret visible

- [#4304](https://github.com/Kilo-Org/kilocode/pull/4304) [`8ca99f4`](https://github.com/Kilo-Org/kilocode/commit/8ca99f433810c188707c97ace90f5bbf82406d3c) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed an issue that caused the Kilo Gateway model list to never refresh

- [#4288](https://github.com/Kilo-Org/kilocode/pull/4288) [`32efaf2`](https://github.com/Kilo-Org/kilocode/commit/32efaf2e79a5203cb85732316baa92d056b0c5a1) Thanks [@pandemicsyn](https://github.com/pandemicsyn)! - Begin emitting session_synced event

## 4.131.2

### Patch Changes

- [#4281](https://github.com/Kilo-Org/kilocode/pull/4281) [`e0ed242`](https://github.com/Kilo-Org/kilocode/commit/e0ed24298b6dc33b8f1c52124b613503d85498aa) Thanks [@iscekic](https://github.com/iscekic)! - force release workflow run

## 4.131.1

### Patch Changes

- [#4278](https://github.com/Kilo-Org/kilocode/pull/4278) [`a389603`](https://github.com/Kilo-Org/kilocode/commit/a3896030e963d4c94200716035cce446e838be35) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix webview assets build

- [#4275](https://github.com/Kilo-Org/kilocode/pull/4275) [`ce50373`](https://github.com/Kilo-Org/kilocode/commit/ce50373dd6ff4f011783e2f44dd41e6a9b77a8d3) Thanks [@iscekic](https://github.com/iscekic)! - use new endpoint for uploading session blobs via presigned r2 urls

- [#4270](https://github.com/Kilo-Org/kilocode/pull/4270) [`bdb7ed4`](https://github.com/Kilo-Org/kilocode/commit/bdb7ed4f2a148b297a21c39457fe13ddc38de3de) Thanks [@iscekic](https://github.com/iscekic)! - fix an issue where a session was duplicated instead of restored

## 4.131.0

### Minor Changes

- [#4083](https://github.com/Kilo-Org/kilocode/pull/4083) [`5696916`](https://github.com/Kilo-Org/kilocode/commit/5696916cb3e24175e3d48dff15d2609126d2c3d0) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.32.1-v3.34.7

    - Enable native tool calling for Moonshot models (PR #9646 by @mrubens)
    - Fix: OpenRouter tool calls handling improvements (PR #9642 by @mrubens)
    - Fix: OpenRouter GPT-5 strict schema validation for read_file tool (PR #9633 by @daniel-lxs)
    - Fix: Create parent directories early in write_to_file to prevent ENOENT errors (#9634 by @ivanenev, PR #9640 by @daniel-lxs)
    - Fix: Disable native tools and temperature support for claude-code provider (PR #9643 by @hannesrudolph)
    - Add 'taking you to cloud' screen after provider welcome for improved onboarding (PR #9652 by @mrubens)
    - Add support for AWS Bedrock embeddings in code indexing (#8658 by @kyle-hobbs, PR #9475 by @ggoranov-smar)
    - Add native tool calling support for Mistral provider (PR #9625 by @hannesrudolph)
    - Wire MULTIPLE_NATIVE_TOOL_CALLS experiment to OpenAI parallel_tool_calls for parallel tool execution (PR #9621 by @hannesrudolph)
    - Add fine grained tool streaming for OpenRouter Anthropic (PR #9629 by @mrubens)
    - Allow global inference selection for Bedrock when cross-region is enabled (PR #9616 by @roomote)
    - Fix: Filter non-Anthropic content blocks before sending to Vertex API (#9583 by @cardil, PR #9618 by @hannesrudolph)
    - Fix: Restore content undefined check in WriteToFileTool.handlePartial() (#9611 by @Lissanro, PR #9614 by @daniel-lxs)
    - Fix: Prevent model cache from persisting empty API responses (#9597 by @zx2021210538, PR #9623 by @daniel-lxs)
    - Fix: Exclude access_mcp_resource tool when MCP has no resources (PR #9615 by @daniel-lxs)
    - Fix: Update default settings for inline terminal and codebase indexing (PR #9622 by @roomote)
    - Fix: Convert line_ranges strings to lineRanges objects in native tool calls (PR #9627 by @daniel-lxs)
    - Fix: Defer new_task tool_result until subtask completes for native protocol (PR #9628 by @daniel-lxs)
    - Experimental feature to enable multiple native tool calls per turn (PR #9273 by @daniel-lxs)
    - Add Bedrock Opus 4.5 to global inference model list (PR #9595 by @roomote)
    - Fix: Update API handler when toolProtocol changes (PR #9599 by @mrubens)
    - Make single file read only apply to XML tools (PR #9600 by @mrubens)
    - Add new Black Forest Labs image generation models, available on OpenRouter (PR #9587 and #9589 by @mrubens)
    - Fix: Preserve dynamic MCP tool names in native mode API history to prevent tool name mismatches (PR #9559 by @daniel-lxs)
    - Fix: Preserve tool_use blocks in summary message during condensing with native tools to maintain conversation context (PR #9582 by @daniel-lxs)
    - Implement streaming for native tool calls, providing real-time feedback during tool execution (PR #9542 by @daniel-lxs)
    - Fix ask_followup_question streaming issue and add missing tool cases (PR #9561 by @daniel-lxs)
    - Switch from asdf to mise-en-place in bare-metal evals setup script (PR #9548 by @cte)
    - Fix: Gracefully skip unsupported content blocks in Gemini transformer (PR #9537 by @daniel-lxs)
    - Fix: Flush LiteLLM cache when credentials change on refresh (PR #9536 by @daniel-lxs)
    - Fix: Ensure XML parser state matches tool protocol on config update (PR #9535 by @daniel-lxs)
    - Fix: Support reasoning_details format for Gemini 3 models (PR #9506 by @daniel-lxs)
    - Show the prompt for image generation in the UI (PR #9505 by @mrubens)
    - Fix double todo list display issue (PR #9517 by @mrubens)
    - Add Browser Use 2.0 with enhanced browser interaction capabilities (PR #8941 by @hannesrudolph)
    - Add support for Baseten as a new AI provider (PR #9461 by @AlexKer)
    - Improve base OpenAI compatible provider with better error handling and configuration (PR #9462 by @mrubens)
    - Add provider-oriented welcome screen to improve onboarding experience (PR #9484 by @mrubens)
    - Enhance native tool descriptions with examples and clarifications for better AI understanding (PR #9486 by @daniel-lxs)
    - Fix: Make cancel button immediately responsive during streaming (#9435 by @jwadow, PR #9448 by @daniel-lxs)
    - Fix: Resolve apply_diff performance regression from earlier changes (PR #9474 by @daniel-lxs)
    - Fix: Implement model cache refresh to prevent stale disk cache issues (PR #9478 by @daniel-lxs)
    - Fix: Copy model-level capabilities to OpenRouter endpoint models correctly (PR #9483 by @daniel-lxs)
    - Fix: Add fallback to yield tool calls regardless of finish_reason (PR #9476 by @daniel-lxs)
    - Store reasoning in conversation history for all providers (PR #9451 by @daniel-lxs)
    - Fix: Improve preserveReasoning flag to control API reasoning inclusion (PR #9453 by @daniel-lxs)
    - Fix: Prevent OpenAI Native parallel tool calls for native tool calling (PR #9433 by @hannesrudolph)
    - Fix: Improve search and replace symbol parsing (PR #9456 by @daniel-lxs)
    - Fix: Send tool_result blocks for skipped tools in native protocol (PR #9457 by @daniel-lxs)
    - Fix: Improve markdown formatting and add reasoning support (PR #9458 by @daniel-lxs)
    - Fix: Prevent duplicate environment_details when resuming cancelled tasks (PR #9442 by @daniel-lxs)
    - Improve read_file tool description with examples (PR #9422 by @daniel-lxs)
    - Update glob dependency to ^11.1.0 (PR #9449 by @jr)
    - Update tar-fs to 3.1.1 via pnpm override (PR #9450 by @app/roomote)
    - Add RCC credit balance display (PR #9386 by @jr)
    - Fix: Preserve user images in native tool call results (PR #9401 by @daniel-lxs)
    - Perf: Reduce excessive getModel() calls and implement disk cache fallback (PR #9410 by @daniel-lxs)
    - Show zero price for free models (PR #9419 by @mrubens)
    - Fix: Resolve native tool protocol race condition causing 400 errors (PR #9363 by @daniel-lxs)
    - Fix: Update tools to return structured JSON for native protocol (PR #9373 by @daniel-lxs)
    - Fix: Include nativeArgs in tool repetition detection (PR #9377 by @daniel-lxs)
    - Fix: Ensure no XML parsing when protocol is native (PR #9371 by @daniel-lxs)
    - Fix: Gemini maxOutputTokens and reasoning config (PR #9375 by @hannesrudolph)
    - Fix: Gemini thought signature validation and token counting errors (PR #9380 by @hannesrudolph)
    - Fix: Exclude XML tool examples from MODES section when native protocol enabled (PR #9367 by @daniel-lxs)
    - Retry eval tasks if API instability detected (PR #9365 by @cte)
    - Add toolProtocol property to PostHog tool usage telemetry (PR #9374 by @app/roomote)
    - Improve Google Gemini defaults with better temperature and cost reporting (PR #9327 by @hannesrudolph)
    - Add git status information to environment details (PR #9310 by @daniel-lxs)
    - Add tool protocol selector to advanced settings (PR #9324 by @daniel-lxs)
    - Implement dynamic tool protocol resolution with proper precedence hierarchy (PR #9286 by @daniel-lxs)
    - Move Import/Export functionality to Modes view toolbar and cleanup Mode Edit view (PR #9077 by @hannesrudolph)
    - Fix: Prevent duplicate tool_result blocks in native tool protocol (PR #9248 by @daniel-lxs)
    - Fix: Format tool responses properly for native protocol (PR #9270 by @daniel-lxs)
    - Fix: Centralize toolProtocol configuration checks (PR #9279 by @daniel-lxs)
    - Fix: Preserve tool blocks for native protocol in conversation history (PR #9319 by @daniel-lxs)
    - Fix: Prevent infinite loop when task_done succeeds (PR #9325 by @daniel-lxs)
    - Fix: Sync parser state with profile/model changes (PR #9355 by @daniel-lxs)
    - Fix: Pass tool protocol parameter to lineCountTruncationError (PR #9358 by @daniel-lxs)
    - Use VSCode theme color for outline button borders (PR #9336 by @app/roomote)
    - Fix: Add abort controller for request cancellation in OpenAI native protocol (PR #9276 by @daniel-lxs)
    - Fix: Resolve duplicate tool blocks causing 'tool has already been used' error in native protocol mode (PR #9275 by @daniel-lxs)
    - Fix: Prevent duplicate tool_result blocks in native protocol mode for read_file (PR #9272 by @daniel-lxs)
    - Fix: Correct OpenAI Native handling of encrypted reasoning blocks to prevent errors during condensing (PR #9263 by @hannesrudolph)
    - Fix: Disable XML parser for native tool protocol to prevent parsing conflicts (PR #9277 by @daniel-lxs)

### Patch Changes

- [#4211](https://github.com/Kilo-Org/kilocode/pull/4211) [`489b366`](https://github.com/Kilo-Org/kilocode/commit/489b3669c34f437dfd7c4b9a692cf7d84fff73a1) Thanks [@iscekic](https://github.com/iscekic)! - refactor session manager to better handle asynchronicity of file save events

## 4.130.1

### Patch Changes

- [#4222](https://github.com/Kilo-Org/kilocode/pull/4222) [`fffff4d`](https://github.com/Kilo-Org/kilocode/commit/fffff4d73ec8168443e06b9dc1cfcfebfdbf58fb) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix Jetbrains webview

- [#4176](https://github.com/Kilo-Org/kilocode/pull/4176) [`a71ee92`](https://github.com/Kilo-Org/kilocode/commit/a71ee92a8a35494a7693748951386c32e24b43ca) Thanks [@iscekic](https://github.com/iscekic)! - adds the /session show command

- [#4227](https://github.com/Kilo-Org/kilocode/pull/4227) [`652ddda`](https://github.com/Kilo-Org/kilocode/commit/652ddda991e79ce8bcf4f9bf8af97b0c7a610bbc) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix VSCode webview assets

- [#4204](https://github.com/Kilo-Org/kilocode/pull/4204) [`c200579`](https://github.com/Kilo-Org/kilocode/commit/c2005792b71ff8ea8d2e15286575294eb079066f) Thanks [@iscekic](https://github.com/iscekic)! - fixes session cleanup race conditions

## 4.130.0

### Minor Changes

- [#4131](https://github.com/Kilo-Org/kilocode/pull/4131) [`9a2ef51`](https://github.com/Kilo-Org/kilocode/commit/9a2ef512bb50143b6cff690f912f7fd8dcfa65b7) Thanks [@mcowger](https://github.com/mcowger)! - Fix tool parsing failure in write_to_file with JSON contents

## 4.129.0

### Minor Changes

- [#4171](https://github.com/Kilo-Org/kilocode/pull/4171) [`b4b086b`](https://github.com/Kilo-Org/kilocode/commit/b4b086b8520192685e6c262202ecd1863abf1af1) Thanks [@brianc](https://github.com/brianc)! - Fix: prevent crash-loop if ManagedIndexer fails to instantiate.

- [#4145](https://github.com/Kilo-Org/kilocode/pull/4145) [`230bcec`](https://github.com/Kilo-Org/kilocode/commit/230bcec1cdb77bffad06c05aff1e33a908b077b8) Thanks [@iscekic](https://github.com/iscekic)! - add session sharing and forking

### Patch Changes

- [#4145](https://github.com/Kilo-Org/kilocode/pull/4145) [`230bcec`](https://github.com/Kilo-Org/kilocode/commit/230bcec1cdb77bffad06c05aff1e33a908b077b8) Thanks [@iscekic](https://github.com/iscekic)! - update shared session url

## 4.128.0

### Minor Changes

- [#4165](https://github.com/Kilo-Org/kilocode/pull/4165) [`6e9ff79`](https://github.com/Kilo-Org/kilocode/commit/6e9ff7910ba1b51b1e460ce3c7d63e66d803cb70) Thanks [@EamonNerbonne](https://github.com/EamonNerbonne)! - Add separate "Delete" auto-approve option

## 4.127.0

### Minor Changes

- [#4129](https://github.com/Kilo-Org/kilocode/pull/4129) [`a2d5b29`](https://github.com/Kilo-Org/kilocode/commit/a2d5b29ce79853e6a98cb30b86af1844b6023833) Thanks [@brianc](https://github.com/brianc)! - Managed Code Indexing UI internals updated. Removed optionality in the UI, included link to backend management UI, and improved architecture for better incremental status and error reporting.

- [#4066](https://github.com/Kilo-Org/kilocode/pull/4066) [`1831796`](https://github.com/Kilo-Org/kilocode/commit/18317963fbb5b02a1178f4579d5cb643cfbd531c) Thanks [@iscekic](https://github.com/iscekic)! - use shared session manager from extension folder

### Patch Changes

- [#4128](https://github.com/Kilo-Org/kilocode/pull/4128) [`29fbec0`](https://github.com/Kilo-Org/kilocode/commit/29fbec0b6a9feb4bc79ba819a164b45ccec236bb) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix: show diff buttons after task completion

- [#4120](https://github.com/Kilo-Org/kilocode/pull/4120) [`ebe1667`](https://github.com/Kilo-Org/kilocode/commit/ebe1667e8160a809a82f561627ce5494fa8808d3) Thanks [@iscekic](https://github.com/iscekic)! - increase session sync interval to 3s

- [#4071](https://github.com/Kilo-Org/kilocode/pull/4071) [`d5e89a1`](https://github.com/Kilo-Org/kilocode/commit/d5e89a141e8736902c6dcb2e8ab253cc8590abe7) Thanks [@inj-src](https://github.com/inj-src)! - Added support for Gemini 3 Pro Preview to Gemini CLI provider and removed deprecated models

- [#4137](https://github.com/Kilo-Org/kilocode/pull/4137) [`119e31b`](https://github.com/Kilo-Org/kilocode/commit/119e31b610f24621ae91731ce1596b6cded0ec24) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Slightly improved reliability of Opus with Claude Code

- [#4149](https://github.com/Kilo-Org/kilocode/pull/4149) [`04497da`](https://github.com/Kilo-Org/kilocode/commit/04497dabeafffd7b1f1f8ab94e66198884c1390c) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix for double id's stored in profiles when activating a new profile and then adding a new one

## 4.126.1

### Patch Changes

- [#4114](https://github.com/Kilo-Org/kilocode/pull/4114) [`ac020d6`](https://github.com/Kilo-Org/kilocode/commit/ac020d600e5034ca025b71213aa64c5629cab219) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix profile editing when adjusting non-activated profile

## 4.126.0

### Minor Changes

- [#4026](https://github.com/Kilo-Org/kilocode/pull/4026) [`a44ec02`](https://github.com/Kilo-Org/kilocode/commit/a44ec024347d345f46bf01486a6913f0e1e5a8c2) Thanks [@quantizoor](https://github.com/quantizoor)! - Add possibility to specify Azure deployment name for Anthropic models

## 4.125.1

### Patch Changes

- [#4057](https://github.com/Kilo-Org/kilocode/pull/4057) [`c2a7407`](https://github.com/Kilo-Org/kilocode/commit/c2a7407e8964c5fa8114d17ab5a6936b81c785ab) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Kilo Code sidebar no longer steals focus on startup when managed codebase indexing is active

## 4.125.0

### Minor Changes

- [#2827](https://github.com/Kilo-Org/kilocode/pull/2827) [`c7793db`](https://github.com/Kilo-Org/kilocode/commit/c7793dbd44371431f68deb76863af5f0c21375f4) Thanks [@bea-leanix](https://github.com/bea-leanix)! - Added SAP AI Core provider

- [#3895](https://github.com/Kilo-Org/kilocode/pull/3895) [`f5d3459`](https://github.com/Kilo-Org/kilocode/commit/f5d34595f3a8c9436fb870b5f22bb8094db9f3c5) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.30.1-v3.32.0

    - Feature: Support for OpenAI Responses 24 hour prompt caching (PR #9259 by @hannesrudolph)
    - Fix: OpenAI Native encrypted_content handling and remove gpt-5-chat-latest verbosity flag (#9225 by @politsin, PR by @hannesrudolph)
    - Refactor: Rename sliding-window to context-management and truncateConversationIfNeeded to manageContext (thanks @hannesrudolph!)
    - Fix: Apply updated API profile settings when provider/model unchanged (#9208 by @hannesrudolph, PR by @hannesrudolph)
    - Migrate conversation continuity to plugin-side encrypted reasoning items using Responses API for improved reliability (thanks @hannesrudolph!)
    - Fix: Include mcpServers in getState() for auto-approval (#9190 by @bozoweed, PR by @daniel-lxs)
    - Batch settings updates from the webview to the extension host for improved performance (thanks @cte!)
    - Fix: Replace rate-limited badges with badgen.net to improve README reliability (thanks @daniel-lxs!)
    - Fix: Prevent command_output ask from blocking in cloud/headless environments (thanks @daniel-lxs!)
    - Fix: Model switch re-applies selected profile, ensuring task configuration stays in sync (#9179 by @hannesrudolph, PR by @hannesrudolph)
    - Move auto-approval logic from `ChatView` to `Task` for better architecture (thanks @cte!)
    - Add custom Button component with variant system (thanks @brunobergher!)
    - Improvements to to-do lists and task headers (thanks @brunobergher!)
    - Fix: Prevent crash when streaming chunks have null choices array (thanks @daniel-lxs!)
    - Fix: Prevent context condensing on settings save when provider/model unchanged (#4430 by @hannesrudolph, PR by @daniel-lxs)
    - Fix: Respect custom OpenRouter URL for all API operations (#8947 by @sstraus, PR by @roomote)
    - Fix: Auto-retry on empty assistant response to prevent task failures (#9076 by @Akillatech, PR by @daniel-lxs)
    - Fix: Use system role for OpenAI Compatible provider when streaming is disabled (#8215 by @whitfin, PR by @roomote)
    - Fix: Prevent notification sound on attempt_completion with queued messages (#8537 by @hannesrudolph, PR by @roomote)
    - Feat: Auto-switch to imported mode with architect fallback for better mode detection (#8239 by @hannesrudolph, PR by @daniel-lxs)
    - Feat: Improve diff appearance in main chat view (thanks @hannesrudolph!)
    - UX: Home screen visuals (thanks @brunobergher!)
    - Fix: eliminate UI flicker during task cancellation (thanks @daniel-lxs!)
    - Add Global Inference support for Bedrock models (#8750 by @ronyblum, PR by @hannesrudolph)
    - Add Qwen3 embedding models (0.6B and 4B) to OpenRouter support (#9058 by @dmarkey, PR by @app/roomote)
    - Fix: keep pinned models fixed at top of scrollable list (#8812 by @XiaoYingYo, PR by @app/roomote)
    - Fix: update Opus 4.1 max tokens from 8K to 32K (#9045 by @kaveh-deriv, PR by @app/roomote)
    - Set Claude Sonnet 4.5 as default for key providers (thanks @hannesrudolph!)
    - Fix: dynamic provider model validation to prevent cross-contamination (#9047 by @NotADev137, PR by @daniel-lxs)
    - Fix: Bedrock user agent to report full SDK details (#9031 by @ajjuaire, PR by @ajjuaire)
    - Add file path tooltips with centralized PathTooltip component (#8278 by @da2ce7, PR by @daniel-lxs)
    - Fix: Correct OpenRouter Mistral model embedding dimension from 3072 to 1536 (thanks @daniel-lxs!)

- [#3868](https://github.com/Kilo-Org/kilocode/pull/3868) [`cf6ed3e`](https://github.com/Kilo-Org/kilocode/commit/cf6ed3ed3bc7dfe0268121f3e68d422f3ffadfff) Thanks [@iscekic](https://github.com/iscekic)! - add sessions support

### Patch Changes

- [#4059](https://github.com/Kilo-Org/kilocode/pull/4059) [`d47a3d5`](https://github.com/Kilo-Org/kilocode/commit/d47a3d52dfbf669fdf50be53c416b060cd537e40) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix error on task resumption with some providers when native tool calls are enabled

- [#3565](https://github.com/Kilo-Org/kilocode/pull/3565) [`4a05694`](https://github.com/Kilo-Org/kilocode/commit/4a05694ac84007397a2b99c826151d6383506001) Thanks [@marcus-v-rodrigues](https://github.com/marcus-v-rodrigues)! - Fix 403 error for Gemini CLI by removing 'default' project fallback

- [#2540](https://github.com/Kilo-Org/kilocode/pull/2540) [`591da2b`](https://github.com/Kilo-Org/kilocode/commit/591da2b8dae2d4c72c0663302e19dfe6e30b1617) Thanks [@gerardbalaoro](https://github.com/gerardbalaoro)! - Support for MCP servers in `.cursor/mcp.json`

- [#2324](https://github.com/Kilo-Org/kilocode/pull/2324) [`ab9b94b`](https://github.com/Kilo-Org/kilocode/commit/ab9b94b0d593bccd222c5cbb7fdffe968d4c6a40) Thanks [@mikkihugo](https://github.com/mikkihugo)! - Add VS Code Settings Sync integration

- [#3193](https://github.com/Kilo-Org/kilocode/pull/3193) [`6a895de`](https://github.com/Kilo-Org/kilocode/commit/6a895dec08d6afccb21dc431c021200f52c4c7cf) Thanks [@siulong](https://github.com/siulong)! - Fix rules folder path when deleting the rules

- [#3804](https://github.com/Kilo-Org/kilocode/pull/3804) [`5d4b38b`](https://github.com/Kilo-Org/kilocode/commit/5d4b38b67ed670da1de651de0491906a594174ac) Thanks [@skridlevsky](https://github.com/skridlevsky)! - fix(settings): codebase indexing toggle not persisting

- [#3484](https://github.com/Kilo-Org/kilocode/pull/3484) [`ac01ae3`](https://github.com/Kilo-Org/kilocode/commit/ac01ae30e735502b6cb265f79ab6f82bf954fb52) Thanks [@mental-lab](https://github.com/mental-lab)! - Add warning for ANTHROPIC_API_KEY conflicts with Claude Code provider

- [#3087](https://github.com/Kilo-Org/kilocode/pull/3087) [`ebab11b`](https://github.com/Kilo-Org/kilocode/commit/ebab11b033dd354c175a4027657446b745a82d96) Thanks [@jinhan1414](https://github.com/jinhan1414)! - Unify slash command parsing and expand mention detection

## 4.124.0

### Minor Changes

- [#2587](https://github.com/Kilo-Org/kilocode/pull/2587) [`f3de1e7`](https://github.com/Kilo-Org/kilocode/commit/f3de1e713c3a61fe04a30aa26e33ef7431ed63f4) Thanks [@NaccOll](https://github.com/NaccOll)! - Add LanceDB vector store support

### Patch Changes

- [#4045](https://github.com/Kilo-Org/kilocode/pull/4045) [`b14afb1`](https://github.com/Kilo-Org/kilocode/commit/b14afb11363a62d45d1feb176d9b5054d75d43a9) Thanks [@eshurakov](https://github.com/eshurakov)! - Nano GPT provider support (by @b3nw)

- [#4023](https://github.com/Kilo-Org/kilocode/pull/4023) [`5af4d01`](https://github.com/Kilo-Org/kilocode/commit/5af4d01b3e0d4467e8234c1c445d098c1f6756f2) Thanks [@markijbema](https://github.com/markijbema)! - Small redesign of the autocomplete statusbar/tooltip

## 4.123.0

### Minor Changes

- [#3020](https://github.com/Kilo-Org/kilocode/pull/3020) [`147786c`](https://github.com/Kilo-Org/kilocode/commit/147786c81238c1adea9c2bddf649d0763dd449d2) Thanks [@CaiDingxian](https://github.com/CaiDingxian)! - Add independent provider setup for Fast Apply feature

### Patch Changes

- [#4019](https://github.com/Kilo-Org/kilocode/pull/4019) [`f16c31b`](https://github.com/Kilo-Org/kilocode/commit/f16c31bf921a642e23d54fb2dfd768e07be8de71) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add Opus 4.5 to Claude Code provider

- [#3445](https://github.com/Kilo-Org/kilocode/pull/3445) [`8065f7a`](https://github.com/Kilo-Org/kilocode/commit/8065f7a44958ec2584ee591d7e936eacdfe73951) Thanks [@jeanduplessis](https://github.com/jeanduplessis)! - fix: apply file limit after .kilocodeignore filtering instead of before

- [#3988](https://github.com/Kilo-Org/kilocode/pull/3988) [`a169e6f`](https://github.com/Kilo-Org/kilocode/commit/a169e6fb0632f06b3271fdcb03d01d5ab7eebd69) Thanks [@dltechy](https://github.com/dltechy)! - Fix an issue where workflows are not working except as the initial prompt of a task

## 4.122.1

### Patch Changes

- [#4000](https://github.com/Kilo-Org/kilocode/pull/4000) [`3ef2237`](https://github.com/Kilo-Org/kilocode/commit/3ef2237493f48ac212732a5b7d67eceb4af0d594) Thanks [@brianc](https://github.com/brianc)! - There was previously some debug log spam introduced for the Managed Indexing feature. This change removes those logs.

- [#4005](https://github.com/Kilo-Org/kilocode/pull/4005) [`5aa56df`](https://github.com/Kilo-Org/kilocode/commit/5aa56df5123d33ba0ecadeabb3727b57974a842e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add Claude Opus 4.5 support, including verbosity controls for Kilo Gateway, OpenRouter and Anthropic providers

## 4.122.0

### Minor Changes

- [#3609](https://github.com/Kilo-Org/kilocode/pull/3609) [`65191fd`](https://github.com/Kilo-Org/kilocode/commit/65191fd671e3b4b376efe572b4e605dbf9d3a5d2) Thanks [@mcowger](https://github.com/mcowger)! - Synthetic provider to use updated models endpoint and dynamic fetcher

- [#3674](https://github.com/Kilo-Org/kilocode/pull/3674) [`cdd439a`](https://github.com/Kilo-Org/kilocode/commit/cdd439a098f0b1ccb75f8b8cad53a35494e6ab29) Thanks [@mental-lab](https://github.com/mental-lab)! - Kilo Code can now delete files and directories without using command line tools.

### Patch Changes

- [#3925](https://github.com/Kilo-Org/kilocode/pull/3925) [`02abc84`](https://github.com/Kilo-Org/kilocode/commit/02abc84c41e4a12dd45ff15d003ce8fbb4a6bfed) Thanks [@jrf0110](https://github.com/jrf0110)! - Improve organization/managed indexing performance

## 4.121.2

### Patch Changes

- [#3951](https://github.com/Kilo-Org/kilocode/pull/3951) [`1f4f9bd`](https://github.com/Kilo-Org/kilocode/commit/1f4f9bdf739d5b0dec0fdef366c1d58b6d3ffbcb) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add Gemini 3 Pro Image Preview

- [#3879](https://github.com/Kilo-Org/kilocode/pull/3879) [`d07e192`](https://github.com/Kilo-Org/kilocode/commit/d07e1924fe5be984a630442cfcc8e3bd3a4879b1) Thanks [@Maosghoul](https://github.com/Maosghoul)! - Optimized MiniMax M2 interleaved thinking by merging environment details into tool results.

- [#3939](https://github.com/Kilo-Org/kilocode/pull/3939) [`189aee3`](https://github.com/Kilo-Org/kilocode/commit/189aee3a36906857d1e6fb02c05081382e87bf4e) Thanks [@ajspetner](https://github.com/ajspetner)! - Added grok-4-1-fast-reasoning and grok-4-1-fast-non-reasoning models

## [v4.121.1]

- [#3601](https://github.com/Kilo-Org/kilocode/pull/3601) [`eaf1f5a`](https://github.com/Kilo-Org/kilocode/commit/eaf1f5ab7d2916c4845093d605e54301938d8383) Thanks [@hassoncs](https://github.com/hassoncs)! - Now items in the Chat context menu will not be auto selected if your cursor is already on the row when the items change

- [#3915](https://github.com/Kilo-Org/kilocode/pull/3915) [`c096af9`](https://github.com/Kilo-Org/kilocode/commit/c096af99d3eb6d18a7faa1bf7234250802225645) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improve file edit success rates for non-Claude models with native tool calling

- [#3912](https://github.com/Kilo-Org/kilocode/pull/3912) [`6036695`](https://github.com/Kilo-Org/kilocode/commit/60366955f4a7b73fe0c32c592a324ce2b6b07e30) Thanks [@markijbema](https://github.com/markijbema)! - Do not show browser window when closing the browser

- [#3911](https://github.com/Kilo-Org/kilocode/pull/3911) [`ae8f4c7`](https://github.com/Kilo-Org/kilocode/commit/ae8f4c7625168d64aab2e621516d47a15e874a0d) Thanks [@markijbema](https://github.com/markijbema)! - Fixed model search, now finds gemini again

## [v4.121.0]

- [#3886](https://github.com/Kilo-Org/kilocode/pull/3886) [`00e6fb5`](https://github.com/Kilo-Org/kilocode/commit/00e6fb59a42dcf827f7cfe72516052c561723cd0) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improve XLSX support

### Patch Changes

- [#3872](https://github.com/Kilo-Org/kilocode/pull/3872) [`75509af`](https://github.com/Kilo-Org/kilocode/commit/75509af40f2daefda36c492fd87b5f40966ec835) Thanks [@ShivamB25](https://github.com/ShivamB25)! - Update default Gemini model to gemini-3-pro-preview

- [#3878](https://github.com/Kilo-Org/kilocode/pull/3878) [`7b01fc8`](https://github.com/Kilo-Org/kilocode/commit/7b01fc880d76eb398c9cfca0c9a09478f69c3478) Thanks [@markijbema](https://github.com/markijbema)! - Fix manual configuration in welcome flow

## [v4.120.0]

- [#3778](https://github.com/Kilo-Org/kilocode/pull/3778) [`b9a9f70`](https://github.com/Kilo-Org/kilocode/commit/b9a9f70bc5963aa2a2d1cae4ef551c22b725a330) Thanks [@markijbema](https://github.com/markijbema)! - Made the dropdown searches more intuitive, search like vscode does

### Patch Changes

- [#3867](https://github.com/Kilo-Org/kilocode/pull/3867) [`23b805b`](https://github.com/Kilo-Org/kilocode/commit/23b805b051d05d3610b9cadc9842f8d0345acf1e) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add Gemini 3 Pro Preview to Gemini and Vertex providers (thanks @Sn0wo2!)

- [#3832](https://github.com/Kilo-Org/kilocode/pull/3832) [`9d77cb1`](https://github.com/Kilo-Org/kilocode/commit/9d77cb1e62d277c2cd9a9d66373d582668e3dd09) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Reduced the incidence of unsuccessful edits with MiniMax M2

## [v4.119.6]

- [#3836](https://github.com/Kilo-Org/kilocode/pull/3836) [`b5cf145`](https://github.com/Kilo-Org/kilocode/commit/b5cf145c1542af1f317a51fb4f55d79960aad711) Thanks [@mcowger](https://github.com/mcowger)! - Add GPT-5.1 models for OpenAI provider

- [#3732](https://github.com/Kilo-Org/kilocode/pull/3732) [`c75dd9f`](https://github.com/Kilo-Org/kilocode/commit/c75dd9f8d66b291259daa6ef2750168fe9727a70) Thanks [@markijbema](https://github.com/markijbema)! - When editting a profile is the settings, do not implicitly switch to that profile

- [#3793](https://github.com/Kilo-Org/kilocode/pull/3793) [`20f0b71`](https://github.com/Kilo-Org/kilocode/commit/20f0b71ba8009269651f617127c4e8fdbd486f20) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Default GPT 5.x Codex to JSON style tool calls

## [v4.119.5]

- [#3794](https://github.com/Kilo-Org/kilocode/pull/3794) [`180998d`](https://github.com/Kilo-Org/kilocode/commit/180998d889e08258950ed1aa9eb220d9daf302e9) Thanks [@mcowger](https://github.com/mcowger)! - Fix LiteLLM Provider Config crash when uninitialized.

- [#3792](https://github.com/Kilo-Org/kilocode/pull/3792) [`b8c85fe`](https://github.com/Kilo-Org/kilocode/commit/b8c85fed3c1060b724157523a7f1e03e59efbf54) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Prevent MiniMax provider from using ANTHROPIC_AUTH_TOKEN environment variable

- [#3801](https://github.com/Kilo-Org/kilocode/pull/3801) [`cfc1ab8`](https://github.com/Kilo-Org/kilocode/commit/cfc1ab8b22327cdf079a0191af8fdb988ad5efca) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Potential fix for hanging chat

- [#3613](https://github.com/Kilo-Org/kilocode/pull/3613) [`feda236`](https://github.com/Kilo-Org/kilocode/commit/feda2361b66a11cb2d5766dc2f0fd56e716de03e) Thanks [@mcowger](https://github.com/mcowger)! - Enable native tool calling for LiteLLM provider

## [v4.119.4]

- [#3788](https://github.com/Kilo-Org/kilocode/pull/3788) [`49131b7`](https://github.com/Kilo-Org/kilocode/commit/49131b78bef98e1a24b6bf9457e072c9acc1230f) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix hang when model wants to write JSON file with native tool calls enabled

## [v4.119.3]

- [#3766](https://github.com/Kilo-Org/kilocode/pull/3766) [`e2fb2a5`](https://github.com/Kilo-Org/kilocode/commit/e2fb2a57703c19b5ee9c10d6c35ccc68d3cdcfe7) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix Z.ai provider not working with JSON-style tool calls (thanks @mcowger for reporting)

- [#3768](https://github.com/Kilo-Org/kilocode/pull/3768) [`72476d5`](https://github.com/Kilo-Org/kilocode/commit/72476d53dfdca589070db67ab6d826e52374515f) Thanks [@iscekic](https://github.com/iscekic)! - preapprove codebase_search

- [#3750](https://github.com/Kilo-Org/kilocode/pull/3750) [`02832d7`](https://github.com/Kilo-Org/kilocode/commit/02832d70ab51b4bacd9608e8bdad271ccec9eddb) Thanks [@jrf0110](https://github.com/jrf0110)! - Fixes a bug where managed code indexing would not start due to mismatching org schemas.

- [#3772](https://github.com/Kilo-Org/kilocode/pull/3772) [`5c5d207`](https://github.com/Kilo-Org/kilocode/commit/5c5d207c586af1bb5e5a0d97146e1e0e64db181c) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Prevent duplicate tool results when native tool calling is enabled

- [#3754](https://github.com/Kilo-Org/kilocode/pull/3754) [`47b921b`](https://github.com/Kilo-Org/kilocode/commit/47b921b07768a1e6712b74c013222eac28ce0e6b) Thanks [@mcowger](https://github.com/mcowger)! - Synthetic provider now uses JSON tool calls by default

## [v4.119.2]

- [#3740](https://github.com/Kilo-Org/kilocode/pull/3740) [`61c6c9a`](https://github.com/Kilo-Org/kilocode/commit/61c6c9abf2b81f2eedf29aec074c1028abdee0ad) Thanks [@jrf0110](https://github.com/jrf0110)! - Managed codebase indexing is a new experimental feature that should be disabled by default. It is disabled on the backend, but the extension defaults to true. This change disables the feature by default.

- [#3711](https://github.com/Kilo-Org/kilocode/pull/3711) [`097b1e3`](https://github.com/Kilo-Org/kilocode/commit/097b1e3fbaf04c7859c6c07a5bbf64b911b50d55) Thanks [@CyberRookie-X](https://github.com/CyberRookie-X)! - Add doubao-seed-code model to Doubao provider

- [#3734](https://github.com/Kilo-Org/kilocode/pull/3734) [`2a6c171`](https://github.com/Kilo-Org/kilocode/commit/2a6c171db108609f778e422cbd6b772ddcc55ad4) Thanks [@ctsstc](https://github.com/ctsstc)! - Add model Kimi K2 Thinking to Fireworks provider

- [#3724](https://github.com/Kilo-Org/kilocode/pull/3724) [`85731fb`](https://github.com/Kilo-Org/kilocode/commit/85731fb6c22cab6bbfccf0b11e42ddd3d7b72aa4) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix duplicated MiniMax settings

## [v4.119.1]

- [#3479](https://github.com/Kilo-Org/kilocode/pull/3479) [`499bf1a`](https://github.com/Kilo-Org/kilocode/commit/499bf1a52dcbfbd4e3d5f96cee00d672fbda021c) Thanks [@jrf0110](https://github.com/jrf0110)! - Introduces the managed codebase indexing feature for Kilo Code Teams and Enterprise organizations. This feature is currently gated to internal customers only. Managed codebase indexing is a branch-aware indexing and search product that does not require any configuration (as opposed to the current codebase indexing feature which relies on a local qdrant instance and configurating an embedding provider).

- [#3733](https://github.com/Kilo-Org/kilocode/pull/3733) [`5e1f809`](https://github.com/Kilo-Org/kilocode/commit/5e1f809a67d9e11402f422ed70f9b8bdf1717720) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Reduce failure rate of the apply diff tool when native tool calls are used

## [v4.119.0]

- [#3498](https://github.com/Kilo-Org/kilocode/pull/3498) [`10fe57d`](https://github.com/Kilo-Org/kilocode/commit/10fe57dab94217c80ed03835ed71162d8a64c91e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Include changes from Roo Code v3.29.0-v3.30.0

    - Add token-budget based file reading with intelligent preview to avoid context overruns (thanks @daniel-lxs!)
    - Fix: Respect nested .gitignore files in search_files (#7921 by @hannesrudolph, PR by @daniel-lxs)
    - Fix: Preserve trailing newlines in stripLineNumbers for apply_diff (#8020 by @liyi3c, PR by @app/roomote)
    - Fix: Exclude max tokens field for models that don't support it in export (#7944 by @hannesrudolph, PR by @elianiva)
    - Retry API requests on stream failures instead of aborting task (thanks @daniel-lxs!)
    - Improve auto-approve button responsiveness (thanks @daniel-lxs!)
    - Add checkpoint initialization timeout settings and fix checkpoint timeout warnings (#7843 by @NaccOll, PR by @NaccOll)
    - Always show checkpoint restore options regardless of change detection (thanks @daniel-lxs!)
    - Improve checkpoint menu translations (thanks @daniel-lxs!)
    - Update Mistral Medium model name (#8362 by @ThomsenDrake, PR by @ThomsenDrake)
    - Remove GPT-5 instructions/reasoning_summary from UI message metadata to prevent ui_messages.json bloat (thanks @hannesrudolph!)
    - Normalize docs-extractor audience tags; remove admin/stakeholder; strip tool invocations (thanks @hannesrudolph!)
    - Try 5s status mutation timeout (thanks @cte!)
    - Fix: Clean up max output token calculations to prevent context window overruns (#8821 by @enerage, PR by @roomote)
    - Fix: Change Add to Context keybinding to avoid Redo conflict (#8652 by @swythan, PR by @roomote)
    - Fix provider model loading race conditions (thanks @mrubens!)
    - Fix: Remove specific Claude model version from settings descriptions to avoid outdated references (#8435 by @rwydaegh, PR by @roomote)
    - Fix: Ensure free models don't display pricing information in the UI (thanks @mrubens!)
    - Add reasoning support for Z.ai GLM binary thinking mode (#8465 by @BeWater799, PR by @daniel-lxs)
    - Add settings to configure time and cost display in system prompt (#8450 by @jaxnb, PR by @roomote)
    - Fix: Use max_output_tokens when available in LiteLLM fetcher (#8454 by @fabb, PR by @roomote)
    - Fix: Process queued messages after context condensing completes (#8477 by @JosXa, PR by @roomote)
    - Fix: Resolve checkpoint menu popover overflow (thanks @daniel-lxs!)
    - Fix: LiteLLM test failures after merge (thanks @daniel-lxs!)
    - Improve UX: Focus textbox and add newlines after adding to context (thanks @mrubens!)
    - Fix: prevent infinite loop when canceling during auto-retry (#8901 by @mini2s, PR by @app/roomote)
    - Fix: Enhanced codebase index recovery and reuse ('Start Indexing' button now reuses existing Qdrant index) (#8129 by @jaroslaw-weber, PR by @heyseth)
    - Fix: make code index initialization non-blocking at activation (#8777 by @cjlawson02, PR by @daniel-lxs)
    - Fix: remove search_and_replace tool from codebase (#8891 by @hannesrudolph, PR by @app/roomote)
    - Fix: custom modes under custom path not showing (#8122 by @hannesrudolph, PR by @elianiva)
    - Fix: prevent MCP server restart when toggling tool permissions (#8231 by @hannesrudolph, PR by @heyseth)
    - Fix: truncate type definition to match max read line (#8149 by @chenxluo, PR by @elianiva)
    - Fix: auto-sync enableReasoningEffort with reasoning dropdown selection (thanks @daniel-lxs!)
    - Prevent a noisy cloud agent exception (thanks @cte!)
    - Feat: improve @ file search for large projects (#5721 by @Naituw, PR by @daniel-lxs)
    - Feat: rename MCP Errors tab to Logs for mixed-level messages (#8893 by @hannesrudolph, PR by @app/roomote)
    - docs(vscode-lm): clarify VS Code LM API integration warning (thanks @hannesrudolph!)
    - Fix: Resolve Qdrant codebase_search error by adding keyword index for type field (#8963 by @rossdonald, PR by @app/roomote)
    - Fix cost and token tracking between provider styles to ensure accurate usage metrics (thanks @mrubens!)
    - Feat: Add OpenRouter embedding provider support (#8972 by @dmarkey, PR by @dmarkey)
    - Feat: Add GLM-4.6 model to Fireworks provider (#8752 by @mmealman, PR by @app/roomote)
    - Feat: Add MiniMax M2 model to Fireworks provider (#8961 by @dmarkey, PR by @app/roomote)
    - Feat: Add preserveReasoning flag to include reasoning in API history (thanks @daniel-lxs!)
    - Fix: Prevent message loss during queue drain race condition (#8536 by @hannesrudolph, PR by @daniel-lxs)
    - Fix: Capture the reasoning content in base-openai-compatible for GLM 4.6 (thanks @mrubens!)
    - Fix: Create new Requesty profile during OAuth (thanks @Thibault00!)
    - Fix: Cleanup terminal settings tab and change default terminal to inline (thanks @hannesrudolph!)

- [#3643](https://github.com/Kilo-Org/kilocode/pull/3643) [`89d5135`](https://github.com/Kilo-Org/kilocode/commit/89d513569481ed1a6c1cfb5f7cd049dc8276a72c) Thanks [@iscekic](https://github.com/iscekic)! - add smart yolo mode

### Patch Changes

- [#3659](https://github.com/Kilo-Org/kilocode/pull/3659) [`44732df`](https://github.com/Kilo-Org/kilocode/commit/44732dff31b4d3737203548ac4022eccfd21e354) Thanks [@Maosghoul](https://github.com/Maosghoul)! - MiniMax M2 now uses JSON-style tools by default

- [#3653](https://github.com/Kilo-Org/kilocode/pull/3653) [`c79efb1`](https://github.com/Kilo-Org/kilocode/commit/c79efb1b19399ef0572d10829843732e08cd08e8) Thanks [@ctsstc](https://github.com/ctsstc)! - Added GLM 4.6 to Fireworks provider

- [#3693](https://github.com/Kilo-Org/kilocode/pull/3693) [`825e7c4`](https://github.com/Kilo-Org/kilocode/commit/825e7c41f9ceeb3abcc7b1fa68a586c9f1cad384) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix API error when returning from subtask with native tool calls enabled

- [#3680](https://github.com/Kilo-Org/kilocode/pull/3680) [`fc76487`](https://github.com/Kilo-Org/kilocode/commit/fc7648749bacc2f4e1b4988af3011b399b392027) Thanks [@markijbema](https://github.com/markijbema)! - Dont show autocomplete suggestions which aren't useful

## [v4.118.0]

- [#3638](https://github.com/Kilo-Org/kilocode/pull/3638) [`49e44fc`](https://github.com/Kilo-Org/kilocode/commit/49e44fc1c3c02648a534f737c6df0d7d4964810c) Thanks [@mcowger](https://github.com/mcowger)! - Enable Moonshot for native tool calling

- [#3295](https://github.com/Kilo-Org/kilocode/pull/3295) [`5a155a9`](https://github.com/Kilo-Org/kilocode/commit/5a155a9825e20f10bfc752baff37cd5de53980b2) Thanks [@Maosghoul](https://github.com/Maosghoul)! - MiniMax provider added. MiniMax provider preserves reasoning blocks and has experimental support for native tool calling.

- [#3632](https://github.com/Kilo-Org/kilocode/pull/3632) [`d7fad58`](https://github.com/Kilo-Org/kilocode/commit/d7fad58673da95de682bf5d7f38a90a288daae03) Thanks [@iscekic](https://github.com/iscekic)! - Introduces "YOLO" mode, where all approval requests are automatically approved. Initially used for `--auto` mode in the CLI, now available in the extension as well in `Settings > Auto-Approval`.

- [#3605](https://github.com/Kilo-Org/kilocode/pull/3605) [`03fccd3`](https://github.com/Kilo-Org/kilocode/commit/03fccd3a3c75186c320aad3754547bf1619cf424) Thanks [@viktorxhzj](https://github.com/viktorxhzj)! - OpenRouter and Kilo Gateway providers now preserve reasoning blocks between API requests. This should improve performance of reasoning models, especially MiniMax M2.

- [#3597](https://github.com/Kilo-Org/kilocode/pull/3597) [`ea3c0bd`](https://github.com/Kilo-Org/kilocode/commit/ea3c0bda8055f3ad3370c5794803ae176fefadd4) Thanks [@mcowger](https://github.com/mcowger)! - Add Kimi K2 Thinking to Moonshot.ai provider.

### Patch Changes

- [#3500](https://github.com/Kilo-Org/kilocode/pull/3500) [`2e1a536`](https://github.com/Kilo-Org/kilocode/commit/2e1a53678fc1c331d98a63f0ab15b02b53fc1625) Thanks [@iscekic](https://github.com/iscekic)! - improves windows support

- [#3629](https://github.com/Kilo-Org/kilocode/pull/3629) [`fefc671`](https://github.com/Kilo-Org/kilocode/commit/fefc671535bbfb1036c7088219d45e45d00cbad1) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Anthropic provider now preserves reasoning blocks and has (experimental) support for native (JSON-style) tool calls. This greatly improves support for Claude Haiku 4.5

- [#3612](https://github.com/Kilo-Org/kilocode/pull/3612) [`970e799`](https://github.com/Kilo-Org/kilocode/commit/970e799473111922eee13d859fd29cb3f7abf715) Thanks [@burkostya](https://github.com/burkostya)! - fix(native-tools): Make read_file_multi pattern JSON Schema compliant

## [v4.117.0]

- [#3568](https://github.com/Kilo-Org/kilocode/pull/3568) [`18dfc86`](https://github.com/Kilo-Org/kilocode/commit/18dfc86e5f00e0d722f448450574ec444d3c894a) Thanks [@mcowger](https://github.com/mcowger)! - Add Kimi K2-Thinking to Synthetic Provider

## [v4.116.1]

- [#3533](https://github.com/Kilo-Org/kilocode/pull/3533) [`f5bb82d`](https://github.com/Kilo-Org/kilocode/commit/f5bb82ddf4038ed2d9e5a1266c9e6b0dc09c0af5) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix hang at startup

## [v4.116.0]

- [#3288](https://github.com/Kilo-Org/kilocode/pull/3288) [`afeca17`](https://github.com/Kilo-Org/kilocode/commit/afeca176f4ef7d227831715b5e5a672fcf3fe58f) Thanks [@mcowger](https://github.com/mcowger)! - Add Native MCP Support for JSON Tool Calling

### Patch Changes

- [#3471](https://github.com/Kilo-Org/kilocode/pull/3471) [`9895a95`](https://github.com/Kilo-Org/kilocode/commit/9895a959b9bb8a14aab6ec11267a2bb0e12fb78c) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Allow native tool calling fro Qwen Code provider

- [#3513](https://github.com/Kilo-Org/kilocode/pull/3513) [`ff2e459`](https://github.com/Kilo-Org/kilocode/commit/ff2e4595777683265559f81f82dd9cbb0dc2e9f3) Thanks [@markijbema](https://github.com/markijbema)! - Prevent autocomplete from suggesting duplicating the previous or next line

- [#3523](https://github.com/Kilo-Org/kilocode/pull/3523) [`ba5416a`](https://github.com/Kilo-Org/kilocode/commit/ba5416ae3083fb5225ed7e9f0e1018203e611b84) Thanks [@markijbema](https://github.com/markijbema)! - Removed the gutter animation for autocomplete

- [#2893](https://github.com/Kilo-Org/kilocode/pull/2893) [`37d8493`](https://github.com/Kilo-Org/kilocode/commit/37d8493a4d2629d0498f089b40f850ddae0c91fc) Thanks [@ivanarifin](https://github.com/ivanarifin)! - fix(virtual-quota): display active model in UI for the frontend

    When the backend switches the model, it now sends out a "model has changed" signal by emitting event.
    The main application logic catches this signal and immediately tells the user interface to refresh itself.
    The user interface then updates the display to show the name of the new, currently active model.
    This will also keep the backend and the frontend active model in sync

## [v4.115.0]

- [#3486](https://github.com/Kilo-Org/kilocode/pull/3486) [`2b89d84`](https://github.com/Kilo-Org/kilocode/commit/2b89d8472123e48db866e10a88b5b6160812d73e) Thanks [@markijbema](https://github.com/markijbema)! - Show MCP tool instead of server name when asked to approve a tool

- [#3466](https://github.com/Kilo-Org/kilocode/pull/3466) [`e623ce1`](https://github.com/Kilo-Org/kilocode/commit/e623ce146bbad7453355ee84a4b4bb2fc894b031) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Thanks @pranjaldatta! Added support for Inception as a provider

- [#2435](https://github.com/Kilo-Org/kilocode/pull/2435) [`c13fe3c`](https://github.com/Kilo-Org/kilocode/commit/c13fe3c634496b9e1fc08371822a4071407ff9bc) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Auto Cleanup automatically manages your task history by removing old tasks to free up disk space and improve performance - https://kilo.ai/docs/advanced-usage/auto-cleanup

### Patch Changes

- [#3428](https://github.com/Kilo-Org/kilocode/pull/3428) [`b3c0e10`](https://github.com/Kilo-Org/kilocode/commit/b3c0e102cad5e48fe1389dc55a287dfc0072ed33) Thanks [@markijbema](https://github.com/markijbema)! - Do less requests for autocomplete when no completion could be found

- [#3502](https://github.com/Kilo-Org/kilocode/pull/3502) [`94552b8`](https://github.com/Kilo-Org/kilocode/commit/94552b8704efa80a9f7aee8ad601a3f291ffe7f2) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Revert orphaned partial ask messages fix

## [v4.114.1]

- [#3188](https://github.com/Kilo-Org/kilocode/pull/3188) [`131fa0e`](https://github.com/Kilo-Org/kilocode/commit/131fa0ee68d6f47172a968489129071a7da88de3) Thanks [@NikoDi2000](https://github.com/NikoDi2000)! - Add missing enable/disable word wrap tooltips

- [#3357](https://github.com/Kilo-Org/kilocode/pull/3357) [`d2bb122`](https://github.com/Kilo-Org/kilocode/commit/d2bb122a8b0e80044a66fe141de39489f7098bb5) Thanks [@mollux](https://github.com/mollux)! - Now only available MCP server capabilities are fetched

- [#2817](https://github.com/Kilo-Org/kilocode/pull/2817) [`0da1bc7`](https://github.com/Kilo-Org/kilocode/commit/0da1bc772a700874f8ec3fbad039fed1ea4d89dc) Thanks [@dennismeister93](https://github.com/dennismeister93)! - Updated MCP SDK to 1.13.3

- [#2849](https://github.com/Kilo-Org/kilocode/pull/2849) [`642cec5`](https://github.com/Kilo-Org/kilocode/commit/642cec502c9fecd297dce8cb1cc708ad3e9c7d12) Thanks [@Ralph-Abejuela](https://github.com/Ralph-Abejuela)! - Added option to start rate limiting after the API stream ends

- [#3468](https://github.com/Kilo-Org/kilocode/pull/3468) [`8f8ef10`](https://github.com/Kilo-Org/kilocode/commit/8f8ef107dd2751e4141473d33e098d6f28faa6d1) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Resolve orphaned partial ask messages

- [#3213](https://github.com/Kilo-Org/kilocode/pull/3213) [`7238628`](https://github.com/Kilo-Org/kilocode/commit/7238628bc24058eb352ff231090c08d99a8a8961) Thanks [@siulong](https://github.com/siulong)! - Fixed the GitHub feedback link at the bottom of the marketplace not being clickable.

## [v4.114.0]

- [#3435](https://github.com/Kilo-Org/kilocode/pull/3435) [`bd4f19d`](https://github.com/Kilo-Org/kilocode/commit/bd4f19da040462b6477087d76cffe1006ef8d444) Thanks [@markijbema](https://github.com/markijbema)! - Cmd-L now directly inserts instead of showing as ghost text

### Patch Changes

- [#3435](https://github.com/Kilo-Org/kilocode/pull/3435) [`7f018d8`](https://github.com/Kilo-Org/kilocode/commit/7f018d8428a994c6ada6ecbda95a75336150946b) Thanks [@markijbema](https://github.com/markijbema)! - Minor improvements to autocomplete internal state handling

- [#3379](https://github.com/Kilo-Org/kilocode/pull/3379) [`9c7b99c`](https://github.com/Kilo-Org/kilocode/commit/9c7b99c716d92deabc49ec07f5771c03b3507b2c) Thanks [@TsFreddie](https://github.com/TsFreddie)! - Update pricing for DeepSeek V3.2

- [#3342](https://github.com/Kilo-Org/kilocode/pull/3342) [`8827792`](https://github.com/Kilo-Org/kilocode/commit/88277927f69e1baae6f61f0e76f3a43862abd31e) Thanks [@mcowger](https://github.com/mcowger)! - Improved messaging when VS Code LM is unavailable

- [#3437](https://github.com/Kilo-Org/kilocode/pull/3437) [`829f052`](https://github.com/Kilo-Org/kilocode/commit/829f052d199ef80136713922ce70230048dde6e0) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Add zai-glm-4.6 model to Cerebras and set gpt-oss-120b as default (thanks Roo)

- [#3411](https://github.com/Kilo-Org/kilocode/pull/3411) [`2dc2a32`](https://github.com/Kilo-Org/kilocode/commit/2dc2a32d9db54cfe3908263eb5f594c99058dde5) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Fix @ mentions when editing messages

## [v4.113.1]

- [#3408](https://github.com/Kilo-Org/kilocode/pull/3408) [`5aee3ad`](https://github.com/Kilo-Org/kilocode/commit/5aee3ad6ee200eefd5dd12933ba650989ccc0857) Thanks [@brianc](https://github.com/brianc)! - Fix auto-complete indicator. It now hides properly if the autocomplete request errors in the background.

## [v4.113.0]

- [#3382](https://github.com/Kilo-Org/kilocode/pull/3382) [`98c4d89`](https://github.com/Kilo-Org/kilocode/commit/98c4d89f414394de0b5ab579e9216c860b4a1d30) Thanks [@hassoncs](https://github.com/hassoncs)! - Add descriptions to the MCP and modes marketplace headers

- [#2442](https://github.com/Kilo-Org/kilocode/pull/2442) [`34b04ae`](https://github.com/Kilo-Org/kilocode/commit/34b04ae0c5763757c41bfbd3132aed3a67d2ac7a) Thanks [@hassoncs](https://github.com/hassoncs)! - Added AI powered commit message generation to Jetbrains IDEs

### Patch Changes

- [#3373](https://github.com/Kilo-Org/kilocode/pull/3373) [`3cb7d20`](https://github.com/Kilo-Org/kilocode/commit/3cb7d20fc79707f901c8429c971ed86500b0b527) Thanks [@markijbema](https://github.com/markijbema)! - Fix: restored cmd-l functionality

## [v4.112.1]

- [#3375](https://github.com/Kilo-Org/kilocode/pull/3375) [`52d39dd`](https://github.com/Kilo-Org/kilocode/commit/52d39ddaadf3b3ce8388db02078b004b6573e6da) Thanks [@RSO](https://github.com/RSO)! - Fixed autocomplete enabling/disabling

## [v4.112.0]

- [#3346](https://github.com/Kilo-Org/kilocode/pull/3346) [`5d82884`](https://github.com/Kilo-Org/kilocode/commit/5d828842b502b6accd2e0423db99ef8bdc0dbf33) Thanks [@mcowger](https://github.com/mcowger)! - Fixed Anthropic models not working on Google Vertex Global

## [v4.111.2]

- [#3363](https://github.com/Kilo-Org/kilocode/pull/3363) [`233334c`](https://github.com/Kilo-Org/kilocode/commit/233334cd284477290b67359add7e0f703d8707b7) Thanks [@markijbema](https://github.com/markijbema)! - Various improvements to the autocomplete functionality

## [v4.111.1]

- [#3282](https://github.com/Kilo-Org/kilocode/pull/3282) [`ed4399b`](https://github.com/Kilo-Org/kilocode/commit/ed4399b7d82d735895fbf4d85cfaefff5002571a) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improved handling of tool calls in the API conversation history

- [#3270](https://github.com/Kilo-Org/kilocode/pull/3270) [`2b35053`](https://github.com/Kilo-Org/kilocode/commit/2b350530367bb0a14a0fdc7c11a030c2943c6cf6) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Claude Haiku 4.5 now uses a simplified read file tool for reduced error rate

## [v4.111.0]

- [#3256](https://github.com/Kilo-Org/kilocode/pull/3256) [`f81b48b`](https://github.com/Kilo-Org/kilocode/commit/f81b48b8dec9cd276c3c7ba994d0512036abfa96) Thanks [@markijbema](https://github.com/markijbema)! - Switched autocomplete to showing completions inline

### Patch Changes

- [#3261](https://github.com/Kilo-Org/kilocode/pull/3261) [`bae048f`](https://github.com/Kilo-Org/kilocode/commit/bae048f914712439e54f29363d52dc24860000e7) Thanks [@mcowger](https://github.com/mcowger)! - Improve native tool calling consistency

- [#3281](https://github.com/Kilo-Org/kilocode/pull/3281) [`2586e9b`](https://github.com/Kilo-Org/kilocode/commit/2586e9b4f6cbea9734ff10df7086f2d999713448) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix broken sign-in links

- [#3313](https://github.com/Kilo-Org/kilocode/pull/3313) [`2e61e91`](https://github.com/Kilo-Org/kilocode/commit/2e61e9152ae3be43ce12e9fd3c2f94c0d603d771) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Running commands are no longer sometimes shown twice in the chat

## [v4.110.0]

### Patch Changes

- [#3249](https://github.com/Kilo-Org/kilocode/pull/3249) [`ccee64c`](https://github.com/Kilo-Org/kilocode/commit/ccee64cf1676f51a6b9dae49aad994d9f834b3e8) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Remove credit status bar until we can retrieve the up to date balance from the proxy response.

- [#3235](https://github.com/Kilo-Org/kilocode/pull/3235) [`0108896`](https://github.com/Kilo-Org/kilocode/commit/010889619121159a8993ad5846ac2cccecd91bd8) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed some "not a function" crashes

- [#3226](https://github.com/Kilo-Org/kilocode/pull/3226) [`e13a99c`](https://github.com/Kilo-Org/kilocode/commit/e13a99c67bd644e7ab9372757227aab3f72da1d4) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Reverted "Update base URL for Vertex Anthropic models to work around outdated library." because it is causing issues for some users.

- [#2663](https://github.com/Kilo-Org/kilocode/pull/2663) [`43140c9`](https://github.com/Kilo-Org/kilocode/commit/43140c950719d9718c089e45f9ae63b334dd9a6e) Thanks [@NaccOll](https://github.com/NaccOll)! - Fix listCodeDefinitionNamesTool for annotated Java methods

- [#3242](https://github.com/Kilo-Org/kilocode/pull/3242) [`8604c83`](https://github.com/Kilo-Org/kilocode/commit/8604c838b205eaa1bdf510b8b64083a8c9c15377) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improved support for HTTP proxy environment variables

## [v4.109.2]

- [#3216](https://github.com/Kilo-Org/kilocode/pull/3216) [`3f34635`](https://github.com/Kilo-Org/kilocode/commit/3f3463554f7cf016db9b2851c40217e38a048840) Thanks [@markijbema](https://github.com/markijbema)! - Do not accept an autocomplete suggestion with shift-tab or ctrl-tab (only plain tab)

- [#3214](https://github.com/Kilo-Org/kilocode/pull/3214) [`b271af9`](https://github.com/Kilo-Org/kilocode/commit/b271af9c51da9a8f6ec3a6f4caf78ff18db9b3a8) Thanks [@mcowger](https://github.com/mcowger)! - Update Synthetic Provider to support GLM 4.6, and enable native tool calling

- [#3199](https://github.com/Kilo-Org/kilocode/pull/3199) [`14bbc5f`](https://github.com/Kilo-Org/kilocode/commit/14bbc5f9b5a61cbf2016c7b6a784fdc546fa6a0e) Thanks [@possible055](https://github.com/possible055)! - Improve Chinese translation of autocomplete-related terms

## [v4.109.1]

- [#3203](https://github.com/Kilo-Org/kilocode/pull/3203) [`aeb8bf3`](https://github.com/Kilo-Org/kilocode/commit/aeb8bf37df44532517db96511e3f0f85861f55b8) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fix Z.ai provider giving an Unauthorized error

## [v4.109.0]

- [#3088](https://github.com/Kilo-Org/kilocode/pull/3088) [`84a1fa3`](https://github.com/Kilo-Org/kilocode/commit/84a1fa3f84eac42fa76da9be09270cdb57b19b34) Thanks [@mcowger](https://github.com/mcowger)! - Update base URL for Vertex Anthropic models to work around outdated library.

- [#3192](https://github.com/Kilo-Org/kilocode/pull/3192) [`7015c23`](https://github.com/Kilo-Org/kilocode/commit/7015c2367c0ddf45d40b4adf96386f3ca5005bc1) Thanks [@markijbema](https://github.com/markijbema)! - Fix bug: autocomplete no longer suggests strange XML

### Patch Changes

- [#3159](https://github.com/Kilo-Org/kilocode/pull/3159) [`935bbae`](https://github.com/Kilo-Org/kilocode/commit/935bbae3a080c8475671b97440eacf2ead939198) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.28.18

    - Fix: Remove request content from UI messages to improve performance and reduce clutter (#5601 by @MuriloFP, #8594 by @multivac2x, #8690 by @hannesrudolph, PR by @mrubens)
    - Fix: Add userAgent to Bedrock client for version tracking (#8660 by @ajjuaire, PR by @app/roomote)
    - Feat: Z AI now uses only two coding endpoints for better performance (#8687 by @hannesrudolph)
    - Feat: Update image generation model selection for improved quality (thanks @chrarnoldus!)

- [#3194](https://github.com/Kilo-Org/kilocode/pull/3194) [`b566965`](https://github.com/Kilo-Org/kilocode/commit/b56696581e82652086564503f7743e9e82585823) Thanks [@markijbema](https://github.com/markijbema)! - Do not trigger autocomplete for external events, like git changes

- [#3100](https://github.com/Kilo-Org/kilocode/pull/3100) [`3e409b8`](https://github.com/Kilo-Org/kilocode/commit/3e409b84310f481d1c3be4095d887f5cf6d15282) Thanks [@markijbema](https://github.com/markijbema)! - Added Amazon Bedrock as a provider for autocomplete

- [#3149](https://github.com/Kilo-Org/kilocode/pull/3149) [`79c7d60`](https://github.com/Kilo-Org/kilocode/commit/79c7d60a10a765da8195fde80e6a89630993b918) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains - Update framework (Plugin now requires IntelliJ IDEA 2024.3 or later)

- [#3195](https://github.com/Kilo-Org/kilocode/pull/3195) [`93371d0`](https://github.com/Kilo-Org/kilocode/commit/93371d08f1c1b88eeb9f567af9ae74188fe7e379) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed crash when browser tool is used with native tool calling enabled

## [v4.108.0]

- [#2674](https://github.com/Kilo-Org/kilocode/pull/2674) [`2836aed`](https://github.com/Kilo-Org/kilocode/commit/2836aeddbbd6884f2c6f2421ca79387c25f5cd94) Thanks [@mcowger](https://github.com/mcowger)! - add send message on enter setting with configurable behavior

- [#3090](https://github.com/Kilo-Org/kilocode/pull/3090) [`261889f`](https://github.com/Kilo-Org/kilocode/commit/261889f1d4fa853aea0ddb261856b6d4c63e1159) Thanks [@mcowger](https://github.com/mcowger)! - Allow the use of native function calling for OpenAI-compatible, LM Studio, Chutes, DeepInfra, xAI and Z.ai providers.

### Patch Changes

- [#3155](https://github.com/Kilo-Org/kilocode/pull/3155) [`6242b03`](https://github.com/Kilo-Org/kilocode/commit/6242b03e9fb58eff8da9f637fa448b35aeaae3a3) Thanks [@NikoDi2000](https://github.com/NikoDi2000)! - Improved the Chinese translation of "run" from '命令' to '运行'

- [#3120](https://github.com/Kilo-Org/kilocode/pull/3120) [`ced4857`](https://github.com/Kilo-Org/kilocode/commit/ced48571894311e3350b9603071e5e2becc9473f) Thanks [@mcowger](https://github.com/mcowger)! - The apply_diff tool was implemented for experimental JSON-style tool calling

## [v4.107.0]

### Patch Changes

- [#3082](https://github.com/Kilo-Org/kilocode/pull/3082) [`d82e684`](https://github.com/Kilo-Org/kilocode/commit/d82e6842d423861d7c5725ebfdba491438b3302a) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The "Enable browser tool" setting is now honored when using experimental JSON style tool calls.

- [#3059](https://github.com/Kilo-Org/kilocode/pull/3059) [`d71f1d6`](https://github.com/Kilo-Org/kilocode/commit/d71f1d67e372fab1186ec07eda97c6d950338ec2) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix bug preventing the agent from editing files properly when git diff views are open

- [#3105](https://github.com/Kilo-Org/kilocode/pull/3105) [`b0c7475`](https://github.com/Kilo-Org/kilocode/commit/b0c7475a5f086171dbff162cbfa4761937617f27) Thanks [@metju90](https://github.com/metju90)! - Fix button styling on Let's Go CTA

- [#3107](https://github.com/Kilo-Org/kilocode/pull/3107) [`c58c4ac`](https://github.com/Kilo-Org/kilocode/commit/c58c4ac9bed8af1a9c18250e759ee4b93873f86b) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.28.16-v3.28.17

    - Fix: Update zh-TW run command title translation (thanks @PeterDaveHello!)
    - feat: Add Claude Sonnet 4.5 1M context window support for Claude Code (thanks @ColbySerpa!)

## [v4.106.0]

- [#2833](https://github.com/Kilo-Org/kilocode/pull/2833) [`0b8ef46`](https://github.com/Kilo-Org/kilocode/commit/0b8ef4632cab8cbf1da7a90a2f9b228861b41be8) Thanks [@mcowger](https://github.com/mcowger)! - (also thanks to @NaccOll for paving the way) - Preliminary support for native tool calling (a.k.a native function calling) was added.

    This feature is currently experimental and mostly intended for users interested in contributing to its development.
    It is so far only supported when using OpenRouter or Kilo Code providers. There are possible issues including, but not limited to:

    - Missing tools (e.g. apply_diff tool)
    - Tools calls not updating the UI until they are complete
    - Tools being used even though they are disabled (e.g. browser tool)
    - MCP servers not working
    - Errors specific to certain inference providers

    Native tool calling can be enabled in Providers Settings > Advanced Settings > Tool Call Style > JSON.
    It is enabled by default for Claude Haiku 4.5, because that model does not work at all otherwise.

- [#3050](https://github.com/Kilo-Org/kilocode/pull/3050) [`357d438`](https://github.com/Kilo-Org/kilocode/commit/357d4385c0a5e609a408c5842047c0e6593b8153) Thanks [@markijbema](https://github.com/markijbema)! - CMD-I now invokes the agent so you can give it more complex prompts

## [v4.105.0]

- [#3005](https://github.com/Kilo-Org/kilocode/pull/3005) [`b87ae9c`](https://github.com/Kilo-Org/kilocode/commit/b87ae9ca29ca632ec0d324dae469a75c8005e876) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Improve the edit chat area to allow context and file drag and drop when editing messages. Align more with upstream edit functionality

### Patch Changes

- [#2983](https://github.com/Kilo-Org/kilocode/pull/2983) [`93e8243`](https://github.com/Kilo-Org/kilocode/commit/93e8243686488ecf61476f854cd19eb67706f7cb) Thanks [@jrf0110](https://github.com/jrf0110)! - Adds project usage tracking for Teams and Enterprise customers. Organization members can view and filter usage by project. Project identifier is automatically inferred from `.git/config`. It can be overwritten by writing a `.kilocode/config.json` file with the following contents:

    ```json
    {
    	"project": {
    		"id": "my-project-id"
    	}
    }
    ```

- [#3057](https://github.com/Kilo-Org/kilocode/pull/3057) [`69f5a18`](https://github.com/Kilo-Org/kilocode/commit/69f5a182cf42361e659e94c95969e3bd3641176f) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Thanks Roo, support for Claude Haiku 4.5 to Anthropic, Bedrock and Vertex providers was added

- [#3046](https://github.com/Kilo-Org/kilocode/pull/3046) [`1bd934f`](https://github.com/Kilo-Org/kilocode/commit/1bd934f784034ec29d10ae7b42d67f768e0883b1) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - A warning is now shown when the webview memory usage crosses 90% of the limit (gray screen territory)

- [#2885](https://github.com/Kilo-Org/kilocode/pull/2885) [`a34dab0`](https://github.com/Kilo-Org/kilocode/commit/a34dab09d2cbcc9732698f21e824b6773b30fa2b) Thanks [@shameez-struggles-to-commit](https://github.com/shameez-struggles-to-commit)! - Update VS Code Language Model API provider metadata to reflect current model limits:

    - Align context windows, prompt/input limits, and max output tokens with the latest provider data for matching models: gpt-3.5-turbo, gpt-4o-mini, gpt-4, gpt-4-0125-preview, gpt-4o, o3-mini, claude-3.5-sonnet, claude-sonnet-4, gemini-2.0-flash-001, gemini-2.5-pro, o4-mini-2025-04-16, gpt-4.1, gpt-5-mini, gpt-5.
    - Fixes an issue where a default 128k context was assumed for all models.
    - Notable: GPT-5 family now uses 264k context; o3-mini/o4-mini, Gemini, Claude, and 4o families have updated output and image support flags. GPT-5-mini max output explicitly set to 127,805.

    This ensures Kilo Code correctly enforces model token budgets with the VS Code LM integration.

## [v4.104.0]

- [#2673](https://github.com/Kilo-Org/kilocode/pull/2673) [`cf1aca2`](https://github.com/Kilo-Org/kilocode/commit/cf1aca2fb6c0f16414d42737a4ebf90357f5a796) Thanks [@mcowger](https://github.com/mcowger)! - Update Gemini provider to support dynamic model retrieval.

- [#2749](https://github.com/Kilo-Org/kilocode/pull/2749) [`7e493ec`](https://github.com/Kilo-Org/kilocode/commit/7e493ec35c01687b78cb2fb54b3f92c6b42662aa) Thanks [@mcowger](https://github.com/mcowger)! - Improved OpenAI compatible parser's ability to yield reasoning content

## [v4.103.1]

- [#2962](https://github.com/Kilo-Org/kilocode/pull/2962) [`a424824`](https://github.com/Kilo-Org/kilocode/commit/a424824269b3cafdf58bcdb1acf7ed6151f32e0b) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improved the error message when an unsupported reasoning effort value is chosen

- [#2960](https://github.com/Kilo-Org/kilocode/pull/2960) [`254e21b`](https://github.com/Kilo-Org/kilocode/commit/254e21b29df46dab3048ecd792625eadc20beafb) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The reasoning effort setting is no longer ignored for GLM 4.6 when using the Kilo Code or OpenRouter providers. Some inference providers on OpenRouter have trouble when reasoning is enabled, but this is now less of a problem, because more providers have come online. Most providers do not expose reasoning tokens for GLM 4.6, regardless of reasoning effort.

## [v4.103.0]

- [#2528](https://github.com/Kilo-Org/kilocode/pull/2528) [`14d5060`](https://github.com/Kilo-Org/kilocode/commit/14d506025a9374f54409768629fc4ebd57f8f628) Thanks [@mcowger](https://github.com/mcowger)! - Add timestamps to Chat view.

### Patch Changes

- [#2861](https://github.com/Kilo-Org/kilocode/pull/2861) [`279d7cf`](https://github.com/Kilo-Org/kilocode/commit/279d7cff9d19ec908681318fbe929b45fbf94393) Thanks [@jrf0110](https://github.com/jrf0110)! - Organization modes selection. This feature allows organizations to create
  new modes and send them to the KiloCode extension. It also allows for
  overwriting Kilo Code's built-in modes. Organization modes are readonly
  from the extension and must be edited from the dashboard.

- [#2858](https://github.com/Kilo-Org/kilocode/pull/2858) [`154722b`](https://github.com/Kilo-Org/kilocode/commit/154722be5a73143231e95ccbc2679b8a4eaaa5ab) Thanks [@hassoncs](https://github.com/hassoncs)! - Make all text-based links the same visual style

## [v4.102.0]

- [#2854](https://github.com/Kilo-Org/kilocode/pull/2854) [`bd5d7fc`](https://github.com/Kilo-Org/kilocode/commit/bd5d7fc5f0c67ac2b040dbdefbd90d0396e0b60e) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.28.14-v3.28.15

    - Fix: properly reset cost limit tracking when user clicks "Reset and Continue" (#6889 by @alecoot, PR by app/roomote)
    - Fix: improve save button activation in prompts settings (#5780 by @beccare, PR by app/roomote)
    - Fix: overeager 'there are unsaved changes' dialog in settings (thanks @brunobergher!)
    - Fix: Claude Sonnet 4.5 compatibility improvements (thanks @mrubens!)
    - Remove unsupported Gemini 2.5 Flash Image Preview free model (thanks @SannidhyaSah!)

- [#1652](https://github.com/Kilo-Org/kilocode/pull/1652) [`b3caf38`](https://github.com/Kilo-Org/kilocode/commit/b3caf38e44f2f6ccd58f3e92cd68edce48a96844) Thanks [@hassoncs](https://github.com/hassoncs)! - Add a display setting that hides costs below a user-defined threshold

### Patch Changes

- [#2871](https://github.com/Kilo-Org/kilocode/pull/2871) [`0403f82`](https://github.com/Kilo-Org/kilocode/commit/0403f820a8413656eecbe3bbfe252a52c2999e37) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improved Fast Apply error messages

- [#2851](https://github.com/Kilo-Org/kilocode/pull/2851) [`9e6a897`](https://github.com/Kilo-Org/kilocode/commit/9e6a89796f04f6215e31ac7950669783387a11de) Thanks [@eliasto](https://github.com/eliasto)! - Add custom base URL support to OVHcloud provider

- [#2870](https://github.com/Kilo-Org/kilocode/pull/2870) [`4730e08`](https://github.com/Kilo-Org/kilocode/commit/4730e080f99bcd414a3eb0a71a04ab5fd6dbcb6e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - A checkpoint is now created before _every_ tool call

## [v4.101.0]

- [#2518](https://github.com/Kilo-Org/kilocode/pull/2518) [`01106a8`](https://github.com/Kilo-Org/kilocode/commit/01106a8d35159ccea34e290a2174d44d83fecd64) Thanks [@eliasto](https://github.com/eliasto)! - OVHcloud AI Endpoints provider added

### Patch Changes

- [#2852](https://github.com/Kilo-Org/kilocode/pull/2852) [`a707e1d`](https://github.com/Kilo-Org/kilocode/commit/a707e1db5b4f8ee3ca80f259217f521a02ddbd50) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Autocomplete now honors .kilocodeignore

- [#2829](https://github.com/Kilo-Org/kilocode/pull/2829) [`75acbab`](https://github.com/Kilo-Org/kilocode/commit/75acbabd1f0d39488bc252e8559e39a4b8daed19) Thanks [@hassoncs](https://github.com/hassoncs)! - Potentially fix missing Kilo Code icon by removing 'when' condition from the extension's activitybar config

- [#2831](https://github.com/Kilo-Org/kilocode/pull/2831) [`9d457f0`](https://github.com/Kilo-Org/kilocode/commit/9d457f0bc3eef1c1f07eb80070e0ecf69355b38a) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - When using Kilo Code or OpenRouter, the inference provider used is now shown in a tooltip on "API Request"

## [v4.100.0]

- [#2787](https://github.com/Kilo-Org/kilocode/pull/2787) [`9c16d14`](https://github.com/Kilo-Org/kilocode/commit/9c16d14c4b8455041b16e5ffa0787014d5154d19) Thanks [@b3nw](https://github.com/b3nw)! - Chutes model list is now dynamically loaded

- [#2806](https://github.com/Kilo-Org/kilocode/pull/2806) [`5d1cda9`](https://github.com/Kilo-Org/kilocode/commit/5d1cda99a5c3872dae526db9b3c8cefbabe69de0) Thanks [@EamonNerbonne](https://github.com/EamonNerbonne)! - Removed the option to use custom provider for autocomplete.

    Using a custom provider defaults to using a your globally configured provider without any context-window cap, and using a custom provider with no further restrictions like that means that per-autocomplete request costs are sometimes extremely high and responses very slow.

- [#2790](https://github.com/Kilo-Org/kilocode/pull/2790) [`d0f6fa0`](https://github.com/Kilo-Org/kilocode/commit/d0f6fa0531e5abfb39f2e99c7a637ead54bfe8be) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Zero Data Retention can now be enabled for Kilo Code and OpenRouter under the Provider Routing settings.

- [#2567](https://github.com/Kilo-Org/kilocode/pull/2567) [`68ea97f`](https://github.com/Kilo-Org/kilocode/commit/68ea97fc02861e932cf0357d60d73a3204ed19ef) Thanks [@billycao](https://github.com/billycao)! - Add provider support for Synthetic (https://synthetic.new)

- [#2807](https://github.com/Kilo-Org/kilocode/pull/2807) [`3375470`](https://github.com/Kilo-Org/kilocode/commit/337547095ff64fbdd1294a22b19c7dd6b41e37bb) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The See All Changes button when a task completes is now accompanied by a Revert All Changes button to be able to easily revert all changes.

### Patch Changes

- [#2798](https://github.com/Kilo-Org/kilocode/pull/2798) [`bb3baca`](https://github.com/Kilo-Org/kilocode/commit/bb3baca433ce77419abd8d3f4814278a05f8c631) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The API Request timeout for Ollama and LM Studio is now configurable (VS Code Extensions panel -> Kilo Code gear menu -> Settings -> API Request Timeout)

## [v4.99.2]

- [#2729](https://github.com/Kilo-Org/kilocode/pull/2729) [`bda1ef4`](https://github.com/Kilo-Org/kilocode/commit/bda1ef4a6ece7532db4e07359cfae640b1080d3c) Thanks [@ivanarifin](https://github.com/ivanarifin)! - Update the environment variables of Gemini CLI when OAuth path changes

- [#2755](https://github.com/Kilo-Org/kilocode/pull/2755) [`82ffeb4`](https://github.com/Kilo-Org/kilocode/commit/82ffeb4bcfbf1ff6b4cc50413e7dbc57fd82c7cd) Thanks [@b3nw](https://github.com/b3nw)! - Add zai-org/GLM-4.6-turbo model to Chutes provider

## [v4.99.1]

- [#2731](https://github.com/Kilo-Org/kilocode/pull/2731) [`36cf88f`](https://github.com/Kilo-Org/kilocode/commit/36cf88f868eee2a322b35b37032f98d199e0f91a) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - A recommendation to disable Editing Through Diffs or Fast Apply is now included in the error message when a model fails to use them properly

- [#2751](https://github.com/Kilo-Org/kilocode/pull/2751) [`6ebf0bb`](https://github.com/Kilo-Org/kilocode/commit/6ebf0bbe38be7d737546f8975cff927d95e85751) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed some untranslated text being shown in the Ollama settings

## [v4.99.0]

- [#2719](https://github.com/Kilo-Org/kilocode/pull/2719) [`345947f`](https://github.com/Kilo-Org/kilocode/commit/345947f29978045209a82687843c28059b339dc0) Thanks [@mcowger](https://github.com/mcowger)! - Prevent race conditions from stopping agent progress during indexing.

- [#2716](https://github.com/Kilo-Org/kilocode/pull/2716) [`41a6dbf`](https://github.com/Kilo-Org/kilocode/commit/41a6dbf1a54a699e358a24ecd167f692f3a2aef5) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.28.8-v3.28.13

    - Fix: Remove topP parameter from Bedrock inference config (#8377 by @ronyblum, PR by @daniel-lxs)
    - Fix: Correct Vertex AI Sonnet 4.5 model configuration (#8387 by @nickcatal, PR by @mrubens!)
    - Fix: Correct Anthropic Sonnet 4.5 model ID and add Bedrock 1M context checkbox (thanks @daniel-lxs!)
    - Fix: Correct AWS Bedrock Claude Sonnet 4.5 model identifier (#8371 by @sunhyung, PR by @app/roomote)
    - Fix: Correct Claude Sonnet 4.5 model ID format (thanks @daniel-lxs!)
    - Fix: Make chat icons properly sized with shrink-0 class (thanks @mrubens!)
    - The free Supernova model now has a 1M token context window (thanks @mrubens!)
    - Fix: Remove <thinking> tags from prompts for cleaner output and fewer tokens (#8318 by @hannesrudolph, PR by @app/roomote)
    - Correct tool use suggestion to improve model adherence to suggestion (thanks @hannesrudolph!)
    - Removing user hint when refreshing models (thanks @requesty-JohnCosta27!)
    - Fix: Resolve frequent "No tool used" errors by clarifying tool-use rules (thanks @hannesrudolph!)
    - Fix: Include initial ask in condense summarization (thanks @hannesrudolph!)

- [#2701](https://github.com/Kilo-Org/kilocode/pull/2701) [`0593631`](https://github.com/Kilo-Org/kilocode/commit/05936316c0bedfb62a0c1851dd4abfe1882fe3a4) Thanks [@mcowger](https://github.com/mcowger)! - Added additional supported models to the Fast Apply experimental feature for a total of three: Morph V3 Fast, Morph V3 Large and Relace Apply 3

### Patch Changes

- [#2656](https://github.com/Kilo-Org/kilocode/pull/2656) [`4e1b4ed`](https://github.com/Kilo-Org/kilocode/commit/4e1b4edb06ba3894bba86abd63853c167f1b4eb0) Thanks [@SnHaku](https://github.com/SnHaku)! - Fixed JetBrains PowerShell integration

- [#2725](https://github.com/Kilo-Org/kilocode/pull/2725) [`2ae6a7c`](https://github.com/Kilo-Org/kilocode/commit/2ae6a7c3a9531ad6418cc3858aa43f96fc849072) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed GLM 4.6 always getting stuck in loops with Kilo Code and OpenRouter providers

- [#2659](https://github.com/Kilo-Org/kilocode/pull/2659) [`318edd6`](https://github.com/Kilo-Org/kilocode/commit/318edd639b38f65dfdab0695f481322ea90ce2cc) Thanks [@akhil41](https://github.com/akhil41)! - Update Chutes AI provider model list

## [v4.98.2]

- [#2704](https://github.com/Kilo-Org/kilocode/pull/2704) [`6b6af0a`](https://github.com/Kilo-Org/kilocode/commit/6b6af0a2113cd106f08b1538172d5ba5d19a80ff) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed duplicated cost display

- [#2705](https://github.com/Kilo-Org/kilocode/pull/2705) [`e65557d`](https://github.com/Kilo-Org/kilocode/commit/e65557dcfb880f70c6d18a6f511454c234b70ee4) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Added "Command Timeout Allowlist" and "Prevent Completion with Open Todos" to Extension Settings.

- [#2707](https://github.com/Kilo-Org/kilocode/pull/2707) [`55ff2dc`](https://github.com/Kilo-Org/kilocode/commit/55ff2dcf6bccfcc9d70ba631ba57c99269ebe716) Thanks [@Ed4ward](https://github.com/Ed4ward)! - Added GLM 4.6 support to the Z.AI provider

## [v4.98.1]

- [#2695](https://github.com/Kilo-Org/kilocode/pull/2695) [`ab49c14`](https://github.com/Kilo-Org/kilocode/commit/ab49c141ca397a0af985341a1cfe907d586430ef) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add Claude 4.5 Sonnet to all supported providers (thanks Roo Code)

## [v4.98.0]

- [#2623](https://github.com/Kilo-Org/kilocode/pull/2623) [`da834dd`](https://github.com/Kilo-Org/kilocode/commit/da834ddcd24ee334ec97c1a5ca398b87d624adc0) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.28.2-v3.28.7

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

- [#2221](https://github.com/Kilo-Org/kilocode/pull/2221) [`bcb4c69`](https://github.com/Kilo-Org/kilocode/commit/bcb4c69f92c833e3c6cfc10d64b80077613386f1) Thanks [@Ffinnis](https://github.com/Ffinnis)! - Add ability to cancel code indexing process

### Patch Changes

- [#2665](https://github.com/Kilo-Org/kilocode/pull/2665) [`7b100d5`](https://github.com/Kilo-Org/kilocode/commit/7b100d5473e28aeafa832bcc3bbca3699c5ad9b1) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The "See New Changes" button is now hidden when checkpoints are disabled.

## [v4.97.2]

- [#2655](https://github.com/Kilo-Org/kilocode/pull/2655) [`3f83727`](https://github.com/Kilo-Org/kilocode/commit/3f8372708344171f4b379b90ad04693e1f67be39) Thanks [@PierreAncey](https://github.com/PierreAncey)! - Add Grok 4 Fast model to xAI provider

- [#2648](https://github.com/Kilo-Org/kilocode/pull/2648) [`6f3f9fb`](https://github.com/Kilo-Org/kilocode/commit/6f3f9fba397ad34430c98a6db7ef535fe32622e8) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix error logging behavior in JetBrains plugin by updating console bridge log levels

- [#2617](https://github.com/Kilo-Org/kilocode/pull/2617) [`a94bf01`](https://github.com/Kilo-Org/kilocode/commit/a94bf01f7df542ffd372bbb0d385b39941187b0d) Thanks [@RSO](https://github.com/RSO)! - JetBrains: Fix terminal not having complete path

## [v4.97.1]

- [#2625](https://github.com/Kilo-Org/kilocode/pull/2625) [`3409665`](https://github.com/Kilo-Org/kilocode/commit/340966544bda3a069f9cf2478658bf58f5e2cf3c) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add fix for Gemini CLI not being able to refresh access token anymore

- [#2536](https://github.com/Kilo-Org/kilocode/pull/2536) [`1a01114`](https://github.com/Kilo-Org/kilocode/commit/1a011145572333d053b8999c3f38bf718bbedf66) Thanks [@mcowger](https://github.com/mcowger)! - Only validate embedders when they match the currently configured provider

- [#2491](https://github.com/Kilo-Org/kilocode/pull/2491) [`06afc76`](https://github.com/Kilo-Org/kilocode/commit/06afc769d29740083027a1caa6195edcfbbb94e2) Thanks [@Thireus](https://github.com/Thireus)! - Increase OpenAI Compatible timeout

## [v4.97.0]

- [#2505](https://github.com/Kilo-Org/kilocode/pull/2505) [`a59e7f5`](https://github.com/Kilo-Org/kilocode/commit/a59e7f565478c7405e62c59448bf7667e4b26c8f) Thanks [@markijbema](https://github.com/markijbema)! - Added option to the Display tab of the settings to disable autocomplete gutter animation

- [#2602](https://github.com/Kilo-Org/kilocode/pull/2602) [`0807e5f`](https://github.com/Kilo-Org/kilocode/commit/0807e5ffdfcef1f90e6469a964d47ec177cca706) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add GPT-5-Codex to OpenAI provider (thanks Roo / @daniel-lxs)

### Patch Changes

- [#2583](https://github.com/Kilo-Org/kilocode/pull/2583) [`0c13d2d`](https://github.com/Kilo-Org/kilocode/commit/0c13d2db8391f194150001a2fc1e247573a95db2) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The rate limiter no longer generates timeouts longer than the configured limit.

- [#2596](https://github.com/Kilo-Org/kilocode/pull/2596) [`38f4547`](https://github.com/Kilo-Org/kilocode/commit/38f45478d4183f375e8a717a3564d3ac91fd6daa) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Reasoning can now be disabled for DeepSeek V3.1 models when using Kilo Code or OpenRouter providers by setting Reasoning Effort to minimal

- [#2586](https://github.com/Kilo-Org/kilocode/pull/2586) [`0b4025d`](https://github.com/Kilo-Org/kilocode/commit/0b4025df4c44d86a0aba20d19d5b32f2eaa214c6) Thanks [@b3nw](https://github.com/b3nw)! - New Chutes AI models added and pricing updated

- [#2603](https://github.com/Kilo-Org/kilocode/pull/2603) [`b5325a8`](https://github.com/Kilo-Org/kilocode/commit/b5325a82abe94e195b580ac27cd0a8bf7f8577a7) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Reasoning can now be disabled for Grok 4 Fast on OpenRouter by setting Reasoning Effort to minimal. Note that Grok 4 Fast does not expose its reasoning tokens.

- [#2570](https://github.com/Kilo-Org/kilocode/pull/2570) [`18963de`](https://github.com/Kilo-Org/kilocode/commit/18963de4dce86be883c03ceeb418e820bd2c0635) Thanks [@snova-jorgep](https://github.com/snova-jorgep)! - Update available SambaNova models

## [v4.96.2]

- [#2521](https://github.com/Kilo-Org/kilocode/pull/2521) [`9304511`](https://github.com/Kilo-Org/kilocode/commit/9304511cb001114886f026744c3492f6a6a839f2) Thanks [@mcowger](https://github.com/mcowger)! - Update loop error message to refer to model instead of Kilo Code as the cause.

- [#2532](https://github.com/Kilo-Org/kilocode/pull/2532) [`8103ad4`](https://github.com/Kilo-Org/kilocode/commit/8103ad4b59135888861b06c2cff7fc35ba965607) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The description of the read_file tool was tweaked to make it more likely a vision-capable model will use it for image reading.

- [#2558](https://github.com/Kilo-Org/kilocode/pull/2558) [`3044c43`](https://github.com/Kilo-Org/kilocode/commit/3044c43479b7d64599af536d3df90251b850ea24) Thanks [@ivanarifin](https://github.com/ivanarifin)! - Fix env path resolution for custom gemini cli oauth path

## [v4.96.1]

- [#2452](https://github.com/Kilo-Org/kilocode/pull/2452) [`d4cfbe9`](https://github.com/Kilo-Org/kilocode/commit/d4cfbe98a7ca4e2ce389fe221875f6158688ff69) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains - Fix reload extension when switch project

## [v4.96.0]

- [#2504](https://github.com/Kilo-Org/kilocode/pull/2504) [`4927414`](https://github.com/Kilo-Org/kilocode/commit/4927414d0737312796a0c5ae9b0e5a9d7629fbbc) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Include changes from Roo Code v3.28.0-v3.28.2:

    - Improve auto-approve UI with smaller and more subtle design (thanks @brunobergher!)
    - Fix: Message queue re-queue loop in Task.ask() causing performance issues (#7861 by @hannesrudolph, PR by @daniel-lxs)
    - Fix: Restrict @-mention parsing to line-start or whitespace boundaries to prevent false triggers (#7875 by @hannesrudolph, PR by @app/roomote)
    - Fix: Make nested git repository warning persistent with path info for better visibility (#7884 by @hannesrudolph, PR by @app/roomote)
    - Fix: Include API key in Ollama /api/tags requests for authenticated instances (#7902 by @ItsOnlyBinary, PR by @app/roomote)
    - Fix: Preserve original first message context during conversation condensing (thanks @daniel-lxs!)
    - Make Posthog telemetry the default (thanks @mrubens!)
    - Bust cache in generated image preview (thanks @mrubens!)
    - Fix: Center active mode in selector dropdown on open (#7882 by @hannesrudolph, PR by @app/roomote)
    - Fix: Preserve first message during conversation condensing (thanks @daniel-lxs!)
    - feat: Add click-to-edit, ESC-to-cancel, and fix padding consistency for chat messages (#7788 by @hannesrudolph, PR by @app/roomote)
    - feat: Make reasoning more visible (thanks @app/roomote!)
    - fix: Fix Groq context window display (thanks @mrubens!)
    - fix: Add GIT_EDITOR env var to merge-resolver mode for non-interactive rebase (thanks @daniel-lxs!)
    - fix: Resolve chat message edit/delete duplication issues (thanks @daniel-lxs!)
    - fix: Reduce CodeBlock button z-index to prevent overlap with popovers (#7703 by @A0nameless0man, PR by @daniel-lxs)
    - fix: Revert PR #7188 - Restore temperature parameter to fix TabbyApi/ExLlamaV2 crashes (#7581 by @drknyt, PR by @daniel-lxs)
    - fix: Make ollama models info transport work like lmstudio (#7674 by @ItsOnlyBinary, PR by @ItsOnlyBinary)
    - fix: Update DeepSeek pricing to new unified rates effective Sept 5, 2025 (#7685 by @NaccOll, PR by @app/roomote)
    - feat: Update Vertex AI models and regions (#7725 by @ssweens, PR by @ssweens)

### Patch Changes

- [#2484](https://github.com/Kilo-Org/kilocode/pull/2484) [`f57fa9c`](https://github.com/Kilo-Org/kilocode/commit/f57fa9c58baca627a84003f0da133286212dba92) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix the autocomplete status bar appearing when autocomplete is not enabled

- [#2260](https://github.com/Kilo-Org/kilocode/pull/2260) [`9d4b078`](https://github.com/Kilo-Org/kilocode/commit/9d4b078c867c5b160af7a3f4629adfb016f9c2d9) Thanks [@anhhct](https://github.com/anhhct)! - The follow_up parameter of the ask_followup_question tool is now optional

- [#2458](https://github.com/Kilo-Org/kilocode/pull/2458) [`6a79d3b`](https://github.com/Kilo-Org/kilocode/commit/6a79d3b640f8c7e3f24e54bcf17ce63127fbce57) Thanks [@NaccOll](https://github.com/NaccOll)! - Fix Highlight is on the wrong places when referencing context

## [v4.95.0]

- [#2437](https://github.com/Kilo-Org/kilocode/pull/2437) [`5591bcb`](https://github.com/Kilo-Org/kilocode/commit/5591bcbb68d2e8e5af49baf45b8614982ab71e2f) Thanks [@hassoncs](https://github.com/hassoncs)! - You can now auto-start a task in a given profile/mode by creating a `.kilocode/launchConfig.json` before starting VS Code.

    See the docs for more information!

- [#2394](https://github.com/Kilo-Org/kilocode/pull/2394) [`94ce7ca`](https://github.com/Kilo-Org/kilocode/commit/94ce7ca174c4569d8e31fe11d075f04631fc42f4) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The Task History tab is now paginated. This should help with reducing memory consumption.

- [#2417](https://github.com/Kilo-Org/kilocode/pull/2417) [`0d4a18f`](https://github.com/Kilo-Org/kilocode/commit/0d4a18fd0ff5a1948405405644ff30b9cbfa3e43) Thanks [@hassoncs](https://github.com/hassoncs)! - Inline assist / autocomplete suggestions now support colorized code highlighting

### Patch Changes

- [#2421](https://github.com/Kilo-Org/kilocode/pull/2421) [`825f7df`](https://github.com/Kilo-Org/kilocode/commit/825f7df5da5a6bbdbfe26739cd5adfc2836fb7a1) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Improved proxy support in cases where previously the Kilo Code and OpenRouter model lists would remain empty

## [v4.94.0]

- [#2361](https://github.com/Kilo-Org/kilocode/pull/2361) [`9b553d3`](https://github.com/Kilo-Org/kilocode/commit/9b553d32940736fec49dde8de75faba1e0890471) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains - Improve Light Theme

- [#2407](https://github.com/Kilo-Org/kilocode/pull/2407) [`aacf662`](https://github.com/Kilo-Org/kilocode/commit/aacf662030e25c64fbc8800bcf514832949f74ec) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Re-add codeblock menu bar for easy copying and syntax highlighting toggling

### Patch Changes

- [#2423](https://github.com/Kilo-Org/kilocode/pull/2423) [`ed12b48`](https://github.com/Kilo-Org/kilocode/commit/ed12b4897bc65df822fa994c13bf325c12055842) Thanks [@mcowger](https://github.com/mcowger)! - Improved the behavior of the Virtual Quota Fallback provider when there are no limits configured.

- [#2412](https://github.com/Kilo-Org/kilocode/pull/2412) [`e7fc4b4`](https://github.com/Kilo-Org/kilocode/commit/e7fc4b473b105ce8a6d92df17f1893f724c158a1) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Change default mode on first start from architect to code and tweak mode selector menu to show all default modes

- [#2402](https://github.com/Kilo-Org/kilocode/pull/2402) [`cb44445`](https://github.com/Kilo-Org/kilocode/commit/cb44445574a43179968656ade28bfce666973f9d) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The Z.ai provider now supports their coding plan (subscription)

- [#2408](https://github.com/Kilo-Org/kilocode/pull/2408) [`53b387c`](https://github.com/Kilo-Org/kilocode/commit/53b387ce388dbd0c51547934c308d305128f9e5a) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add support for Qwen3-Next-80B-A3B-Instruct and Qwen3-Next-80B-A3B-Thinking to Chutes provider

## [v4.93.2]

- [#2401](https://github.com/Kilo-Org/kilocode/pull/2401) [`4c0c434`](https://github.com/Kilo-Org/kilocode/commit/4c0c434fce4bd8ce9c31a396c98e21b62cb300c1) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Commit Message Generation and Enhance Prompt now support billing through Kilo for Teams

## [v4.93.1]

- [#2388](https://github.com/Kilo-Org/kilocode/pull/2388) [`484ced4`](https://github.com/Kilo-Org/kilocode/commit/484ced4df8f6bc24091268d1850c8eba752e7cc8) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Kilo Code Provider Routing settings are now hidden when managed by an organization

## [v4.93.0]

- [#2353](https://github.com/Kilo-Org/kilocode/pull/2353) [`75f8f7b`](https://github.com/Kilo-Org/kilocode/commit/75f8f7b21671ddfba4bdfb441fe3e8fd215530d1) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.27.0

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

### Patch Changes

- [#2375](https://github.com/Kilo-Org/kilocode/pull/2375) [`5b634bc`](https://github.com/Kilo-Org/kilocode/commit/5b634bc5933eca19abc8f9bb4e011d0dae486b76) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Removed the arbitrary 8192 output limit for Anthropic models

- [#2368](https://github.com/Kilo-Org/kilocode/pull/2368) [`5f4071b`](https://github.com/Kilo-Org/kilocode/commit/5f4071b64d9cbd7a8b37b806a678e0f70457ebee) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed context windows being too small when using Ollama Turbo

## [v4.92.1]

- [#2364](https://github.com/Kilo-Org/kilocode/pull/2364) [`7573854`](https://github.com/Kilo-Org/kilocode/commit/75738541270db6702aac649730472c92e8084444) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Remove some nonexistent models from the model selector

## [v4.92.0]

- [#2299](https://github.com/Kilo-Org/kilocode/pull/2299) [`1ab5cc7`](https://github.com/Kilo-Org/kilocode/commit/1ab5cc7d0f9d7748137791043508253af70704a9) Thanks [@catrielmuller](https://github.com/catrielmuller)! - MacOS - System Terminal Notifier Support

### Patch Changes

- [#2352](https://github.com/Kilo-Org/kilocode/pull/2352) [`e343439`](https://github.com/Kilo-Org/kilocode/commit/e34343916be94d0f4374753e0c130b911cfbf20e) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Better error messages are shown when the model currently in use disappears (this will be relevant shortly for Sonoma)

## [v4.91.2]

- [#2342](https://github.com/Kilo-Org/kilocode/pull/2342) [`6641568`](https://github.com/Kilo-Org/kilocode/commit/6641568fedba0b5f0a76ce9c5d88182b58b327a5) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix Jetbrains editor detection

## [v4.91.1]

- [#2310](https://github.com/Kilo-Org/kilocode/pull/2310) [`29c7af6`](https://github.com/Kilo-Org/kilocode/commit/29c7af60d8c5c285b28ce2f9bd1bfeff1d59dc40) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Thanks @Qiiks! - Remove duplicate Qwen Code provider settings

- [#2322](https://github.com/Kilo-Org/kilocode/pull/2322) [`669713e`](https://github.com/Kilo-Org/kilocode/commit/669713e6a66ce6599664e15450bf2c917861df51) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed the maximum output size of Claude Opus 4.1, which was inadvertenly set to 8192 rather than 32k

- [#2332](https://github.com/Kilo-Org/kilocode/pull/2332) [`e3eea75`](https://github.com/Kilo-Org/kilocode/commit/e3eea758975c2ef3da34dec167ea373277ab5928) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Fixed an HTTP 500 error with OpenAI-compatible providers when no custom temperature is set

## [v4.91.0]

- [#2289](https://github.com/Kilo-Org/kilocode/pull/2289) [`13c45e5`](https://github.com/Kilo-Org/kilocode/commit/13c45e59adc7d4f337dacb8eda5e35127639c241) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - Added support for Kimi K2 0905 to Chutes, Fireworks, Groq and Moonshot providers

- [#2294](https://github.com/Kilo-Org/kilocode/pull/2294) [`980a253`](https://github.com/Kilo-Org/kilocode/commit/980a253ccc906c7a40ef65ab4a7513097b99648b) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains - MultiDiff / See New Changes support

### Patch Changes

- [#2281](https://github.com/Kilo-Org/kilocode/pull/2281) [`71334fc`](https://github.com/Kilo-Org/kilocode/commit/71334fcb9556fc8ada02b707bef9dd09aedf3864) Thanks [@hassoncs](https://github.com/hassoncs)! - Clear images when changing to a model that does not support them

- [#2280](https://github.com/Kilo-Org/kilocode/pull/2280) [`0713b0d`](https://github.com/Kilo-Org/kilocode/commit/0713b0dbfe047ac7f68727d6dd77b780c9006c6b) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix organization switching not saving properly

- [#2287](https://github.com/Kilo-Org/kilocode/pull/2287) [`b5a8550`](https://github.com/Kilo-Org/kilocode/commit/b5a8550a106fcafa31d332f5b76febc34ffc43ec) Thanks [@Qiiks](https://github.com/Qiiks)! - Fix Gemini CLI integration to handle nested response structures

## [v4.90.0]

- [#2275](https://github.com/Kilo-Org/kilocode/pull/2275) [`4ae9acc`](https://github.com/Kilo-Org/kilocode/commit/4ae9acc00a90331944333356e8b936a0dcc06e77) Thanks [@jeske](https://github.com/jeske)! - fixes an intermittent async race that discards user-chat-input during structured approve/reject

- [#2129](https://github.com/Kilo-Org/kilocode/pull/2129) [`984b5c4`](https://github.com/Kilo-Org/kilocode/commit/984b5c4151945fc483ca1fd08e07c12f61a372da) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Jetbrains Extension Beta

### Patch Changes

- [#2274](https://github.com/Kilo-Org/kilocode/pull/2274) [`24d0c9f`](https://github.com/Kilo-Org/kilocode/commit/24d0c9f679e33c899f74c06440a80e4ea50b07ed) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The API Provider (Kilo Code or OpenRouter) for image generation is now an explicit choice

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
