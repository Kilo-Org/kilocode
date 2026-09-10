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
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  Українська |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="96" alt="Kilo Code" src="packages/kilo-vscode/assets/kilo.svg" /></a>
</p>

<p align="center">Відкритий ШІ-агент для програмування — Kilo на OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Ця гілка — попередня версія для розробки, а не випущений продукт Kilo чи оновлення поверх v1. Вона зберігає оригінальний інтерфейс Kilo, переносячи середовище виконання на v2. Використовується окреме сховище `kilo2`; імпорт виконується явно. Дані v1 не переносяться автоматично.

---

### Встановлення

Використовуйте Bun 1.4 або новішу версію. Встановіть залежності в цій копії репозиторію та виберіть CLI або VS Code. Чисте встановлення й усі платформи ще не пройшли повної перевірки готовності до випуску. Опубліковані пакети npm і версії Marketplace не встановлюють цю гілку.

```sh
bun install
```

#### CLI

Відкрийте інтерактивний CLI Kilo. Можна вказати каталог проєкту, наприклад `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Зберіть і відкрийте оригінальне розширення Kilo в ізольованому профілі розробки VS Code. Встановіть VS Code та додайте `code` до PATH або задайте `VSCODE_BIN`. Розширення автоматично запускає локальний сервер. Перенесення ще не завершене.

```sh
bun run extension
```

### Агенти

**Code** реалізує зміни. **Plan** досліджує завдання, перевіряє припущення, зберігає план і пропонує перехід до реалізації. **Ask** відповідає без редагування файлів. **Debug** досліджує проблеми. Власні агенти залишаються налаштовуваними. Інструменти й дозволи залежать від конфігурації.

### Що він робить

Реалізовано частини нативних розмов, інструментів і дозволів, інтеграції моделей та облікових записів Gateway, налаштувань, пам’яті, індексації, пісочниці й терміналів. Повна відповідність оригінальному VS Code, JetBrains, автодоповнення/FIM, мовлення та деякі хмарні сценарії ще не завершені. Залишаються вимоги до обміну сесіями, перевірки розгорнутих сервісів, підписування та багатоплатформного розповсюдження. Наявність коду не означає наскрізного приймання.

### Документація

Стан гілки описують план міграції та плани тестування. Загальна документація Kilo стосується випущеного продукту й може відрізнятися від цієї попередньої версії.

- [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
- [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Участь

Запрошуємо долучатися. Перед змінами спільного коду прочитайте посібник учасника й правила форку v2. За можливості розміщуйте логіку Kilo у власних пакетах, перевіряйте змінені пакети та зберігайте відомості про авторство upstream-проєкту.

- [Участь](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### Ліцензія

[MIT](LICENSE)

### FAQ

<details>
<summary>Звідки взявся Kilo CLI?</summary>

Kilo CLI — це fork [OpenCode](https://github.com/anomalyco/opencode), розширений для роботи в платформі agentic engineering Kilo.

</details>
