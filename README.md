<!-- kilocode_change - Kilo v1 README adapted for this v2 development branch; root locale paths retained. -->
<p align="center">
  English |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="96" alt="Kilo Code" src="packages/kilo-vscode/assets/kilo.svg" /></a>
</p>

<p align="center">The open source AI coding agent — Kilo on OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> This branch is a development preview, not the released Kilo product or an in-place v1 upgrade. It preserves the original Kilo interface while migrating the runtime to v2. The preview uses separate `kilo2` storage; imports are explicit. Existing v1 data is not migrated automatically.

---

### Installation

Use Bun 1.4 or newer. From this checkout, install dependencies, then choose the CLI or VS Code workflow below. A fresh dependency installation and all platforms have not yet completed release validation. Published npm packages and Marketplace releases do not install this branch.

```sh
bun install
```

#### CLI

Open the interactive Kilo CLI. Arguments can specify a project directory, for example `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Build and open the original Kilo extension in an isolated VS Code development profile. Install VS Code locally and put `code` on PATH, or set `VSCODE_BIN`. The extension starts its local server automatically. The extension port is still incomplete.

```sh
bun run extension
```

### Agents

**Code** implements changes. **Plan** investigates, challenges assumptions, saves a plan, and offers an implementation handoff. **Ask** answers without editing files. **Debug** investigates problems. Custom agents remain configurable. Names describe behavior; available tools and permissions depend on configuration.

### What it does

Implemented slices include native conversations, tools and permissions, Gateway model/account integration, settings, memory, indexing, sandbox integration, and terminal adapters. Full original VS Code parity, JetBrains, autocomplete/FIM, speech, and some cloud workflows remain unfinished. Sharing, remote-service deployment checks, signing, and cross-platform distribution still have open gates. Source presence is not end-to-end acceptance.

### Documentation

Start with the migration plan and test plans for this branch's status. The general Kilo documentation describes the released product and may differ from this preview.

- [Migration progress (#13750)](https://github.com/Kilo-Org/kilocode/issues/13750)
- [Migration tracking](https://github.com/Kilo-Org/kilocode/tree/kilo-v2/migration-tracking)
  - [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
  - [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Contributing

Contributions are welcome. Read the contributing guide and v2 fork conventions before changing shared code. Keep Kilo behavior in owned packages where possible; verify affected packages and preserve upstream attribution.

- [Contributing](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### License

[MIT](LICENSE)

### FAQ

<details>
<summary>Where did Kilo CLI come from?</summary>

Kilo CLI is a fork of [OpenCode](https://github.com/anomalyco/opencode), enhanced to work within the Kilo agentic engineering platform.

</details>
