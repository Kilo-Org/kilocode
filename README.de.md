<!-- kilocode_change - Kilo v1 README adapted for this v2 development branch; root locale paths retained. -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  Deutsch |
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

<p align="center">Der quelloffene KI-Programmieragent — Kilo auf OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Dieser Branch ist eine Entwicklungsvorschau, nicht das veröffentlichte Kilo-Produkt oder ein direktes v1-Upgrade. Die ursprüngliche Kilo-Oberfläche bleibt erhalten, während die Laufzeit auf v2 umgestellt wird. Die Vorschau nutzt getrennten `kilo2`-Speicher; Importe erfolgen ausdrücklich. Vorhandene v1-Daten werden nicht automatisch migriert.

---

### Installation

Verwende Bun 1.4 oder neuer. Installiere in diesem Checkout die Abhängigkeiten und wähle anschließend CLI oder VS Code. Eine frische Installation und alle Plattformen haben die Freigabeprüfung noch nicht vollständig durchlaufen. Veröffentlichte npm-Pakete und Marketplace-Versionen installieren diesen Branch nicht.

```sh
bun install
```

#### CLI

Öffne die interaktive Kilo-CLI. Ein Projektverzeichnis kann angegeben werden, zum Beispiel `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Baue und öffne die ursprüngliche Kilo-Erweiterung in einem isolierten VS-Code-Entwicklungsprofil. Installiere VS Code und füge `code` zum PATH hinzu oder setze `VSCODE_BIN`. Die Erweiterung startet ihren lokalen Server automatisch. Die Portierung ist noch unvollständig.

```sh
bun run extension
```

### Agenten

**Code** setzt Änderungen um. **Plan** untersucht, hinterfragt Annahmen, speichert einen Plan und bietet den Übergang zur Umsetzung an. **Ask** antwortet ohne Dateiänderungen. **Debug** untersucht Probleme. Eigene Agenten bleiben konfigurierbar. Werkzeuge und Berechtigungen hängen von der Konfiguration ab.

### Funktionen

Teile der nativen Gespräche, Werkzeuge und Berechtigungen, Gateway-Modelle und Konten, Einstellungen, Speicherfunktionen, Indexierung, Sandbox und Terminals sind implementiert. Vollständige VS-Code-Parität, JetBrains, Autovervollständigung/FIM, Sprache und einige Cloud-Abläufe fehlen noch. Freigaben bestehen noch für Teilen, bereitgestellte Dienste, Signierung und plattformübergreifende Distribution. Vorhandener Quellcode ist kein Ende-zu-Ende-Nachweis.

### Dokumentation

Der Migrationsplan und die Testpläne beschreiben den Stand dieses Branches. Die allgemeine Kilo-Dokumentation beschreibt das veröffentlichte Produkt und kann von dieser Vorschau abweichen.

- [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
- [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Mitwirken

Beiträge sind willkommen. Lies vor Änderungen am gemeinsamen Code den Beitragsleitfaden und die v2-Fork-Konventionen. Halte Kilo-Verhalten möglichst in eigenen Paketen, prüfe betroffene Pakete und bewahre die Herkunftshinweise des Upstream-Projekts.

- [Mitwirken](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### Lizenz

[MIT](LICENSE)

### FAQ

<details>
<summary>Woher stammt Kilo CLI?</summary>

Kilo CLI ist ein Fork von [OpenCode](https://github.com/anomalyco/opencode), erweitert für die Kilo-Agentic-Engineering-Plattform.

</details>
