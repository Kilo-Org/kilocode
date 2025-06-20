# kilo-code

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
