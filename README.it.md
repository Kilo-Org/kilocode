<!-- kilocode_change - Kilo v1 README adapted for this v2 development branch; root locale paths retained. -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  Italiano |
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

<p align="center">L’agente di programmazione IA open source — Kilo su OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Questo ramo è un’anteprima di sviluppo, non il prodotto Kilo pubblicato né un aggiornamento diretto da v1. Conserva l’interfaccia originale di Kilo mentre migra il runtime a v2. Usa uno spazio dati `kilo2` separato; le importazioni sono esplicite. I dati v1 non vengono migrati automaticamente.

---

### Installazione

Usa Bun 1.4 o successivo. Installa le dipendenze da questo checkout, poi scegli CLI o VS Code. L’installazione da zero e tutte le piattaforme non hanno ancora completato la validazione di rilascio. I pacchetti npm pubblicati e le versioni Marketplace non installano questo ramo.

```sh
bun install
```

#### CLI

Apri la CLI interattiva di Kilo. Puoi specificare una cartella di progetto, ad esempio `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Compila e apri l’estensione Kilo originale in un profilo di sviluppo VS Code isolato. Installa VS Code e aggiungi `code` al PATH, oppure imposta `VSCODE_BIN`. L’estensione avvia automaticamente il server locale. Il porting è ancora incompleto.

```sh
bun run extension
```

### Agenti

**Code** implementa modifiche. **Plan** analizza, mette in discussione le ipotesi, salva un piano e propone il passaggio all’implementazione. **Ask** risponde senza modificare file. **Debug** indaga sui problemi. Gli agenti personalizzati restano configurabili. Strumenti e permessi dipendono dalla configurazione.

### Cosa fa

Sono implementate parti di conversazioni native, strumenti e permessi, modelli e account Gateway, impostazioni, memoria, indicizzazione, sandbox e terminali. Restano incompleti la piena parità VS Code, JetBrains, completamento/FIM, voce e alcuni flussi cloud. Condivisione, verifica dei servizi distribuiti, firma e distribuzione multipiattaforma hanno ancora requisiti aperti. La presenza del codice non dimostra la validazione end-to-end.

### Documentazione

Consulta il piano di migrazione e i piani di test per lo stato di questo ramo. La documentazione generale di Kilo descrive il prodotto pubblicato e può differire dall’anteprima.

- [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
- [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Contribuire

I contributi sono benvenuti. Leggi la guida ai contributi e le convenzioni del fork v2 prima di modificare codice condiviso. Mantieni il comportamento Kilo nei pacchetti dedicati quando possibile, verifica i pacchetti interessati e conserva l’attribuzione al progetto originale.

- [Contribuire](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### Licenza

[MIT](LICENSE)

### FAQ

<details>
<summary>Da dove viene Kilo CLI?</summary>

Kilo CLI è un fork di [OpenCode](https://github.com/anomalyco/opencode), migliorato per funzionare nella piattaforma di ingegneria agentica Kilo.

</details>
