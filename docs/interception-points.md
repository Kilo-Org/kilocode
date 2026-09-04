# Точки перехвата действий агента

Инвентаризация под встраивание effect-guard. Сделана по коду форка на
`785b0bcdf7` (HEAD апстрима на 04.09.2026).

## Главное расхождение с исходным допущением

Планировалось искать `execute_command`, `write_to_file`, `apply_diff`,
`browser_action`, `use_mcp_tool` в `packages/kilo-vscode/`. **Ни одного из этих
имён в репозитории нет.** Это имена архитектуры Roo/Cline; текущий Kilo Code
построен на OpenCode, инструменты называются иначе, а исполнение живёт в
`packages/opencode/`, не в `packages/kilo-vscode/` (там расширение VS Code —
оболочка, а не исполнитель).

Проверено: `grep -r "execute_command\|write_to_file\|apply_diff\|use_mcp_tool"`
по `packages/kilo-vscode/src` и `packages/opencode` — 0 совпадений.

## Единый шлюз уже существует

Все инструменты спрашивают разрешение через **один** вызов `ctx.ask(...)`,
который сходится в `Permission.ask`:

| Слой | Файл | Что делает |
|---|---|---|
| Точка запроса | `packages/opencode/src/permission/index.ts` | `Interface.ask` — единственный вход |
| Разрешение правил | там же, `evaluate()` ≈ стр. 99 | `Wildcard.match` по `permission` и `pattern`, побеждает `findLast`, дефолт — `ask` |
| Композиция | там же, `resolve()` ≈ стр. 114 | Складывает базовый и сохранённый ruleset, `deny` всегда сильнее |
| Ключ команды | `packages/opencode/src/permission/arity.ts`, `prefix()` | Сводит команду к «понятному человеку префиксу»: `npm install`, `git config`, `cat` |

Это хорошая новость для встраивания: **шлюз не надо создавать, он есть.**

## Таблица точек

Все пути от корня репозитория. Столбец «разрешение» — строка `permission`,
по которой матчатся правила.

| Инструмент | Файл | Строка | Разрешение |
|---|---|---|---|
| Выполнение команды | `packages/opencode/src/tool/shell.ts` | 318 | `ShellID.ToolID` (bash) |
| Команда вне каталога | `packages/opencode/src/tool/shell.ts` | 300 | `external_directory` |
| Выход из песочницы | `packages/opencode/src/tool/shell.ts` | 439 | `sandbox_escalation` |
| Запись файла | `packages/opencode/src/tool/write.ts` | 64 | `edit` |
| Правка файла | `packages/opencode/src/tool/edit.ts` | 132, 181 | `edit` |
| Применение патча | `packages/opencode/src/tool/apply_patch.ts` | 232 | `edit` |
| Чтение файла | `packages/opencode/src/tool/read.ts` | 93, 246, 307 | `read` |
| Поиск по именам | `packages/opencode/src/tool/glob.ts` | 47 | `glob` |
| Поиск по содержимому | `packages/opencode/src/tool/grep.ts` | 43 | `grep` |
| Загрузка страницы | `packages/opencode/src/tool/webfetch.ts` | 42 | `webfetch` |
| Веб-поиск | `packages/opencode/src/tool/websearch.ts` | 174 | `websearch` |
| Клон репозитория | `packages/opencode/src/tool/repo_clone.ts` | 47 | `repo_clone` |
| Запуск скилла | `packages/opencode/src/tool/skill.ts` | 38 | `skill` |
| LSP | `packages/opencode/src/tool/lsp.ts` | 56 | `lsp` |
| Память | `packages/opencode/src/tool/recall.ts` | 62, 143 | `recall` |
| Список задач | `packages/opencode/src/tool/todo.ts` | 30 | `todowrite` |
| Подзадача | `packages/opencode/src/tool/task.ts` | 144 | имя не проверено |
| Code mode | `packages/opencode/src/tool/code-mode.ts` | 155 | из `entry.key` |
| **Инструменты MCP** | `packages/opencode/src/tool/registry.ts` | 194 | мост: `ask: (req) => bridge.promise(toolCtx.ask(req))` |
| Граница каталога | `packages/opencode/src/tool/external-directory.ts` | 46 | `external_directory` |

