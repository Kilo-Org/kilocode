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
  Bosanski |
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

<p align="center">AI agent za programiranje otvorenog koda — Kilo na OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Ova grana je razvojna pretpregledna verzija, a ne objavljeni Kilo proizvod ili direktna nadogradnja v1. Zadržava izvorni Kilo interfejs dok se izvršno okruženje prenosi na v2. Koristi odvojenu `kilo2` pohranu; uvoz se pokreće izričito. Podaci iz v1 ne prenose se automatski.

---

### Instalacija

Koristite Bun 1.4 ili noviji. Instalirajte zavisnosti iz ove kopije repozitorija i odaberite CLI ili VS Code. Nova instalacija i sve platforme još nisu završile provjeru za izdavanje. Objavljeni npm paketi i Marketplace verzije ne instaliraju ovu granu.

```sh
bun install
```

#### CLI

Otvorite interaktivni Kilo CLI. Možete navesti direktorij projekta, npr. `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Izgradite i otvorite izvorno Kilo proširenje u izolovanom razvojnom profilu VS Codea. Instalirajte VS Code i dodajte `code` u PATH ili postavite `VSCODE_BIN`. Proširenje automatski pokreće lokalni server. Prijenos još nije završen.

```sh
bun run extension
```

### Agenti

**Code** implementira promjene. **Plan** istražuje, preispituje pretpostavke, sprema plan i nudi prelazak na implementaciju. **Ask** odgovara bez uređivanja datoteka. **Debug** istražuje probleme. Moguće je konfigurirati vlastite agente. Alati i dozvole zavise od konfiguracije.

### Šta radi

Implementirani su dijelovi nativnih razgovora, alata i dozvola, Gateway modela i računa, postavki, memorije, indeksiranja, izolacije i terminala. Potpuna jednakost VS Code funkcija, JetBrains, automatsko dovršavanje/FIM, govor i neki tokovi u oblaku još nisu završeni. Dijeljenje, provjera postavljenih servisa, potpisivanje i višeplatformska distribucija imaju otvorene zahtjeve. Prisustvo koda nije dokaz provjere od početka do kraja.

### Dokumentacija

Status grane potražite u planu migracije i planovima testiranja. Opća Kilo dokumentacija opisuje objavljeni proizvod i može se razlikovati od ove verzije.

- [Napredak migracije (#13750)](https://github.com/Kilo-Org/kilocode/issues/13750)
- [Praćenje migracije](https://github.com/Kilo-Org/kilocode/tree/kilo-v2/migration-tracking)
  - [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
  - [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Doprinos

Doprinosi su dobrodošli. Prije promjene zajedničkog koda pročitajte vodič za doprinos i pravila v2 forka. Kada je moguće, držite Kilo logiku u vlastitim paketima, provjerite pogođene pakete i sačuvajte podatke o autorstvu izvornog projekta.

- [Doprinos](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### Licenca

[MIT](LICENSE)

### FAQ

<details>
<summary>Odakle dolazi Kilo CLI?</summary>

Kilo CLI je fork [OpenCode](https://github.com/anomalyco/opencode), poboljšan za rad unutar Kilo agentic engineering platforme.

</details>
