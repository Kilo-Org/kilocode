# kilo-code

## 4.26.0

### Minor Changes

- [#473](https://github.com/Kilo-Org/kilocode/pull/473) [`9be2dc0`](https://github.com/Kilo-Org/kilocode/commit/9be2dc0773a00ca254d3e2f7dc92e5e06621e4d1) Thanks [@tru-kilo](https://github.com/tru-kilo)! - Added a slash reportbug command to report bugs directly from the extension to the kilocode repo

- [#437](https://github.com/Kilo-Org/kilocode/pull/437) [`84a7f07`](https://github.com/Kilo-Org/kilocode/commit/84a7f07ef529c4c5a70926ae90fae5023b637fc9) Thanks [@tru-kilo](https://github.com/tru-kilo)! - Added a slash newrule command

- [#442](https://github.com/Kilo-Org/kilocode/pull/442) [`b1b0f58`](https://github.com/Kilo-Org/kilocode/commit/b1b0f5857a5d86ac6b8fd455171c6fcdaef31722) Thanks [@chrarnoldus](https://github.com/chrarnoldus)! - The Kilo Code Provider now supports web-based IDEs, such as FireBase Studio, through an alternative authentication flow. The user should copy and paste the API Key manually in this case.

## 4.25.0

### Minor Changes

- [#432](https://github.com/Kilo-Org/kilocode/pull/432) [`adfed7c`](https://github.com/Kilo-Org/kilocode/commit/adfed7c6df8cd9979df4ed152df8bda4017dc997) Thanks [@seuros](https://github.com/seuros)! - Support Streamable HTTP for MCP according to the [2025-03-26](https://modelcontextprotocol.io/specification/2025-03-26) spec

- [#440](https://github.com/Kilo-Org/kilocode/pull/440) [`64adc9c`](https://github.com/Kilo-Org/kilocode/commit/64adc9cc5ac5ea8cbe03305d586de24dc7a989cc) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.17.2

### Patch Changes

- [#430](https://github.com/Kilo-Org/kilocode/pull/430) [`44ed7ad`](https://github.com/Kilo-Org/kilocode/commit/44ed7adf365d1103bed76e94458f6a661b4e382e) Thanks [@drakonen](https://github.com/drakonen)! - Added a notification when using non-kilocode-rules files

- [#436](https://github.com/Kilo-Org/kilocode/pull/436) [`c6f54b7`](https://github.com/Kilo-Org/kilocode/commit/c6f54b76be170b841bfce9c36f4565f40d868979) Thanks [@RSO](https://github.com/RSO)! - Make the prompts view accessible through the topbar

- [#434](https://github.com/Kilo-Org/kilocode/pull/434) [`f38e83c`](https://github.com/Kilo-Org/kilocode/commit/f38e83c3b640772bb376504ed65804e2da921fa0) Thanks [@RSO](https://github.com/RSO)! - Fixed bug in SettingsView that caused issues with detecting/saving changes

## [4.24.0]

### Minor Changes

- [#401](https://github.com/Kilo-Org/kilocode/pull/401) [`d077452`](https://github.com/Kilo-Org/kilocode/commit/d0774527bbedad4478ce3767fae6cff7de864e50) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Add ability to attach an image from within the context menu

- Include changes from Roo Code v3.16.6

### Patch Changes

- [#386](https://github.com/Kilo-Org/kilocode/pull/386) [`5caba61`](https://github.com/Kilo-Org/kilocode/commit/5caba61f49a0f87dabf1e50fcf2b6111452a45e0) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Clearly display Kilo Code recommended models

- [#354](https://github.com/Kilo-Org/kilocode/pull/354) [`106b722`](https://github.com/Kilo-Org/kilocode/commit/106b722e747f98edb15b5a8e7a65e19db31028db) Thanks [@hassoncs](https://github.com/hassoncs)! - Fix wrong model after login (#213)

## [4.23.0]

### Minor Changes

- [#381](https://github.com/Kilo-Org/kilocode/pull/381) [`60892c8`](https://github.com/Kilo-Org/kilocode/commit/60892c86cb88ff509e5fb38a80fdfd6b85b793b7) Thanks [@kevinvandijk](https://github.com/kevinvandijk)! - Include changes from Roo Code v3.16.3

- [#303](https://github.com/Kilo-Org/kilocode/pull/303) [`b69a57e`](https://github.com/Kilo-Org/kilocode/commit/b69a57e316a740470a8be40d77dad50efde5c35c) Thanks [@drakonen](https://github.com/drakonen)! - Kilo Code Provider can now do all the OpenRouter models

## [4.22.0]

### Minor Changes

- Switch mode icons from unicode emojis to codicons

### Patch Changes

- Fixed UI Issue - Unreadable transparent section at bottom of chat textArea. Thanks to @agape-apps for reporting this issue! See [Kilo-Org/kilocode#306](https://github.com/Kilo-Org/kilocode/issues/306)
- Fix feedback button overlapping selection action button in history view

## [4.21.0]

### Minor Changes

- Include changes from Roo Code v3.15.5

### Patch Changes

- Fix issue with removed slash commands for changing modes

## [4.20.1]

### Patch Changes

- Use the phrase feature-merge instead of superset in displayName and README
- Fix "Some text unreadable in Light high contrast theme" issue

## [4.20.0]

- Include slash commands from Cline, include /newtask command

## [4.19.1]

### Patch Changes

- Fix translations for system notifications
- Include changes from Roo Code v3.14.3

## [4.19.0]

### Minor Changes

- Add easier way to add Kilo Code credit when balance is low

### Patch Changes

- Small UI improvements for dark themes

## [4.18.0]

### Minor Changes

- Include changes from Roo Code v3.14.2

### Patch Changes

- Fix settingview appearing not to save when hitting save button
- Fix dark buttons on light vscode themes (thanks @Aikiboy123)

## [4.17.0]

### Minor Changes

- Improve UI for new tasks, history and MCP servers
- Add commands for importing and exporting settings
- Include changes from Roo Code v3.13.2

### Patch Changes

- Fix chat window buttons overlapping on small sizes (thanks @Aikiboy123)
- Fix feedback button overlapping create mode button in prompts view
- Fix image thumbnails after pasting image (thanks @Aikiboy123)

## [4.16.2]

- Include Roo Code v3.12.3 changes

## [4.16.1]

- Fix http referer header

## [4.16.0]

### Minor Changes

- Add better first time experience flow

### Patch Changes

- Fix confirmation dialog not closing in settings view
- Add support for Gemini 2.5 Flash Preview for Kilo Code provider

## [4.15.0]

- Pull in updates from Roo Code v3.11.7
