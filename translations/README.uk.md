<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | Українська | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">Open source-агент для програмування з AI у VS Code, JetBrains або CLI.</p>

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

Kilo Code — це AI-агент для програмування, який працює там, де працюєте ви: у [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) і [CLI](https://kilo.ai/cli). Він має відкритий код і відкриту модель ціноутворення. Ви обираєте з понад 500 моделей, перемикаєтеся між ними під час завдання і платите тариф постачальника моделі без націнки. Для старту API-ключі не потрібні.

### Встановлення

Оберіть, де ви хочете запускати Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Встановіть [розширення Kilo Code](vscode:extension/kilocode.kilo-code) напряму або завантажте його з [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Створіть обліковий запис і отримайте доступ до понад 500 моделей, зокрема GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 і Gemini 3.1 Pro Preview, усі за цінами постачальників.

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

Потім запустіть `kilo` у будь-якому каталозі проєкту.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Встановіть [плагін Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) з JetBrains Marketplace або знайдіть "Kilo Code" у `Settings → Plugins` у будь-якій JetBrains IDE.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Запускайте Kilo з вебу, без локальної машини, на [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Code Reviews</strong></summary>

<br>

Налаштуйте автоматичні AI-рев'ю коду для ваших pull request на [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Запустіть свого постійно активного AI-агента на [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Встановити CLI з GitHub Releases (бінарні файли)</summary>

Завантажте найновіший бінарний файл зі [сторінки Releases](https://github.com/Kilo-Org/kilocode/releases).

| Платформа | Файл |
|---|---|
| Windows (більшість ПК) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Примітки: `x64-baseline` — сумісна збірка для старих CPU без AVX. `musl` — статично зв'язана збірка для Alpine або мінімальних Docker-образів без glibc. `kilo-vscode-*.vsix` — пакет розширення VS Code, а не CLI. Архіви `Source code` призначені для збірки з вихідного коду.

</details>

### Agents

Kilo постачається зі спеціалізованими agents, між якими можна перемикатися залежно від завдання. Ви також можете створювати власні agents.

- **Code** - Типовий. Реалізує та редагує код з природної мови.
- **Plan** - Проєктує архітектуру і пише плани реалізації до написання коду.
- **Ask** - Відповідає на запитання про кодову базу, не змінюючи файли.
- **Debug** - Діагностує та відстежує проблеми.
- **Review** - Переглядає ваші зміни та виявляє проблеми продуктивності, безпеки, стилю і покриття тестами.

Дізнайтеся більше про [agents і власні agents](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Що він робить

- **Генерація коду** з природної мови в кількох файлах.
- **Вбудоване автодоповнення** з ghost-text-підказками та прийняттям через Tab.
- **Самоперевірка**, щоб агент перевіряв і виправляв власну роботу.
- **Керування терміналом і браузером** для запуску команд і автоматизації вебу.
- **MCP marketplace** для пошуку й підключення MCP-серверів, які розширюють можливості агента.
- **Понад 500 моделей** з перемиканням під час завдання, щоб узгодити затримку, вартість і reasoning з роботою.

### Автономний режим (CI/CD)

Запустіть `kilo run` з `--auto` для повністю автономної роботи без prompts, створеної для CI/CD-пайплайнів:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` вимикає всі запити дозволів і дає агенту змогу виконувати будь-яку дію без підтвердження. Використовуйте лише в довірених середовищах.

### Документація

Для налаштування та всього іншого перегляньте [документацію](https://kilo.ai/docs).

### Участь

Ми вітаємо внески від розробників, авторів і всіх охочих. Почніть з [Contributing Guide](/CONTRIBUTING.md), щоб налаштувати середовище, ознайомитися зі стандартами коду та дізнатися, як відкрити pull request. Див. [RELEASING.md](../RELEASING.md) для процесу релізу розширення VS Code і CLI, а також [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) для плагіна JetBrains.

Перед участю прочитайте наш [Code of Conduct](/CODE_OF_CONDUCT.md).

### Ліцензія

MIT. Ви можете використовувати, змінювати й поширювати цей код, зокрема комерційно, якщо зберігаєте зазначення авторства та ліцензійні повідомлення. Див. [License](/LICENSE).

### FAQ

<details>
<summary>Звідки взявся Kilo CLI?</summary>

Kilo CLI — це fork [OpenCode](https://github.com/anomalyco/opencode), розширений для роботи в платформі agentic engineering Kilo.

</details>

---

**Долучайтеся до спільноти** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
