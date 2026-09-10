<!-- kilocode_change - Kilo v1 README adapted for this v2 development branch; root locale paths retained. -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  Français |
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

<p align="center">L’agent de programmation IA open source — Kilo sur OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Cette branche est une préversion de développement, pas le produit Kilo publié ni une mise à niveau directe de v1. Elle conserve l’interface Kilo d’origine tout en migrant le moteur vers v2. Le stockage `kilo2` est séparé et les imports sont explicites. Les données v1 ne sont pas migrées automatiquement.

---

### Installation

Utilisez Bun 1.4 ou une version ultérieure. Installez les dépendances depuis ce dépôt, puis choisissez la CLI ou VS Code. L’installation à neuf et toutes les plateformes n’ont pas encore terminé la validation de publication. Les paquets npm et les versions du Marketplace n’installent pas cette branche.

```sh
bun install
```

#### CLI

Ouvrez la CLI interactive Kilo. Vous pouvez préciser un projet, par exemple `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Compilez et ouvrez l’extension Kilo d’origine dans un profil de développement VS Code isolé. Installez VS Code et ajoutez `code` au PATH, ou définissez `VSCODE_BIN`. L’extension démarre automatiquement son serveur local. Son portage reste incomplet.

```sh
bun run extension
```

### Agents

**Code** implémente les changements. **Plan** analyse, remet les hypothèses en question, enregistre un plan et propose le passage à l’implémentation. **Ask** répond sans modifier les fichiers. **Debug** recherche les problèmes. Les agents personnalisés restent configurables. Outils et permissions dépendent de la configuration.

### Fonctionnalités

Des parties des conversations natives, outils et permissions, modèles et comptes Gateway, paramètres, mémoire, indexation, isolation et terminaux sont implémentées. La parité complète de VS Code, JetBrains, l’autocomplétion/FIM, la voix et certains parcours cloud restent à terminer. Le partage, la validation des services déployés, la signature et la distribution multiplateforme restent ouverts. La présence du code ne prouve pas la validation de bout en bout.

### Documentation

Consultez le plan de migration et les plans de tests pour l’état de cette branche. La documentation générale de Kilo décrit le produit publié et peut différer de cette préversion.

- [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
- [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Contribuer

Les contributions sont bienvenues. Lisez le guide de contribution et les conventions du fork v2 avant de modifier le code partagé. Placez autant que possible le comportement Kilo dans ses propres paquets, vérifiez les paquets concernés et conservez l’attribution du projet amont.

- [Contribuer](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### Licence

[MIT](LICENSE)

### FAQ

<details>
<summary>D'où vient Kilo CLI ?</summary>

Kilo CLI est un fork d'[OpenCode](https://github.com/anomalyco/opencode), amélioré pour fonctionner au sein de la plateforme d'ingénierie agentique Kilo.

</details>
