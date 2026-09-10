<!-- kilocode_change - Kilo v1 README adapted for this v2 development branch; root locale paths retained. -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  Dansk |
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

<p align="center">Den åbne AI-kodningsagent — Kilo på OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Denne gren er en udviklingspreview, ikke det udgivne Kilo-produkt eller en direkte v1-opgradering. Den oprindelige Kilo-grænseflade bevares, mens runtime flyttes til v2. Previewen bruger separat `kilo2`-lagring og eksplicit import. Eksisterende v1-data migreres ikke automatisk.

---

### Installation

Brug Bun 1.4 eller nyere. Installér afhængighederne fra denne checkout, og vælg CLI eller VS Code. Nyinstallation og alle platforme har endnu ikke gennemført udgivelsesvalidering. Udgivne npm-pakker og Marketplace-versioner installerer ikke denne gren.

```sh
bun install
```

#### CLI

Åbn Kilos interaktive CLI. Angiv eventuelt en projektmappe, for eksempel `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Byg og åbn den oprindelige Kilo-udvidelse i en isoleret VS Code-udviklingsprofil. Installér VS Code, og føj `code` til PATH, eller sæt `VSCODE_BIN`. Udvidelsen starter automatisk sin lokale server. Porteringen er stadig ufuldstændig.

```sh
bun run extension
```

### Agenter

**Code** implementerer ændringer. **Plan** undersøger, udfordrer antagelser, gemmer en plan og tilbyder overdragelse til implementering. **Ask** svarer uden at redigere filer. **Debug** undersøger problemer. Egne agenter kan konfigureres. Værktøjer og tilladelser afhænger af konfigurationen.

### Hvad den gør

Dele af samtaler, værktøjer, tilladelser, Gateway-modeller og konti, indstillinger, hukommelse, indeksering, sandbox og terminaler er implementeret. Fuld VS Code-paritet, JetBrains, autofuldførelse/FIM, tale og visse cloudforløb mangler stadig. Deling, kontrol af udrullede tjenester, signering og distribution på tværs af platforme har åbne krav. Kildekode alene er ikke en ende-til-ende-godkendelse.

### Dokumentation

Se migrationsplanen og testplanerne for denne grens status. Kilos generelle dokumentation beskriver det udgivne produkt og kan afvige fra previewen.

- [Migreringsstatus (#13750)](https://github.com/Kilo-Org/kilocode/issues/13750)
- [Migreringsoversigt](https://github.com/Kilo-Org/kilocode/tree/kilo-v2/migration-tracking)
  - [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
  - [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Bidrag

Bidrag er velkomne. Læs bidragsvejledningen og v2-forkens konventioner før ændringer i fælles kode. Placér om muligt Kilo-adfærd i egne pakker, kontrollér berørte pakker, og bevar krediteringen af upstream-projektet.

- [Bidrag](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### Licens

[MIT](LICENSE)

### FAQ

<details>
<summary>Hvor kommer Kilo CLI fra?</summary>

Kilo CLI er en fork af [OpenCode](https://github.com/anomalyco/opencode), forbedret til at fungere i Kilo agentic engineering-platformen.

</details>
