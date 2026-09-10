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
  Русский |
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

<p align="center">Открытый ИИ-агент для программирования — Kilo на OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Эта ветка — предварительная версия для разработки, а не выпущенный продукт Kilo и не обновление поверх v1. Она сохраняет исходный интерфейс Kilo, переводя среду выполнения на v2. Используется отдельное хранилище `kilo2`; импорт выполняется явно. Данные v1 не переносятся автоматически.

---

### Установка

Используйте Bun 1.4 или новее. Установите зависимости в этой копии репозитория и выберите CLI или VS Code. Чистая установка и все платформы ещё не прошли полную проверку готовности к выпуску. Опубликованные пакеты npm и версии Marketplace не устанавливают эту ветку.

```sh
bun install
```

#### CLI

Откройте интерактивный CLI Kilo. Можно указать каталог проекта, например `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Соберите и откройте исходное расширение Kilo в изолированном профиле разработки VS Code. Установите VS Code и добавьте `code` в PATH или задайте `VSCODE_BIN`. Расширение автоматически запускает локальный сервер. Перенос расширения ещё не завершён.

```sh
bun run extension
```

### Агенты

**Code** реализует изменения. **Plan** исследует задачу, проверяет предположения, сохраняет план и предлагает перейти к реализации. **Ask** отвечает без редактирования файлов. **Debug** исследует проблемы. Можно настраивать собственных агентов. Доступные инструменты и разрешения зависят от конфигурации.

### Возможности

Реализованы части нативных диалогов, инструментов и разрешений, интеграции моделей и аккаунтов Gateway, настроек, памяти, индексации, песочницы и терминалов. Полная совместимость исходного VS Code, JetBrains, автодополнение/FIM, речь и некоторые облачные сценарии ещё не завершены. Открыты проверки обмена сессиями, развёрнутых сервисов, подписи и многоплатформенной поставки. Наличие кода не означает сквозную приёмку.

### Документация

Состояние ветки отражено в плане миграции и планах тестирования. Общая документация Kilo описывает выпущенный продукт и может отличаться от этой предварительной версии.

- [Ход миграции (#13750)](https://github.com/Kilo-Org/kilocode/issues/13750)
- [Отслеживание миграции](https://github.com/Kilo-Org/kilocode/tree/kilo-v2/migration-tracking)
  - [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
  - [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Участие

Мы приветствуем вклад в проект. Перед изменением общего кода прочитайте руководство участника и правила форка v2. По возможности размещайте логику Kilo в собственных пакетах, проверяйте затронутые пакеты и сохраняйте сведения об авторстве upstream-проекта.

- [Участие](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### Лицензия

[MIT](LICENSE)

### FAQ

<details>
<summary>Откуда появился Kilo CLI?</summary>

Kilo CLI — это fork [OpenCode](https://github.com/anomalyco/opencode), расширенный для работы в платформе agentic engineering Kilo.

</details>
