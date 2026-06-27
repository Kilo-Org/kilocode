<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a> | <strong>Čeština</strong>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Logo Kilo Code" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Open source kódovací agent pro práci s AI v prostředí VS Code, JetBrains nebo CLI.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code"><img src="https://raster.shields.io/badge/VS_Code_Marketplace-007ACC?style=flat&logo=visualstudiocode&logoColor=white" alt="VS Code Marketplace" height="20"></a>
  <a href="https://www.npmjs.com/package/@kilocode/cli"><img alt="npm" src="https://raster.shields.io/npm/v/@kilocode/cli?style=flat" height="20" /></a>
  <a href="https://x.com/kilocode"><img src="https://raster.shields.io/badge/kilocode-000000?style=flat&logo=x&logoColor=white" alt="X (Twitter)" height="20"></a>
  <a href="https://blog.kilo.ai"><img src="https://raster.shields.io/badge/Blog-555?style=flat&logo=substack&logoColor=white" alt="Blog" height="20"></a>
  <a href="https://kilo.ai/discord"><img src="https://raster.shields.io/badge/Join%20Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord" height="20"></a>
  <a href="https://www.reddit.com/r/kilocode/"><img src="https://raster.shields.io/badge/Join%20r%2Fkilocode-D84315?style=flat&logo=reddit&logoColor=white" alt="Reddit" height="20"></a>
</p>

![Kilo-in-VS-Code-and-CLI](https://github.com/user-attachments/assets/0536ca59-ed81-4512-9e05-d186187a1b52)

---

Kilo Code je AI kódovací agent, který je s vámi všude, kde pracujete: v [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) a [CLI](https://kilo.ai/cli). Je open source s otevřenými cenami. Vybíráte z více než 500 modelů, přepínáte mezi nimi uprostřed úkolu a platíte sazbu poskytovatele modelu bez přirážky. K zahájení nepotřebujete žádné API klíče.

### Instalace

Vyberte, kde chcete Kilo spouštět.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Nainstalujte přímo [rozšíření Kilo Code](vscode:extension/kilocode.kilo-code) nebo si ho stáhněte z [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Vytvořte si účet a získáte přístup k více než 500 modelům včetně GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 a Gemini 3.1 Pro Preview, vše za ceny poskytovatelů.

</details>

<details open>
<summary><strong>CLI</strong></summary>

<br>

```bash
# npm
npm install -g @kilocode/cli

# curl
curl -fsSL https://kilo.ai/cli/install | bash

# pnpm
pnpm add -g @kilocode/cli

# bun
bun add -g @kilocode/cli

# Homebrew (macOS / Linux)
brew install Kilo-Org/tap/kilo

# Arch Linux (AUR)
paru -S kilo-bin
```

Poté spusťte `kilo` v libovolném adresáři projektu.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Nainstalujte [plugin Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) z JetBrains Marketplace nebo vyhledejte "Kilo Code" v `Settings → Plugins` v libovolném JetBrains IDE.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Spouštějte Kilo z webového prohlížeče, bez lokálního počítače, na [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

Nastavte automatické AI code review pro vaše pull requesty na [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Spusťte svého stále aktivního AI agenta na [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Instalace CLI z GitHub Releases (binárních souborů)</summary>

Stáhněte nejnovější binární soubor ze [stránky Releases](https://github.com/Kilo-Org/kilocode/releases).

| Platforma | Soubor |
|---|---|
| Windows (většina PC) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Poznámky: `x64-baseline` je sestavení pro kompatibilitu se staršími CPU bez AVX. `musl` je staticky linkované sestavení pro Alpine nebo minimální Docker obrazy bez glibc. `kilo-vscode-*.vsix` je balíček rozšíření VS Code, nikoli CLI. Archivy `Source code` slouží k sestavení ze zdrojových kódů.

</details>

### Agenti

Kilo je dodáváno se specializovanými agenty, mezi kterými přepínáte podle úkolu. Můžete si také vytvářet vlastní agenty na míru.

- **Code** - Výchozí. Implementuje a upravuje kód z přirozeného jazyka.
- **Plan** - Navrhuje architekturu a píše plány implementace před tím, než je napsán jakýkoli kód.
- **Ask** - Odpovídá na otázky o vaší kódové bázi, aniž by se dotýkal souborů.
- **Debug** - Odstraňuje problémy a sleduje příčiny chyb.
- **Review** - Kontroluje vaše změny a odhaluje problémy v oblasti výkonu, bezpečnosti, stylu a pokrytí testy.

Zjistěte více o [agentech a vlastních agentech](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Co umí

- **Generování kódu** z přirozeného jazyka, napříč více soubory.
- **Inline autocomplete** s ghost-text návrhy a potvrzením klávesou Tab.
- **Samokontrola**, díky které agent kontroluje a opravuje svou vlastní práci.
- **Ovládání terminálu a prohlížeče** pro spouštění příkazů a automatizaci webu.
- **MCP marketplace** pro vyhledávání a připojování MCP serverů, které rozšiřují možnosti agenta.
- **Více než 500 modelů** s přepínáním uprostřed úkolu, abyste mohli přizpůsobit latenci, náklady a uvažování danému úkolu.

### Autonomní režim (CI/CD)

Spusťte `kilo run` s přepínačem `--auto` pro plně autonomní provoz bez výzev, určený pro CI/CD pipeline:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` vypíná všechny výzvy k povolení a umožňuje agentovi provádět jakoukoli akci bez potvrzení. Používejte pouze v důvěryhodném prostředí.

### Dokumentace

Konfiguraci a vše ostatní najdete v [dokumentaci](https://kilo.ai/docs).

### Příspěvky

Příspěvky jsou vítány od vývojářů, autorů i všech ostatních. Začněte s [Contributing Guide](/CONTRIBUTING.md) pro nastavení prostředí, standardy kódování a postup otevření pull requestu. Proces vydávání rozšíření VS Code a CLI naleznete v [RELEASING.md](RELEASING.md) a pro JetBrains plugin v [packages/kilo-jetbrains/RELEASING.md](packages/kilo-jetbrains/RELEASING.md).

Před zapojením si prosím přečtěte náš [Code of Conduct](/CODE_OF_CONDUCT.md).

### Licence

MIT. Tento kód můžete volně používat, upravovat a distribuovat, včetně komerčního využití, pokud zachováte informace o autorství a licenci. Viz [License](/LICENSE).

### FAQ

<details>
<summary>Odkud pochází Kilo CLI?</summary>

Kilo CLI je fork [OpenCode](https://github.com/anomalyco/opencode), rozšířený pro práci v rámci platformy Kilo agentic engineering.

</details>

---

**Připojte se ke komunitě** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)