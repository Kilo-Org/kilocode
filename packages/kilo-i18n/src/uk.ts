export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.byok.prefix": "Для отримання додаткової статистики використання використовуйте ",
  "provider.connect.kiloGateway.byok.link": "BYOK через Kilo's Gateway",
  "provider.connect.kiloGateway.byok.suffix": ".",

  // Provider settings translations
  "settings.providers.group.recommended": "Рекомендовані",
  "settings.providers.note.kilo": "Доступ до 500+ моделей ШІ",
  "settings.providers.note.opencode": "Добірні моделі, зокрема Claude, GPT, Gemini та інші",
  "settings.providers.note.anthropic": "Прямий доступ до моделей Claude, зокрема Pro і Max",
  "settings.providers.note.deepseek": "Моделі DeepSeek для завдань міркування та програмування",
  "settings.providers.note.copilot": "Моделі Claude для допомоги з програмуванням",
  "settings.providers.note.openai": "Моделі GPT і Codex з API-ключем або входом через ChatGPT",
  "settings.providers.note.google": "Моделі Gemini для швидких структурованих відповідей",
  "settings.providers.note.openrouter": "Доступ до всіх підтримуваних моделей від одного провайдера",
  "settings.providers.note.vercel": "Єдиний доступ до моделей ШІ з розумною маршрутизацією",

  // Reasoning block label
  "ui.reasoning.label": "Міркування",

  // Marketplace
  "marketplace.card.installed": "Встановлено",
  "marketplace.card.install": "Встановити",
  "marketplace.card.remove": "Видалити",
  "marketplace.card.removeScope": "Видалити ({{scope}})",
  "marketplace.card.showMore": "Показати більше",
  "marketplace.card.showLess": "Показати менше",
  "marketplace.install.title": "Встановити {{name}}",
  "marketplace.install.scope": "Область",
  "marketplace.install.scope.project": "Проєкт",
  "marketplace.install.scope.global": "Глобально",
  "marketplace.install.scope.project.description":
    "Лише цей проєкт. Встановлені файли можна додати до системи контролю версій і надати команді.",
  "marketplace.install.scope.global.description":
    "Усі проєкти на цьому комп'ютері. Зберігається у вашій користувацькій конфігурації.",
  "marketplace.install.destination": "Місце встановлення",
  "marketplace.install.includedSkills": "Включені навички",
  "marketplace.install.about.mcp":
    "MCP-сервер надає Kilo додаткові інструменти для роботи із зовнішніми сервісами або локальними програмами.",
  "marketplace.install.about.agent": "Агент додає багаторазову роль із власними інструкціями та дозволами.",
  "marketplace.install.about.skill":
    "Навичка додає інструкції та ресурси для певних завдань, які Kilo може завантажити за потреби.",
  "marketplace.install.mcp.warning":
    "MCP-сервери можуть виконувати локальні команди або підключатися до зовнішніх сервісів. Kilo запитає дозвіл перед використанням їхніх інструментів, якщо ваші дозволи не дають змоги робити це автоматично.",
  "marketplace.install.project.warning":
    "Файли проєкту можуть бути додані до системи контролю версій. Не зберігайте тут секрети, якщо конфігурація не посилається на змінну середовища.",
  "marketplace.install.learnMore": "Дізнайтеся, як працює встановлення з Marketplace",
  "marketplace.install.learnMcp": "Докладніше про MCP",
  "marketplace.install.about.plugin":
    "Плагін додає до Kilo користувацькі інструменти та інтеграції. Плагіни виконуються з повними правами доступу.",
  "marketplace.install.plugin.warning":
    "Плагіни виконують код із повними правами доступу. Вони можуть читати й змінювати ваші файли, виконувати команди та отримувати доступ до ваших облікових даних і мережі. Встановлюйте лише плагіни, яким довіряєте.",
  "marketplace.intro":
    "Встановлюйте багаторазових агентів, навички, інструменти MCP та плагіни для одного або всіх проєктів.",
  "marketplace.intro.learnMore": "Про Marketplace",
  "marketplace.install.prerequisites": "Передумови",
  "marketplace.install.installing": "Встановлення...",
  "marketplace.install.cancel": "Скасувати",
  "marketplace.install.success": "Успішно встановлено!",
  "marketplace.install.failed": "Встановлення не вдалося",
  "marketplace.install.done": "Готово",
  "marketplace.install.close": "Закрити",
  "marketplace.install.mcp.signIn.message":
    "{{name}} встановлено, але потрібно увійти, перш ніж можна буде використовувати його інструменти.",
  "marketplace.install.mcp.signIn.button": "Увійти",
  "marketplace.install.mcp.signIn.waiting": "Очікування входу через браузер…",
  "marketplace.install.mcp.signIn.cancel": "Скасувати",
  "marketplace.install.mcp.signIn.skip": "Пізніше",
  "marketplace.install.mcp.signIn.success": "Вхід у {{name}} виконано.",
  "marketplace.install.mcp.signIn.failed": "Не вдалося увійти в {{name}}.",
  "marketplace.remove.title": "Видалити {{name}}?",
  "marketplace.remove.confirm":
    "Ви впевнені, що хочете видалити цей {{type}}? Це видалить його з вашої конфігурації {{scope}}.",
  "marketplace.remove.cancel": "Скасувати",
  "marketplace.remove.mcp.skills":
    "Це також видалить супутні навички, що належать цьому встановленню. Незалежно встановлені навички буде збережено.",
  "marketplace.remove.confirm.button": "Видалити",
  "marketplace.search": "Пошук...",
  "marketplace.filter.all": "Усі елементи",
  "marketplace.filter.notInstalled": "Не встановлено",
  "marketplace.filter.relevant": "Відповідні моєму робочому простору",
  "marketplace.empty": "Елементів не знайдено",
  "marketplace.empty.relevant": "Для цього робочого простору не знайдено відповідних елементів маркетплейсу.",
  "marketplace.badge.mcpServer": "MCP-сервер",
  "marketplace.badge.skills": "Містить навички",
  "marketplace.card.by": "від {{author}}",
  "marketplace.install.method": "Метод встановлення",
  "marketplace.install.parameters": "Параметри",
  "marketplace.install.optional": "(необов'язково)",
  "marketplace.scope.project": "проєкт",
  "marketplace.scope.global": "глобально",
  "marketplace.remove.type.mcp": "MCP-сервер",
  "marketplace.remove.type.plugin": "плагін",
  "marketplace.remove.type.skill": "навичка",
  "marketplace.remove.type.agent": "агент",
  "marketplace.remove.failed": "Не вдалося видалити {{name}}",
  "marketplace.install": "Встановити",
  "marketplace.filter.installed": "Встановлено",
  "marketplace.error.dismiss": "Закрити",
  "marketplace.warning.busyOne": "Виконується одна сесія, її буде перервано",
  "marketplace.warning.busyMany": "Виконується кілька сесій, їх буде перервано",
  "marketplace.warning.installAnyway": "Встановити все одно",
  "marketplace.warning.cancel": "Скасувати",
  "marketplace.contribute.prompt": "Бракує навички, агента, MCP-сервера або плагіна?",
  "marketplace.contribute.cta": "Зробити внесок на GitHub",
  "marketplace.migration.notice":
    "Режими замінено агентами. Якщо ви раніше встановлювали режими з маркетплейсу, видаліть їх та перевстановіть як агенти для переходу на новий формат.",

  // Plan follow-up question shown after plan_exit
  "plan.followup.header": "Реалізувати",
  "plan.followup.question": "Готові реалізувати?",
  "plan.followup.answer.newSession": "Почати нову сесію",
  "plan.followup.answer.newSession.description": "Реалізувати в новій сесії з чистим контекстом",
  "plan.followup.answer.continue": "Продовжити тут",
  "plan.followup.answer.continue.description": "Реалізувати план у цій сесії",
  "plan.followup.answer.keepRefining": "Продовжити уточнення",
  "plan.followup.answer.keepRefining.description": "Продовжити планування без реалізації наразі",

  // Slow-repo snapshot prompt
  "snapshot.slowRepo.header": "Знімок виконується повільно",
  "snapshot.slowRepo.question":
    "Ініціалізація системи знімків займає багато часу, ймовірно, через розмір репозиторію.\n\nВимкнути знімки для цього репозиторію?",
  "snapshot.slowRepo.answer.continue": "Продовжити зі знімками",
  "snapshot.slowRepo.answer.continue.description":
    "Зачекайте, поки знімок завершиться. Наступні ходи будуть швидкими, щойно початковий знімок буде створений.",
  "snapshot.slowRepo.answer.disable": "Вимкнути для цього проєкту",
  "snapshot.slowRepo.answer.disable.description":
    "Вимкніть знімки Kilo для цього проєкту. Ви втратите скасування/повторення для змін Kilo, але git продовжить відстежувати все.",

  // Edit-tool header and shell-tool section labels
  "ui.messagePart.openInDiffViewer": "Відкрити в переглядачі відмінностей",
  "ui.messagePart.openInEditor": "Відкрити в редакторі",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Це було корисно",
  "ui.message.feedback.notHelpful": "Це не було корисно",
  "ui.message.feedback.clearRating": "Очистити оцінку",
  // Chart tool card
  "ui.tool.chart": "Діаграма",
  "ui.tool.chart.invalid": "Недійсна конфігурація діаграми — мають бути вказані тип і дані",
  "ui.tool.chart.failed": "Не вдалося відобразити діаграму",
  // Browser tools: backend, observation, sensitive steps and origin grants.
  "browser.command.title": "Налаштування браузера",
  "browser.command.starting": "Kilo ще запускається. Спробуйте ще раз за мить.",
  "browser.command.description": "Показати бекенд браузера, його доступність і дозволи для джерел",
  "browser.command.backend": "Бекенд",
  "browser.command.observation": "Спостереження",
  "browser.command.sensitive": "Чутливі кроки",
  "browser.command.grants": "Дозволи для джерел",
  "browser.backend.playwright": "Вбудований браузер (Playwright)",
  "browser.backend.extension": "Розширення браузера Kilo",
  "browser.backend.off": "Вимкнено",
  "browser.backend.offHint": "Сховати браузерні інструменти від агентів",
  "browser.observation.full": "Повний знімок",
  "browser.observation.diff": "Лише зміни",
  "browser.observation.none": "Лише статус",
  "browser.sensitive.allowed": "виконувати без запиту",
  "browser.sensitive.asks": "запитати людину",
  "browser.grants.title": "Дозволи браузера для джерел",
  "browser.grants.none": "Правил для джерел ще немає",
  "browser.grants.all": "усі джерела дозволені",
  "browser.grants.everyOriginAsk": "усі джерела → запитати",
  "browser.grants.everyOriginDeny": "усі джерела → заборонити",
  "browser.grants.editHint":
    "Змініть правила в налаштуваннях Kilo Code, на вкладці «Вебінструменти», у розділі «Дозволи сайтів».",
  "browser.state.ready": "готовий",
  "browser.state.unavailable": "недоступний",
  "browser.state.readyHint": "Профіль Chromium, що належить Kilo, запускається під час першого виклику браузера",
  "browser.state.extensionHint": "Підключіть розширення браузера Kilo, щоб керувати власним браузером",
  "browser.command.usage":
    "Використовуйте /browser для налаштувань, /browser share, щоб передати цій сесії активну вкладку, або /browser adopt, щоб повторно використати останню завершену групу вкладок.",
  // Browser permission prompt: one class on one origin, or one sensitive step.
  "browser.permission.read.title": "Читати сторінки на {{origin}}",
  "browser.permission.act.title": "Клацати й вводити текст на {{origin}}",
  "browser.permission.navigate.title": "Відкривати сторінки на {{origin}}",
  "browser.permission.read.detail": "Схвалення дозволяє цій сесії читати сторінки на {{origin}} до її завершення.",
  "browser.permission.act.detail":
    "Схвалення дозволяє цій сесії клацати, вводити текст і запускати скрипти сторінки на {{origin}} до її завершення.",
  "browser.permission.navigate.detail":
    "Схвалення дозволяє цій сесії відкривати сторінки на {{origin}} до її завершення.",
  "browser.permission.frame": "Це джерело — фрейм усередині сторінки, а не сама сторінка.",
  "browser.permission.sensitive.title": "Чутливий крок браузера на {{origin}}",
  "browser.permission.sensitive.reason": "Причина: {{reason}}",
  "browser.permission.sensitive.once":
    "Схвалити цей крок може лише людина. Схвалення стосується лише цього одного кроку.",
  // `/browser share` and `/browser adopt`.
  "browser.share.title": "Поділитися активною вкладкою браузера",
  "browser.share.description": "Перемістити активну вкладку браузера до групи вкладок цієї сесії",
  "browser.share.done": "Активна вкладка тепер у групі вкладок цієї сесії.",
  "browser.adopt.title": "Повторно використати завершену групу вкладок",
  "browser.adopt.description": "Передати цій сесії останню завершену групу вкладок Kilo",
  "browser.adopt.done": "Ця сесія тепер використовує останню завершену групу вкладок.",
  "browser.adopt.none": "Немає завершеної групи вкладок для повторного використання.",
  "browser.adopt.kept": "Ця сесія вже має власні вкладки й зберігає їх.",
  "browser.adopt.unconfirmed":
    "Браузер попросили повторно використати останню завершену групу вкладок. Оновіть розширення браузера Kilo, щоб дізнатися, чи він це зробив.",
  "browser.control.notExtension":
    "Для обміну вкладками та їх повторного використання потрібне розширення браузера Kilo. Виберіть його в /browser.",
  // Notices for a browser call the user has to act on.
  "browser.notice.unavailableTitle": "Браузер недоступний",
  "browser.notice.outdatedTitle": "Розширення браузера застаріло",
  "browser.notice.stopped": "Ви зупинили браузер для цієї сесії. Виконайте /browser adopt, щоб повернути їй вкладки.",

  // Auto-approve toggle for the TUI (`/auto-approve`, Ctrl+Alt+A).
  "tui.autoApprove.title": "Перемкнути автосхвалення",
  "tui.autoApprove.description": "Автоматично схвалювати запити дозволів для цього процесу",
  "tui.autoApprove.enabled": "Автосхвалення увімкнено. Запити дозволів схвалюються автоматично.",
  "tui.autoApprove.disabled": "Автосхвалення вимкнено.",
}