MCP-инструменты идут через тот же мост, отдельной дыры не образуют.

## Что Kilo Code уже защищает сам

Важно для PR: часть заявленного нами перекрытия **уже реализована**, и
дублировать её не нужно.

| Модуль | Файл | Покрытие |
|---|---|---|
| `ReadPermission.harden` | `src/kilocode/permission/read.ts` | `*.env`, `*.env.*` (кроме `*.env.example`) |
| `ConfigProtection` | `src/kilocode/permission/config-paths.ts` | `.kilo/`, `.kilocode/`, `kilo.json`, `opencode.json`, `AGENTS.md` |
| `ExternalDirectoryPermission` | `src/kilocode/permission/external-directory.ts` | выход за границу рабочего каталога |
| `AgentManagerPermission` | `src/kilocode/permission/agent-manager.ts` | действия менеджера агентов |
| `PermissionProvenance` | `src/kilocode/permission/provenance.ts` | объяснение, почему разрешено (`agent`/`global`/`project`/`yolo`/`session`/`manual`/`default`) |
| Песочница | `src/kilocode/sandbox/` (11 файлов, в т.ч. `network.ts`, `policy.ts`) | сетевые политики и изоляция |
| Снимки | `src/snapshot/index.ts` + `src/kilocode/snapshot/` | git-снимки и диффы для истории сессии |

### Границы существующей защиты

Замеры по коду, а не по документации:

1. **`ReadPermission.harden` ослабляет только широкие правила.** Условие —
   `PermissionRule.broad(rule)`, то есть `permission === "*" || pattern === "*"`.
   Точечное правило `read: {"*.env": "allow"}` защиту не включает. И результат
   — `ask`, не `deny`.
2. **Покрытие секретов — только `.env`.** `~/.ssh/**`, `~/.aws/**`, `*.pem`,
   `*.key`, `id_rsa`, `credentials.json`, `~/.npmrc` не покрыты.
3. **`ConfigProtection` защищает конфиги Kilo, но не класс автозапуска.**
   Вне покрытия: `.vscode/tasks.json`, `.vscode/launch.json`, `.git/hooks/**`,
   `.github/workflows/**`, `.venv/Scripts/**`, `*profile.ps1`, `.envrc`,
   `Dockerfile`, `package.json` (postinstall). Это ровно фокусный класс
   нашего кейса — «подброшенный файл автозапуска».
4. **Вердикт строится по тексту команды.** `arity.ts` сводит команду к
   префиксу, дальше матчится строка. Правило `bash: {"cat": "allow"}` разрешает
   и `cat README.md`, и `cat ~/.ssh/id_rsa` — путь в решении не участвует.
5. **Снимки существуют, но служат истории сессии**, а не вынесению вердикта:
   их результат никуда не подаётся как основание для `allow`/`deny`.

Пункты 3, 4 и 5 — и есть содержательная дельта effect-guard.

## Куда встраиваться

Kilo уже использует паттерн «ужесточающий слой»: `resolve()` в
`permission/index.ts` оборачивает базовый вердикт вызовами
`ReadPermission.harden` и `AgentManagerPermission.harden`.

Правильное встраивание — **тем же паттерном**, а не копией ядра в
`packages/kilo-vscode/src/`:

- `EffectGuardPermission.harden(permission, pattern, rule, metadata)` рядом с
  существующими в `src/kilocode/permission/`;
- вызов добавляется в `resolve()` одной строкой в существующую цепочку;
- текст команды берётся из `metadata.command`, который `shell.ts:318` уже
  кладёт в запрос;
- слой умеет только ужесточать (`allow → ask/deny`), поэтому не может
  ослабить ни одно существующее правило.

Плюсы: диффа на десяток строк вместо копии дерева, MCP и все инструменты
закрываются автоматически (у них общий `ask`), обратная совместимость
сохраняется по построению.

## Открытые вопросы

- `task.ts:144` — имя разрешения не проверено.
- Гейтинг песочницы по платформам не найден поиском по `sandbox` + `win32`;
  утверждение «на Windows изоляции нет» требует отдельной проверки, а не
  переноса из исходного задания.
- `bun install` в форке **падает** (`happy-dom@20.8.9 failed to resolve`,
  `vite@catalog: is not in the catalog`) — блокер для фаз 5–6.
