# kilo-code

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
