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
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  Norsk |
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

<p align="center">Den åpne AI-kodingsagenten — Kilo på OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Denne grenen er en utviklingsforhåndsvisning, ikke det utgitte Kilo-produktet eller en direkte v1-oppgradering. Det opprinnelige Kilo-grensesnittet beholdes mens kjøremiljøet flyttes til v2. Forhåndsvisningen bruker separat `kilo2`-lagring og eksplisitt import. Eksisterende v1-data migreres ikke automatisk.

---

### Installasjon

Bruk Bun 1.4 eller nyere. Installer avhengigheter fra denne utsjekkingen, og velg CLI eller VS Code. Nyinstallasjon og alle plattformer har ennå ikke fullført utgivelsesvalidering. Publiserte npm-pakker og Marketplace-versjoner installerer ikke denne grenen.

```sh
bun install
```

#### CLI

Åpne Kilos interaktive CLI. Du kan angi en prosjektmappe, for eksempel `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Bygg og åpne den opprinnelige Kilo-utvidelsen i en isolert VS Code-utviklingsprofil. Installer VS Code og legg `code` i PATH, eller sett `VSCODE_BIN`. Utvidelsen starter sin lokale server automatisk. Porteringen er fortsatt ufullstendig.

```sh
bun run extension
```

### Agenter

**Code** implementerer endringer. **Plan** undersøker, utfordrer antakelser, lagrer en plan og tilbyr overgang til implementering. **Ask** svarer uten å redigere filer. **Debug** undersøker problemer. Egne agenter kan konfigureres. Verktøy og tillatelser avhenger av konfigurasjonen.

### Hva den gjør

Deler av samtaler, verktøy, tillatelser, Gateway-modeller og kontoer, innstillinger, minne, indeksering, sandkasse og terminaler er implementert. Full VS Code-paritet, JetBrains, autofullføring/FIM, tale og enkelte skyflyter gjenstår. Deling, validering av utrullede tjenester, signering og distribusjon på alle plattformer har åpne krav. Kildekode alene er ikke ende-til-ende-godkjenning.

### Dokumentasjon

Se migreringsplanen og testplanene for status på denne grenen. Kilos generelle dokumentasjon beskriver det utgitte produktet og kan avvike fra forhåndsvisningen.

- [Migreringsstatus (#13750)](https://github.com/Kilo-Org/kilocode/issues/13750)
- [Migreringsoversikt](https://github.com/Kilo-Org/kilocode/tree/kilo-v2/migration-tracking)
  - [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
  - [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Bidra

Bidrag er velkomne. Les bidragsveiledningen og v2-forkens konvensjoner før du endrer felles kode. Legg Kilo-atferd i egne pakker der det er mulig, kontroller berørte pakker og behold opphavsangivelsen til upstream-prosjektet.

- [Bidra](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### Lisens

[MIT](LICENSE)

### FAQ

<details>
<summary>Hvor kommer Kilo CLI fra?</summary>

Kilo CLI er en fork av [OpenCode](https://github.com/anomalyco/opencode), forbedret for å fungere i Kilo agentic engineering-plattformen.

</details>
