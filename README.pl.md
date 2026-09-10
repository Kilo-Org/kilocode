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
  Polski |
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

<p align="center">Otwarty agent programistyczny AI — Kilo na OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Ta gałąź jest wersją rozwojową, a nie wydanym produktem Kilo ani aktualizacją zastępującą v1. Zachowuje oryginalny interfejs Kilo podczas migracji środowiska wykonawczego do v2. Używa osobnego magazynu `kilo2`; import wymaga jawnego działania. Dane v1 nie są migrowane automatycznie.

---

### Instalacja

Użyj Bun 1.4 lub nowszego. Zainstaluj zależności w tym repozytorium, a następnie wybierz CLI lub VS Code. Czysta instalacja i wszystkie platformy nie przeszły jeszcze pełnej walidacji wydania. Opublikowane pakiety npm i wersje Marketplace nie instalują tej gałęzi.

```sh
bun install
```

#### CLI

Uruchom interaktywne CLI Kilo. Możesz podać katalog projektu, np. `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Zbuduj i otwórz oryginalne rozszerzenie Kilo w odizolowanym profilu deweloperskim VS Code. Zainstaluj VS Code i dodaj `code` do PATH lub ustaw `VSCODE_BIN`. Rozszerzenie automatycznie uruchamia lokalny serwer. Portowanie nadal jest niekompletne.

```sh
bun run extension
```

### Agenci

**Code** implementuje zmiany. **Plan** bada problem, podważa założenia, zapisuje plan i proponuje przejście do implementacji. **Ask** odpowiada bez edycji plików. **Debug** diagnozuje problemy. Można konfigurować własnych agentów. Narzędzia i uprawnienia zależą od konfiguracji.

### Co robi

Zaimplementowano części rozmów natywnych, narzędzi i uprawnień, integracji modeli i kont Gateway, ustawień, pamięci, indeksowania, piaskownicy i terminali. Pełna zgodność VS Code, JetBrains, autouzupełnianie/FIM, mowa i część procesów chmurowych pozostają nieukończone. Udostępnianie, weryfikacja wdrożonych usług, podpisywanie i dystrybucja wieloplatformowa mają otwarte wymagania. Obecność kodu nie oznacza akceptacji end-to-end.

### Dokumentacja

Stan gałęzi opisują plan migracji i plany testów. Ogólna dokumentacja Kilo dotyczy wydanego produktu i może różnić się od tej wersji rozwojowej.

- [Postęp migracji (#13750)](https://github.com/Kilo-Org/kilocode/issues/13750)
- [Śledzenie migracji](https://github.com/Kilo-Org/kilocode/tree/kilo-v2/migration-tracking)
  - [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
  - [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Wkład

Zapraszamy do współpracy. Przed zmianą wspólnego kodu przeczytaj przewodnik dla współtwórców i zasady forka v2. W miarę możliwości umieszczaj logikę Kilo we własnych pakietach, sprawdzaj zmienione pakiety i zachowuj informacje o autorstwie projektu upstream.

- [Wkład](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### Licencja

[MIT](LICENSE)

### FAQ

<details>
<summary>Skąd pochodzi Kilo CLI?</summary>

Kilo CLI jest forkiem [OpenCode](https://github.com/anomalyco/opencode), rozszerzonym do działania w platformie agentic engineering Kilo.

</details>
