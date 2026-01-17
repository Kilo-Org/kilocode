# @kilocode/cli

## 0.22.2

### Patch Changes

- [#5113](https://github.com/Kilo-Org/kilocode/pull/5113) [`6d04a15`](https://github.com/Kilo-Org/kilocode/commit/6d04a150383af75ed42b954fc3c42e9e010bbed9) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix CLI crash when config file is empty or contains invalid JSON

## 0.22.1

### Patch Changes

- [#5098](https://github.com/Kilo-Org/kilocode/pull/5098) [`e811ebe`](https://github.com/Kilo-Org/kilocode/commit/e811ebe287f187bac11239fddfab7067f428872d) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Show total session cost in status bar instead of per-request costs. Remove "API Request in progress" messages for cleaner UI.

- [#5100](https://github.com/Kilo-Org/kilocode/pull/5100) [`a49868e`](https://github.com/Kilo-Org/kilocode/commit/a49868e17842d252a9a28d61aa0683267e8e3020) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix CLI context indicator showing incorrect values by skipping placeholder api_req_started messages

- [#5104](https://github.com/Kilo-Org/kilocode/pull/5104) [`15a8d77`](https://github.com/Kilo-Org/kilocode/commit/15a8d77fdbe78314b448714e9812fc0857393cf5) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix CLI interactive prompts (arrow key navigation) not working on Windows

    The inquirer v13+ upgrade introduced stricter TTY raw mode requirements. This fix ensures raw mode is properly enabled before inquirer prompts, restoring arrow key navigation in list selections like provider choice during `kilocode auth`.

- [#5092](https://github.com/Kilo-Org/kilocode/pull/5092) [`42cdb11`](https://github.com/Kilo-Org/kilocode/commit/42cdb11b77552cb87fce9ee591bd68cbe419c3be) Thanks [@Drilmo](https://github.com/Drilmo)! - Fix Cmd+V image paste regression in VSCode terminal

    Restores the ability to paste images using Cmd+V in VSCode terminal, which was broken in #4916. VSCode sends empty bracketed paste sequences for Cmd+V (unlike regular terminals that send key events), so we need to check the clipboard for images when receiving an empty paste.

- Updated dependencies [[`b2e2630`](https://github.com/Kilo-Org/kilocode/commit/b2e26304e562e516383fbf95a3fdc668d88e1487)]:
    - @kilocode/core-schemas@0.0.1

## 0.22.0

### Minor Changes

- [#5046](https://github.com/Kilo-Org/kilocode/pull/5046) [`fd2029c`](https://github.com/Kilo-Org/kilocode/commit/fd2029c1de9adeedb4ac4974c10f43c936d60914) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add `--on-task-completed <prompt>` flag to send a custom prompt to the agent when the task completes. This flag requires `--auto` mode and allows users to define any follow-up action (e.g., creating a PR, running tests, generating documentation). The prompt is sent to the agent after the main task completes, enabling flexible post-task automation.

- [#5022](https://github.com/Kilo-Org/kilocode/pull/5022) [`2fc244c`](https://github.com/Kilo-Org/kilocode/commit/2fc244c85c7b1b3758e1139667e3615822656e10) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add syntax highlighting to code edit diffs in the CLI. Diffs now display with language-aware syntax coloring using Shiki, making code changes easier to read. Includes support for 60+ languages, automatic language detection from file extensions, and theme-aware highlighting that works with both light and dark themes. Also increased the diff display limit from 20 to 50 lines with smart context collapsing around changes.

### Patch Changes

- [#4988](https://github.com/Kilo-Org/kilocode/pull/4988) [`7253ac0`](https://github.com/Kilo-Org/kilocode/commit/7253ac0457bf226688cad475002123a84916ea44) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix Bedrock provider validation to support API key authentication without requiring access keys

- [#5064](https://github.com/Kilo-Org/kilocode/pull/5064) [`2713d06`](https://github.com/Kilo-Org/kilocode/commit/2713d069e9775e3e7b7e7f5954152b275029bd0d) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add default autocomplete suggestions for select commands (`/model select`, `/provider select`, `/tasks select`, `/session select`)

- [#5066](https://github.com/Kilo-Org/kilocode/pull/5066) [`8055f15`](https://github.com/Kilo-Org/kilocode/commit/8055f153d1491c39eb2254d74c3842e4616a79d2) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix CLI dispose, randomUUID, and debug UX issues

- [#5011](https://github.com/Kilo-Org/kilocode/pull/5011) [`9c8bb7b`](https://github.com/Kilo-Org/kilocode/commit/9c8bb7b9bde56eb4d32093a2ee4bb72ac0906e92) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix multiline paste regression where pasting text with newlines would submit after the first line

- [#5000](https://github.com/Kilo-Org/kilocode/pull/5000) [`1c88a66`](https://github.com/Kilo-Org/kilocode/commit/1c88a66caaacef3b96bc819456181d84174b82b2) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix empty files being created when project path contains non-Latin characters (e.g., Cyrillic, Chinese)

    The CLI's `write_to_file` command was creating empty files when the project directory path contained non-Latin characters. This was caused by improper handling of `Uint8Array` content in the `FileSystemAPI.writeFile` method. The fix ensures proper `Buffer.from()` conversion before writing to the filesystem.

- [#5058](https://github.com/Kilo-Org/kilocode/pull/5058) [`c9f1f6a`](https://github.com/Kilo-Org/kilocode/commit/c9f1f6afe32cdec374e7138c997c2a0b89b4989b) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix autocomplete for `/teams select` and other multi-argument commands

- [#4985](https://github.com/Kilo-Org/kilocode/pull/4985) [`69a541a`](https://github.com/Kilo-Org/kilocode/commit/69a541a6d85cf79580c7d80c691bf3f5a6aa6b89) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix Windows cmd.exe display bug with escape sequences

    On Windows cmd.exe, the `\x1b[3J` (clear scrollback buffer) escape sequence is not properly supported and causes display artifacts like raw escape sequences appearing in the output (e.g., `[\r\n\t...]`).

## 0.21.0

### Minor Changes

- [#4916](https://github.com/Kilo-Org/kilocode/pull/4916) [`f02364c`](https://github.com/Kilo-Org/kilocode/commit/f02364c5a75729b5d17f447dee7570ee1e7490e6) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Abbreviate large pasted text in CLI input as `[Pasted text #N +X lines]` to prevent input field overflow when pasting logs or large code blocks

- [#4997](https://github.com/Kilo-Org/kilocode/pull/4997) [`2a663be`](https://github.com/Kilo-Org/kilocode/commit/2a663bedc2a0b129a9d79321dea0ad280ec3a5da) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add `kilocode models --json` command to expose available models as JSON for programmatic use

- [#4936](https://github.com/Kilo-Org/kilocode/pull/4936) [`bfcd1d5`](https://github.com/Kilo-Org/kilocode/commit/bfcd1d5f38a887a9e0c736410ef2ff84ec0f5f3b) Thanks [@idreesmuhammadqazi-create](https://github.com/idreesmuhammadqazi-create)! - Add colorblind theme support to CLI

    - Colorblind-friendly theme with high contrast colors for accessibility

### Patch Changes

- [#4983](https://github.com/Kilo-Org/kilocode/pull/4983) [`82ef9b0`](https://github.com/Kilo-Org/kilocode/commit/82ef9b0ad09f1b75f66db116bf9cf7c1a34edd01) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add `/checkpoint enable` and `/checkpoint disable` subcommands to toggle checkpoint creation and save disk space

- [#4982](https://github.com/Kilo-Org/kilocode/pull/4982) [`7d02d43`](https://github.com/Kilo-Org/kilocode/commit/7d02d4364b1dc4c04ce55b2feb368329b3b9c3c4) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - fix(cli): improve error message for custom mode not found

- [#4996](https://github.com/Kilo-Org/kilocode/pull/4996) [`d7016fa`](https://github.com/Kilo-Org/kilocode/commit/d7016faa01dc0d0eefeff0b7abd5cf873ab54616) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add maxConcurrentFileReads configuration support to CLI with documentation

- [#4981](https://github.com/Kilo-Org/kilocode/pull/4981) [`0268494`](https://github.com/Kilo-Org/kilocode/commit/0268494f53276e4c5411204b01e50c15c9b02787) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix CLI `/model list` returning "No models available" for nano-gpt provider

- [#4977](https://github.com/Kilo-Org/kilocode/pull/4977) [`c71cff8`](https://github.com/Kilo-Org/kilocode/commit/c71cff8451927052c00b5306c0b552b4afe33dbd) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add proper display for deleteFile tool in CLI instead of showing "Unknown tool: deleteFile"

- [#4978](https://github.com/Kilo-Org/kilocode/pull/4978) [`ed5073c`](https://github.com/Kilo-Org/kilocode/commit/ed5073ccb6ffc8acc53cb9e7191b1f618001ed40) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix number key hotkeys (1, 2, 3) not working in command approval menu

- [#4993](https://github.com/Kilo-Org/kilocode/pull/4993) [`c3c7bbe`](https://github.com/Kilo-Org/kilocode/commit/c3c7bbe70ed1832e62c8cb05f3a0db4cdbc0dd25) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix CLI hanging on rate limit errors in autonomous mode by enabling auto-retry for API failures

- [#4995](https://github.com/Kilo-Org/kilocode/pull/4995) [`95e9b6d`](https://github.com/Kilo-Org/kilocode/commit/95e9b6d234681d34f3903715de1ceba67e745516) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - fix: use correct api url for some endpoints

## 0.20.0

### Minor Changes

- [#4943](https://github.com/Kilo-Org/kilocode/pull/4943) [`eef76d0`](https://github.com/Kilo-Org/kilocode/commit/eef76d0e4b962c7b9680e5c9226b22ecaa3fa79b) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add Shift+Tab keyboard shortcut to cycle through modes in the CLI

### Patch Changes

- [#4941](https://github.com/Kilo-Org/kilocode/pull/4941) [`b7052cc`](https://github.com/Kilo-Org/kilocode/commit/b7052cc2030466626a832e19061675d91edb6f94) Thanks [@Drilmo](https://github.com/Drilmo)! - Add extension path resolution for F5 debug workflow

    - CLI resolves extension from src/dist/ when KILOCODE_DEV_CLI_PATH is set
    - Add watch:cli:setup and watch:cli:deps tasks for reliable CLI builds

- [#4967](https://github.com/Kilo-Org/kilocode/pull/4967) [`99029a5`](https://github.com/Kilo-Org/kilocode/commit/99029a556253b82ee8a8b56445dabd65b56e4fef) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Improved file update display in CLI with compact format and colored diffs

- [#4949](https://github.com/Kilo-Org/kilocode/pull/4949) [`f56d88a`](https://github.com/Kilo-Org/kilocode/commit/f56d88af3697993b2b33863741d5c47cd06e17be) Thanks [@eshurakov](https://github.com/eshurakov)! - Add --attach flag for file attachments in CLI

- [#4959](https://github.com/Kilo-Org/kilocode/pull/4959) [`2dce098`](https://github.com/Kilo-Org/kilocode/commit/2dce098cb2f2476fb9978dcbb49b5070ba96a296) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - feat(cli): add word-by-word cursor navigation

    Adds support for word-by-word cursor navigation in the CLI text input:

    - `Meta+b` / `Meta+Left` to move to the beginning of the previous word
    - `Meta+f` / `Meta+Right` to move to the beginning of the next word

    This enhances the editing experience with Emacs-style keybindings and standard Meta+Arrow key navigation.

## 0.19.3

### Patch Changes

- [#4827](https://github.com/Kilo-Org/kilocode/pull/4827) [`2a66afb`](https://github.com/Kilo-Org/kilocode/commit/2a66afb98b582a73d43b2147d941df32f3eb43a4) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix slash commands being intercepted by followup suggestions during `ask_followup_question` prompts.

- [#4940](https://github.com/Kilo-Org/kilocode/pull/4940) [`9809864`](https://github.com/Kilo-Org/kilocode/commit/9809864ce51474c29b0db2635a19a92520a2f1f1) Thanks [@Drilmo](https://github.com/Drilmo)! - Add KILOCODE_DEV_CLI_PATH support for easier extension + CLI development workflow

## 0.19.2

### Patch Changes

- [#4829](https://github.com/Kilo-Org/kilocode/pull/4829) [`4e09e36`](https://github.com/Kilo-Org/kilocode/commit/4e09e36bba165a2ab6f5e07f71a420faa49ea3ec) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix browser action results displaying raw base64 screenshot data as hexadecimal garbage

## 0.19.1

### Patch Changes

- [#4810](https://github.com/Kilo-Org/kilocode/pull/4810) [`2d8f5b4`](https://github.com/Kilo-Org/kilocode/commit/2d8f5b4f823750d22701d962ba27885b01f78acb) Thanks [@kiloconnect](https://github.com/apps/kiloconnect)! - Add `--append-system-prompt` CLI option to append custom instructions to the system prompt

## 0.19.0

### Minor Changes

- [#4730](https://github.com/Kilo-Org/kilocode/pull/4730) [`695f68f`](https://github.com/Kilo-Org/kilocode/commit/695f68f41e6b58e484d4ab914b568f5092ebdcfc) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add autocomplete for `/mode` command in CLI, similar to model autocomplete. When typing `/mode ` and pressing tab, users now see suggestions for all available modes including default and custom modes with their names, descriptions, and source labels.

### Patch Changes

- [#4792](https://github.com/Kilo-Org/kilocode/pull/4792) [`25b7efe`](https://github.com/Kilo-Org/kilocode/commit/25b7efe9b4514e1e4ec7945dfcfcd34cc725f629) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix API request cost updates in the CLI when using static message rendering

- [#4735](https://github.com/Kilo-Org/kilocode/pull/4735) [`ffabf05`](https://github.com/Kilo-Org/kilocode/commit/ffabf05c2684f36303610c97e6ca94d0ce0e48a9) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add CLI `/condense` command for manual context condensation

- [#4732](https://github.com/Kilo-Org/kilocode/pull/4732) [`2f16482`](https://github.com/Kilo-Org/kilocode/commit/2f16482b9fd84fb397a0ac6341edd9887d8b42e5) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add instant ESC/Ctrl+X cancellation feedback with optimistic UI and reduced readline escape timeout

- [#4740](https://github.com/Kilo-Org/kilocode/pull/4740) [`f291417`](https://github.com/Kilo-Org/kilocode/commit/f29141793f4c9340da139caaa62360daaef64e43) Thanks [@kiloconnect](https://github.com/apps/kiloconnect)! - Fix CLI formatting for unknown message types, JSON content, and codebase search results

    - Improved JSON parsing in CI mode with proper error handling
    - Enhanced unknown message type handling with JSON formatting
    - Fixed codebase search results parsing to match extension payload format
    - Fixed operator precedence bug in SayMessageRouter.tsx

- [#4797](https://github.com/Kilo-Org/kilocode/pull/4797) [`ae3701b`](https://github.com/Kilo-Org/kilocode/commit/ae3701b85eb945c4ab5415690fca96226de3ad53) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Fix slash command suggestions to select first entry by default when typing `/`

- [#4778](https://github.com/Kilo-Org/kilocode/pull/4778) [`ea212ca`](https://github.com/Kilo-Org/kilocode/commit/ea212caa226234f8c126a3ffaa93d2696414dea3) Thanks [@kiloconnect](https://github.com/apps/kiloconnect)! - Fix CLI auto-update regression caused by inverted conditional logic with --nosplash flag. The version check now runs for all users by default, regardless of the nosplash flag state.

- [#4780](https://github.com/Kilo-Org/kilocode/pull/4780) [`0cfe8b0`](https://github.com/Kilo-Org/kilocode/commit/0cfe8b0b9313b3016eaddfeb7ae1a247cd9b4011) Thanks [@Drilmo](https://github.com/Drilmo)! - Add log file rotation to prevent unbounded disk usage

    The CLI log file at `~/.kilocode/cli/logs/cli.txt` now automatically rotates at startup when it exceeds 10 MB, keeping only the most recent ~5 MB of logs. This prevents the log file from growing indefinitely and consuming excessive disk space for heavy CLI users or long-running sessions.

## 0.18.1

### Patch Changes

- [#4728](https://github.com/Kilo-Org/kilocode/pull/4728) [`8ecb081`](https://github.com/Kilo-Org/kilocode/commit/8ecb081d10ee273613f138e651abae5e1b28ab1e) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Clear input field when Ctrl+C is pressed

- [#4244](https://github.com/Kilo-Org/kilocode/pull/4244) [`f32adee`](https://github.com/Kilo-Org/kilocode/commit/f32adee47a681aa82ed65b412f9ddaeb46c051a5) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add image paste support to CLI

    - Allow Ctrl+V in the CLI to paste clipboard images, attach them as [Image #N], and send them with messages (macOS only, with status feedback and cleanup)
    - Add image mention parsing (@path and [Image #N]) so pasted or referenced images are included when sending messages
    - Split media code into a dedicated module with platform-specific clipboard handlers and image utilities

## 0.18.0

### Minor Changes

- [#4583](https://github.com/Kilo-Org/kilocode/pull/4583) [`845f8c1`](https://github.com/Kilo-Org/kilocode/commit/845f8c13b23496bf4aaf0792be9d52bf26645b64) Thanks [@kiloconnect](https://github.com/apps/kiloconnect)! - Add markdown theming support for Reasoning box content

### Patch Changes

- [#4590](https://github.com/Kilo-Org/kilocode/pull/4590) [`f2cc065`](https://github.com/Kilo-Org/kilocode/commit/f2cc0657870ae77a5720a872c9cd11b8315799b7) Thanks [@kiloconnect](https://github.com/apps/kiloconnect)! - feat: add session_title_generated event emission to CLI

## 0.17.1

### Patch Changes

- [#4186](https://github.com/Kilo-Org/kilocode/pull/4186) [`6078a9c`](https://github.com/Kilo-Org/kilocode/commit/6078a9ce77512faaebcda54ea9d2e909cf6b340c) Thanks [@lambertjosh](https://github.com/lambertjosh)! - Default read permissions now require approval for read operations outside the workspace

## 0.17.0

### Minor Changes

- [#4428](https://github.com/Kilo-Org/kilocode/pull/4428) [`8394da8`](https://github.com/Kilo-Org/kilocode/commit/8394da8715fae4eacf416301885eeee840456700) Thanks [@iscekic](https://github.com/iscekic)! - add parent session id when creating a session

### Patch Changes

- [#4155](https://github.com/Kilo-Org/kilocode/pull/4155) [`74fe4b8`](https://github.com/Kilo-Org/kilocode/commit/74fe4b8a20ff13c31d967693818708f81bd9167e) Thanks [@omniwired](https://github.com/omniwired)! - feat(cli): add Ctrl+Y keybinding to toggle YOLO mode

- [#4447](https://github.com/Kilo-Org/kilocode/pull/4447) [`0022305`](https://github.com/Kilo-Org/kilocode/commit/0022305558d71957aeb7468a0e8e3ed829997f93) Thanks [@EamonNerbonne](https://github.com/EamonNerbonne)! - Provide a few tips for when an LLM gets stuck in a loop

- [#4477](https://github.com/Kilo-Org/kilocode/pull/4477) [`564b60e`](https://github.com/Kilo-Org/kilocode/commit/564b60eb7c8a1cac6d80c6756a05e9e5eb20d94a) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Simplify --yolo option description

## 0.16.0

### Minor Changes

- [#4388](https://github.com/Kilo-Org/kilocode/pull/4388) [`af93318`](https://github.com/Kilo-Org/kilocode/commit/af93318e3648c235721ba58fe9caab9429608241) Thanks [@iscekic](https://github.com/iscekic)! - send org id and last mode with session data

## 0.15.0

### Minor Changes

- [#4326](https://github.com/Kilo-Org/kilocode/pull/4326) [`6d62090`](https://github.com/Kilo-Org/kilocode/commit/6d620905dfc6d8419bdbc9ffcad54109057e709e) Thanks [@iscekic](https://github.com/iscekic)! - improve session sync mechanism (event based instead of timer)

### Patch Changes

- [#4367](https://github.com/Kilo-Org/kilocode/pull/4367) [`8b3ef61`](https://github.com/Kilo-Org/kilocode/commit/8b3ef617c3f6a6f02eddc9e866efe82ce2644959) Thanks [@iscekic](https://github.com/iscekic)! - flush cli session on completion

- [#4362](https://github.com/Kilo-Org/kilocode/pull/4362) [`d596a08`](https://github.com/Kilo-Org/kilocode/commit/d596a08d6fe5c1a719855616ba5f582407f6769a) Thanks [@iscekic](https://github.com/iscekic)! - extract an extension message handler for extension/cli reuse

## 0.14.0

### Minor Changes

- [#4291](https://github.com/Kilo-Org/kilocode/pull/4291) [`215c48f`](https://github.com/Kilo-Org/kilocode/commit/215c48f68dca37df435ea619ba8496912e2b4c22) Thanks [@pandemicsyn](https://github.com/pandemicsyn)! - Fix race during session restoration

## 0.13.1

### Patch Changes

- [#4267](https://github.com/Kilo-Org/kilocode/pull/4267) [`a475394`](https://github.com/Kilo-Org/kilocode/commit/a47539442de1addacf55f9647471411fb55b50ee) Thanks [@marius-kilocode](https://github.com/marius-kilocode)! - Add JSON stdin handler for bidirectional CLI communication

## 0.13.0

### Minor Changes

- [#4251](https://github.com/Kilo-Org/kilocode/pull/4251) [`1c5e35b`](https://github.com/Kilo-Org/kilocode/commit/1c5e35b52959690b181800cdc4b9bccdf4606c91) Thanks [@pandemicsyn](https://github.com/pandemicsyn)! - fix cli ephemeral mode config leak

### Patch Changes

- [#4211](https://github.com/Kilo-Org/kilocode/pull/4211) [`489b366`](https://github.com/Kilo-Org/kilocode/commit/489b3669c34f437dfd7c4b9a692cf7d84fff73a1) Thanks [@iscekic](https://github.com/iscekic)! - refactor session manager to better handle asynchronicity of file save events

## 0.12.1

### Patch Changes

- [#4204](https://github.com/Kilo-Org/kilocode/pull/4204) [`c200579`](https://github.com/Kilo-Org/kilocode/commit/c2005792b71ff8ea8d2e15286575294eb079066f) Thanks [@iscekic](https://github.com/iscekic)! - fixes session cleanup race conditions

## 0.12.0

### Minor Changes

- [#4177](https://github.com/Kilo-Org/kilocode/pull/4177) [`8d44a94`](https://github.com/Kilo-Org/kilocode/commit/8d44a94a28f1cd84d1af9836c1822eb43fe41a1b) Thanks [@pandemicsyn](https://github.com/pandemicsyn)! - Fix: inject configuration before session restoration

## 0.11.0

### Minor Changes

- [#4148](https://github.com/Kilo-Org/kilocode/pull/4148) [`44ebf95`](https://github.com/Kilo-Org/kilocode/commit/44ebf95e72d2abad86181cc957a8fa29d1b38740) Thanks [@pandemicsyn](https://github.com/pandemicsyn)! - fix potential credential seeding race

### Patch Changes

- [#4066](https://github.com/Kilo-Org/kilocode/pull/4066) [`1831796`](https://github.com/Kilo-Org/kilocode/commit/18317963fbb5b02a1178f4579d5cb643cfbd531c) Thanks [@iscekic](https://github.com/iscekic)! - use shared session manager from extension folder

- [#4121](https://github.com/Kilo-Org/kilocode/pull/4121) [`7cd2035`](https://github.com/Kilo-Org/kilocode/commit/7cd2035a920a466d93001eb621cd21082d6cf9bd) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improve "/model list" command with pagination, filters and sorting

- [#4122](https://github.com/Kilo-Org/kilocode/pull/4122) [`fa54645`](https://github.com/Kilo-Org/kilocode/commit/fa546456b379d10044c045118b08f77b9034d5fc) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Pulish version on Github Pages

## 0.10.2

### Patch Changes

- [#4116](https://github.com/Kilo-Org/kilocode/pull/4116) [`c6072d0`](https://github.com/Kilo-Org/kilocode/commit/c6072d03709d93e9aca1b187c2005f65463d6b53) Thanks [@catrielmuller](https://github.com/catrielmuller)! - NPM provenance

## 0.10.1

### Patch Changes

- [#4115](https://github.com/Kilo-Org/kilocode/pull/4115) [`a36323c`](https://github.com/Kilo-Org/kilocode/commit/a36323c0fbb560172071826d2920ce7b94bd5985) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Public Docker images

## 0.10.0

### Minor Changes

- [#3868](https://github.com/Kilo-Org/kilocode/pull/3868) [`cf6ed3e`](https://github.com/Kilo-Org/kilocode/commit/cf6ed3ed3bc7dfe0268121f3e68d422f3ffadfff) Thanks [@iscekic](https://github.com/iscekic)! - add sessions support

## 0.9.0

### Minor Changes

- [#4003](https://github.com/Kilo-Org/kilocode/pull/4003) [`0bb5dfe`](https://github.com/Kilo-Org/kilocode/commit/0bb5dfeb4bb5a5cd07bb852a929acac28e02e78c) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Kilo Gateway one click authorization

## 0.8.0

### Minor Changes

- [#3305](https://github.com/Kilo-Org/kilocode/pull/3305) [`df83fc7`](https://github.com/Kilo-Org/kilocode/commit/df83fc71c9dcf4f8aaad0d55a0fd17732d493ff5) Thanks [@benzntech](https://github.com/benzntech)! - Custom modes support

### Patch Changes

- [#4027](https://github.com/Kilo-Org/kilocode/pull/4027) [`2841b10`](https://github.com/Kilo-Org/kilocode/commit/2841b10e9e86f2c74a5797ca9ec10bc93d87c17a) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Thinking animation

## 0.7.0

### Minor Changes

- [#3949](https://github.com/Kilo-Org/kilocode/pull/3949) [`5bc6c66`](https://github.com/Kilo-Org/kilocode/commit/5bc6c66b647ebede503c71a42512eef418dbd11a) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Continue and abort commands

- [#4001](https://github.com/Kilo-Org/kilocode/pull/4001) [`fb12c27`](https://github.com/Kilo-Org/kilocode/commit/fb12c27d169da8d06eb3598160628081731b0b98) Thanks [@pandemicsyn](https://github.com/pandemicsyn)! - Support emitting Unix exit codes for signal interruption (SIGINT/SIGTERM).

## 0.6.0

### Minor Changes

- [#3886](https://github.com/Kilo-Org/kilocode/pull/3886) [`00e6fb5`](https://github.com/Kilo-Org/kilocode/commit/00e6fb59a42dcf827f7cfe72516052c561723cd0) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Update Dependencies

## 0.5.1

### Patch Changes

- [#3826](https://github.com/Kilo-Org/kilocode/pull/3826) [`70b956f`](https://github.com/Kilo-Org/kilocode/commit/70b956f79b9878e32f36c827faa490bcdcb889e7) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Allow the user to type any custom follow up suggestion

## 0.5.0

### Minor Changes

- [#3774](https://github.com/Kilo-Org/kilocode/pull/3774) [`0dd8458`](https://github.com/Kilo-Org/kilocode/commit/0dd8458abb0f7c6247b7b9447c6d77cd96f687d7) Thanks [@catrielmuller](https://github.com/catrielmuller)! - New '/provider' command to switch beteen configured providers

- [#3783](https://github.com/Kilo-Org/kilocode/pull/3783) [`6d3911c`](https://github.com/Kilo-Org/kilocode/commit/6d3911cc0f571479cd6b0b12d3958996aab21342) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Configure the CLI using ENV variables

- [#3774](https://github.com/Kilo-Org/kilocode/pull/3774) [`0dd8458`](https://github.com/Kilo-Org/kilocode/commit/0dd8458abb0f7c6247b7b9447c6d77cd96f687d7) Thanks [@catrielmuller](https://github.com/catrielmuller)! - provider (-pv/--provider) and model (-mo/--model) command arguments

### Patch Changes

- [#3776](https://github.com/Kilo-Org/kilocode/pull/3776) [`81afb3f`](https://github.com/Kilo-Org/kilocode/commit/81afb3f88a719de403cc0fc4f97e66773201f528) Thanks [@Eldevia](https://github.com/Eldevia)! - Support installing CLI with bun

- [#3769](https://github.com/Kilo-Org/kilocode/pull/3769) [`eff6f2b`](https://github.com/Kilo-Org/kilocode/commit/eff6f2b9e8161f4016a378a28cd0b9a4df9d5ee0) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Update providers configurations

- [#3777](https://github.com/Kilo-Org/kilocode/pull/3777) [`bad3bbe`](https://github.com/Kilo-Org/kilocode/commit/bad3bbef8968a10c0dcf32f576fa7f983341c08e) Thanks [@catrielmuller](https://github.com/catrielmuller)! - --nosplash argument to hide welcome screen and notifications

## 0.4.2

### Patch Changes

- [#3744](https://github.com/Kilo-Org/kilocode/pull/3744) [`e1442ff`](https://github.com/Kilo-Org/kilocode/commit/e1442ffa934bea546cbf251ab19caf271c514c65) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix OpenAI compatible provider config

- [#3739](https://github.com/Kilo-Org/kilocode/pull/3739) [`d7a3204`](https://github.com/Kilo-Org/kilocode/commit/d7a3204b166d7e709e83f222f6858966e418828b) Thanks [@iscekic](https://github.com/iscekic)! - fix diff command

- [#3701](https://github.com/Kilo-Org/kilocode/pull/3701) [`7c8f30c`](https://github.com/Kilo-Org/kilocode/commit/7c8f30c12e541b3c3da56c208664571126fb031d) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improve Auth Wizard for KiloCode

## 0.4.1

### Patch Changes

- [#3703](https://github.com/Kilo-Org/kilocode/pull/3703) [`4d4d3da`](https://github.com/Kilo-Org/kilocode/commit/4d4d3dad367bf02a9766d0369cd90176097deeb4) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix "/teams list" command

## 0.4.0

### Minor Changes

- [#3562](https://github.com/Kilo-Org/kilocode/pull/3562) [`2a08b8d`](https://github.com/Kilo-Org/kilocode/commit/2a08b8dd4464432f9863c62e9ce7b416cd87843c) Thanks [@eliasto](https://github.com/eliasto)! - Add OVHcloud AI Endpoints provider to Kilocode CLI

### Patch Changes

- [#3648](https://github.com/Kilo-Org/kilocode/pull/3648) [`ff2ccee`](https://github.com/Kilo-Org/kilocode/commit/ff2ccee6564ae2e80259128043f4db26e86cf953) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix initialization race conditions on auto mode

- [#3672](https://github.com/Kilo-Org/kilocode/pull/3672) [`1bb9cab`](https://github.com/Kilo-Org/kilocode/commit/1bb9cabd872e82f2eef6667d5895eb7e75074ee0) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix file write/read race condition

- [#3694](https://github.com/Kilo-Org/kilocode/pull/3694) [`0253f12`](https://github.com/Kilo-Org/kilocode/commit/0253f125d5f1c146e6c3d08e651d266583f639ff) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improve Kitty protocol keyboard support

## 0.3.0

### Minor Changes

- [#3623](https://github.com/Kilo-Org/kilocode/pull/3623) [`ef6bcac`](https://github.com/Kilo-Org/kilocode/commit/ef6bcac79ed5708996e80c0c943d52f12c0fe3b2) Thanks [@Sureshkumars](https://github.com/Sureshkumars)! - # Checkpoint Restore

    Allows users to restore their conversation to a previous point in time.

    ## What do we have here?

    ### View your checkpoints

    `/checkpoint list`

    This shows all available restore points with:
    Hash for the checkpoint
    When it was created

    ### Restore to a checkpoint

    `/checkpoint restore abc123...`

    You'll see a confirmation showing:
    Which checkpoint you're going back to
    How many messages will be removed
    What will happen to your current work

    Choose `Restore` to go back, or `Cancel` to keep working.

    ### Example

    Let's say you asked Kilo CLI to refactor some code, but you don't like the result:

    Run `/checkpoint list` to see earlier save points

    Find the checkpoint from before the refactoring

    Run `/checkpoint restore <hash>` with that checkpoint's hash

    Confirm the restore
    Your conversation is now back to before the refactoring happened

    ### Why use checkpoints?

    1. Undo mistakes - Go back if something went wrong
    2. Try different approaches - Restore and try a different solution
    3. Keep working states - Return to a point where everything was working

### Patch Changes

- [#3500](https://github.com/Kilo-Org/kilocode/pull/3500) [`2e1a536`](https://github.com/Kilo-Org/kilocode/commit/2e1a53678fc1c331d98a63f0ab15b02b53fc1625) Thanks [@iscekic](https://github.com/iscekic)! - improves windows support

- [#3641](https://github.com/Kilo-Org/kilocode/pull/3641) [`94bc43a`](https://github.com/Kilo-Org/kilocode/commit/94bc43af224fed36023d0f3571d39c04d21aa660) Thanks [@KrtinShet](https://github.com/KrtinShet)! - Fix workspace path resolution when using relative paths with --workspace flag. Bash commands now execute in the correct directory.

## 0.2.0

### Minor Changes

- [#3528](https://github.com/Kilo-Org/kilocode/pull/3528) [`77438f1`](https://github.com/Kilo-Org/kilocode/commit/77438f1dfe2e9b5cfc5faccc314130d82c299842) Thanks [@KrtinShet](https://github.com/KrtinShet) [@iscekic](https://github.com/iscekic)! - add shell mode

- [#3556](https://github.com/Kilo-Org/kilocode/pull/3556) [`0fd4e8f`](https://github.com/Kilo-Org/kilocode/commit/0fd4e8f3b130f86ae5932c33ab647a2a08742c55) Thanks [@iscekic](https://github.com/iscekic)! - adds support for overriding config with env vars

## 0.1.2

### Patch Changes

- [#3259](https://github.com/Kilo-Org/kilocode/pull/3259) [`9e50bca`](https://github.com/Kilo-Org/kilocode/commit/9e50bcaebb93383eca1dac8e23ff02339c910ed9) Thanks [@stennkool](https://github.com/stennkool)! - Continue the last task conversation in the workspace (-c argument)

- [#3491](https://github.com/Kilo-Org/kilocode/pull/3491) [`b884c9e`](https://github.com/Kilo-Org/kilocode/commit/b884c9ea220f3c4c3a9c147f0fece64a26c830b4) Thanks [@catrielmuller](https://github.com/catrielmuller)! - File mention suggestion - @my/file

## 0.1.1

### Patch Changes

- [#3475](https://github.com/Kilo-Org/kilocode/pull/3475) [`623f8b7`](https://github.com/Kilo-Org/kilocode/commit/623f8b7583cd98cafd3b3a49563ffe05b87f2818) Thanks [@iscekic](https://github.com/iscekic)! - logs version on boot

- [#3474](https://github.com/Kilo-Org/kilocode/pull/3474) [`e04b81a`](https://github.com/Kilo-Org/kilocode/commit/e04b81a258bac18abb640d265258a9551494c21d) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Streaming message typewriter rendering

- [#3263](https://github.com/Kilo-Org/kilocode/pull/3263) [`97afc88`](https://github.com/Kilo-Org/kilocode/commit/97afc884060d8c9a15fd084bd8be6b1048ba9852) Thanks [@oliver-14203](https://github.com/oliver-14203)! - /theme command - Enjoy the colors! by: oliver-14203

- [#3289](https://github.com/Kilo-Org/kilocode/pull/3289) [`6a64388`](https://github.com/Kilo-Org/kilocode/commit/6a64388f090f44c2b58c3e418da596413f59ef32) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Tasks history support

- [#3497](https://github.com/Kilo-Org/kilocode/pull/3497) [`bb917a2`](https://github.com/Kilo-Org/kilocode/commit/bb917a2962093a54db7ac82f8d8561f87278e5be) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix Wellcome Message regression

## 0.1.0

### Minor Changes

- [#3452](https://github.com/Kilo-Org/kilocode/pull/3452) [`127a255`](https://github.com/Kilo-Org/kilocode/commit/127a2551cfd67d57484e59615b13435e7610acce) Thanks [@Sureshkumars](https://github.com/Sureshkumars)! - This PR improves the display of MCP tool requests and responses in the CLI, addressing issues with truncated payloads, poor formatting, and lack of metadata.

    - MCP request arguments were difficult to read (no formatting, no preview mode)
    - MCP response payloads were displayed as raw text dumps, overwhelming the terminal
    - No JSON detection or pretty-printing
    - No metadata about content size or type
    - Missing error handling for malformed data
    - No indication when content is truncated/previewed

    Created new `SayMcpServerResponseMessage` component for MCP responses and refactored `AskUseMcpServerMessage` to share formatting logic. Both will make use of newly added utility functions for JSON detection, formatting, and metadata display.
    `formatContentWithMetadata()` - Detects JSON, formats it, handles preview logic (>20 lines → show 5)
    `formatJson()` - Pretty-prints JSON with configurable indentation
    `approximateByteSize()` - Estimates byte size using `str.length * 3`
    `formatByteSize()`, `buildMetadataString()` - Display helpers

    | before                                                                                                                               | after                                                                                                                               |
    | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
    | <img width="1511" height="890" alt="before" src="https://github.com/user-attachments/assets/9b57d85c-1846-42d5-ba7b-2511a96e77b2" /> | <img width="1510" height="884" alt="after" src="https://github.com/user-attachments/assets/1a7599ce-4112-40d0-ac47-678d626cb51c" /> |

    Run the KiloCode CLI and let it automatically use any configured MCP server.

### Patch Changes

- [#3463](https://github.com/Kilo-Org/kilocode/pull/3463) [`512f58a`](https://github.com/Kilo-Org/kilocode/commit/512f58aa8b62d4df931d542b2420e292f1a711b6) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improve low balance message and added a retry action

- [#3468](https://github.com/Kilo-Org/kilocode/pull/3468) [`8f8ef10`](https://github.com/Kilo-Org/kilocode/commit/8f8ef107dd2751e4141473d33e098d6f28faa6d1) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Resolve orphaned partial ask messages

- [#3465](https://github.com/Kilo-Org/kilocode/pull/3465) [`bd0d51e`](https://github.com/Kilo-Org/kilocode/commit/bd0d51e5a43bb3ead7daeb1f45aa1d80cbbb78cc) Thanks [@iscekic](https://github.com/iscekic)! - improves autocomplete behavior

## 0.0.16

### Patch Changes

- [#3426](https://github.com/Kilo-Org/kilocode/pull/3426) [`15243f1`](https://github.com/Kilo-Org/kilocode/commit/15243f118ae4c4ac8a8f89fc6de11d6713f0a6f0) Thanks [@iscekic](https://github.com/iscekic)! - Improves error message clarity when initiating parallel mode

## 0.0.15

### Patch Changes

- [#3355](https://github.com/Kilo-Org/kilocode/pull/3355) [`e366e4c`](https://github.com/Kilo-Org/kilocode/commit/e366e4ce61deb98c587dbc9ef4527b9c04bc2e32) Thanks [@iscekic](https://github.com/iscekic)! - add parallel mode support

## 0.0.14

### Patch Changes

- [#3371](https://github.com/Kilo-Org/kilocode/pull/3371) [`e0e01b2`](https://github.com/Kilo-Org/kilocode/commit/e0e01b2ea03e84ee7447b546231ebed530d5aac8) Thanks [@RSO](https://github.com/RSO)! - Add a --json flag to render a stream of JSON objects while in --auto mode

## 0.0.13

### Patch Changes

- [#3369](https://github.com/Kilo-Org/kilocode/pull/3369) [`e41556e`](https://github.com/Kilo-Org/kilocode/commit/e41556e81a190cafa123e84bd804f7fbede36419) Thanks [@RSO](https://github.com/RSO)! - Add support for showing Kilo Code notifications

## 0.0.12

### Patch Changes

- [#3352](https://github.com/Kilo-Org/kilocode/pull/3352) [`c89bd23`](https://github.com/Kilo-Org/kilocode/commit/c89bd23be4196e95f6577c37b149690832d0be97) Thanks [@Sureshkumars](https://github.com/Sureshkumars)! - MCP operations were being auto-rejected in CI mode (autonomous mode) even when `autoApproval.mcp.enabled: true`, breaking GitHub Actions workflows and other autonomous operations that rely on MCP servers.

    **Root Cause:** The extension sends MCP requests with the ask type set to the operation name (e.g., `"use_mcp_server"`, `"access_mcp_resource"`), but the approval decision logic only handled these as tool names within the `"tool"` ask type. This caused MCP requests to fall through to the default case and get auto-rejected.

    The approval decision service uses a switch statement on `askType` to determine whether to auto-approve, auto-reject, or require manual approval:

    ```typescript
    switch (askType) {
    	case "tool": // handles tool names like "readFile", "writeFile"
    	case "command": // handles command execution
    	case "followup": // handles followup questions
    	case "api_req_failed": // handles retry requests
    	default: // ❌ MCP ask types fell here → auto-reject
    }
    ```

    Added explicit cases for MCP ask types to the switch statement:

    ```typescript
    case "use_mcp_server":
    case "access_mcp_resource":
        if (config.mcp?.enabled) {
            return { action: "auto-approve" }
        }
        return isCIMode ? { action: "auto-reject", ... } : { action: "manual" }
    ```

    Also enhanced the tool handler to catch MCP operations sent as tool names (in case the extension changes format):

    ```typescript
    if (tool === "use_mcp_tool" || tool === "use_mcp_server" || tool === "access_mcp_resource") {
    	if (config.mcp?.enabled) {
    		return { action: "auto-approve" }
    	}
    	// ... rejection logic
    }
    ```

    - **Chose explicit ask type handling** over mapping ask types to tool names (cleaner, respects extension's message format)
    - **Kept both ask type and tool name handlers** for defense-in-depth (minimal overhead, prevents future breakage)
    - **Removed verbose logging** to reduce noise while maintaining troubleshooting capability

    | before                                                                                                                                       | after                                                                                                                                       |
    | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
    | MCP operations auto-rejected in CI mode with error "Auto-rejected in CI mode"                                                                | MCP operations auto-approved when autoApproval.mcp.enabled: true                                                                            |
    | <img width="1444" height="499" alt="before-the-fix" src="https://github.com/user-attachments/assets/57e5820d-196c-4138-8b3d-1f185fc1db56" /> | <img width="1506" height="717" alt="after-the-fix" src="https://github.com/user-attachments/assets/a165aa9c-0018-47e4-a274-fed056716407" /> |

    1. Just `kilocode --auto "Review the PR #2 in X/X repo, use github mcp servers if needed"`
    2. Configure MCP settings with GitHub MCP server
    3. Set `autoApproval.mcp.enabled: true` in config

    ```bash
    cat > ~/.kilocode/cli/config.json <<EOF
    {
      "version": "1.0.0",
      "autoApproval": {
        "mcp": {
          "enabled": true
        }
      }
    }
    EOF

    `kilocode --auto "Review the PR #2 in X/X repo, use github mcp servers if needed"`

    ```

## 0.0.11

### Patch Changes

- [#3278](https://github.com/Kilo-Org/kilocode/pull/3278) [`cba3d00`](https://github.com/Kilo-Org/kilocode/commit/cba3d005766c88200a2d170770dcaeaef172dfbd) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improved stability of the approval menu, preventing it from showing when you don't expect it

## 0.0.10

### Patch Changes

- [#3260](https://github.com/Kilo-Org/kilocode/pull/3260) [`0f71526`](https://github.com/Kilo-Org/kilocode/commit/0f715267745a0458caa396736551b4b3bb374259) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improved stability of the approval menu, preventing it from showing when you don't expect it

- [#3262](https://github.com/Kilo-Org/kilocode/pull/3262) [`e6b62d4`](https://github.com/Kilo-Org/kilocode/commit/e6b62d45597aba9f08015fac9ced1c34ae779998) Thanks [@catrielmuller](https://github.com/catrielmuller)! - 'Added /clear command'

## 0.0.9

### Patch Changes

- [#3255](https://github.com/Kilo-Org/kilocode/pull/3255) [`55430b7`](https://github.com/Kilo-Org/kilocode/commit/55430b7965ae2aef12517375a0e0c0e7d8f2367c) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix suggestion selection with arrow keys

- [#3253](https://github.com/Kilo-Org/kilocode/pull/3253) [`db9cb43`](https://github.com/Kilo-Org/kilocode/commit/db9cb4355ae0e4559e99066c78315ee3635a3543) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Terminal resize support

## 0.0.8

### Patch Changes

- [#3201](https://github.com/Kilo-Org/kilocode/pull/3201) [`c44f948`](https://github.com/Kilo-Org/kilocode/commit/c44f9482fd024f38b7216a7f74b20a96445461a7) Thanks [@RSO](https://github.com/RSO)! - Added an onboarding wizard that helps you get set up in the CLI.

- [#3208](https://github.com/Kilo-Org/kilocode/pull/3208) [`cdc007c`](https://github.com/Kilo-Org/kilocode/commit/cdc007c1150d5210cc0b9c8e5c2b4c57efadfd44) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Allow auto-approval of commands straight from the approval menu

- [#3202](https://github.com/Kilo-Org/kilocode/pull/3202) [`6ab57f4`](https://github.com/Kilo-Org/kilocode/commit/6ab57f441847e07dd6868a87913a41e0cb137fa8) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Added prompt history. Use your up/down keys to navigate through previous prompts!

## 0.0.7

### Patch Changes

- [#3176](https://github.com/Kilo-Org/kilocode/pull/3176) [`4bcc1ee`](https://github.com/Kilo-Org/kilocode/commit/4bcc1ee557ae4b4244365a72679ec1f13332e856) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Support Kilo Code for Teams

- [#3168](https://github.com/Kilo-Org/kilocode/pull/3168) [`476d835`](https://github.com/Kilo-Org/kilocode/commit/476d835b7ab9fee35e2832fe329b2256b36b78c7) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Fix compatibility with extension v4.107.0

- [#3161](https://github.com/Kilo-Org/kilocode/pull/3161) [`712b104`](https://github.com/Kilo-Org/kilocode/commit/712b104acb323da51ac271b7eb95741b3cfa6d9d) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Improved install speed and fixed the outdated dependencies

## 0.0.6

### Patch Changes

- [#3128](https://github.com/Kilo-Org/kilocode/pull/3128) [`04a8de4`](https://github.com/Kilo-Org/kilocode/commit/04a8de4367cdac6401001a906b01755373be5a80) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Support all providers that are supported by the VS Code extension

## 0.0.5

### Patch Changes

- [#3094](https://github.com/Kilo-Org/kilocode/pull/3094) [`b55f3a8`](https://github.com/Kilo-Org/kilocode/commit/b55f3a8784df8efc1ff5f06d53a7c5998b4794ea) Thanks [@RSO](https://github.com/RSO)! - Rename -ci flag to -a (longform --auto)

- [#3080](https://github.com/Kilo-Org/kilocode/pull/3080) [`021c91c`](https://github.com/Kilo-Org/kilocode/commit/021c91c98ac8959f1de0f651d9bfd0e0ab885b17) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Added support for multi-line prompts

- [#3109](https://github.com/Kilo-Org/kilocode/pull/3109) [`2ed8e2e`](https://github.com/Kilo-Org/kilocode/commit/2ed8e2ec655efd22a081fe299b02d05e95227637) Thanks [@catrielmuller](https://github.com/catrielmuller)! - Update notification message at startup

## 0.0.4

### Patch Changes

- [#3066](https://github.com/Kilo-Org/kilocode/pull/3066) [`263741a`](https://github.com/Kilo-Org/kilocode/commit/263741a88054cf57591e5e240dfcafc8bb5c97ee) Thanks [@RSO](https://github.com/RSO)! - Made Logo responsive so that it better fits smaller screens

## 0.0.3

### Patch Changes

- [#3051](https://github.com/Kilo-Org/kilocode/pull/3051) [`c46bcff`](https://github.com/Kilo-Org/kilocode/commit/c46bcffc3e02b114042c96929c151206f26b412c) Thanks [@catrielmuller](https://github.com/catrielmuller)! - CLI - Fix deprecated dependencies

- [#3047](https://github.com/Kilo-Org/kilocode/pull/3047) [`b82b576`](https://github.com/Kilo-Org/kilocode/commit/b82b5765cb2a8334b06d98df992bb6763ef1d786) Thanks [@RSO](https://github.com/RSO)! - Initial pre-release of the CLI.

- [#3049](https://github.com/Kilo-Org/kilocode/pull/3049) [`88954dc`](https://github.com/Kilo-Org/kilocode/commit/88954dc4cca1b59aa7dc145eb86861960e3a20e1) Thanks [@RSO](https://github.com/RSO)! - Fixed the --version flag
