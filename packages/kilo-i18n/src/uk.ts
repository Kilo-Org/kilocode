export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.line1":
    "Kilo Gateway надає доступ до добірки надійних оптимізованих моделей для агентів кодування.",
  "provider.connect.kiloGateway.line2":
    "За допомогою одного API-ключа ви отримаєте доступ до таких моделей, як Claude, GPT, Gemini, GLM та інших.",
  "provider.connect.kiloGateway.visit.prefix": "Відвідайте ",
  "provider.connect.kiloGateway.visit.link": "kilo.ai",
  "provider.connect.kiloGateway.visit.suffix": " щоб отримати свій API-ключ.",
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
  "ui.permission.run": "Виконати",
  "ui.reasoning.label": "Міркування",

  // Marketplace
  "marketplace.tab.skills": "Навички",
  "marketplace.tab.mcpServers": "MCP-сервери",
  "marketplace.category.all": "Усі",
  "marketplace.placeholder": "Буде реалізовано",
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
  "marketplace.install.prerequisites": "Передумови",
  "marketplace.install.installing": "Встановлення...",
  "marketplace.install.cancel": "Скасувати",
  "marketplace.install.success": "Успішно встановлено!",
  "marketplace.install.failed": "Встановлення не вдалося",
  "marketplace.install.done": "Готово",
  "marketplace.install.close": "Закрити",
  "marketplace.remove.title": "Видалити {{name}}?",
  "marketplace.remove.confirm":
    "Ви впевнені, що хочете видалити цей {{type}}? Це видалить його з вашої конфігурації {{scope}}.",
  "marketplace.remove.cancel": "Скасувати",
  "marketplace.remove.confirm.button": "Видалити",
  "marketplace.tab.mcp": "MCP",
  "marketplace.tab.agents": "Агенти",
  "marketplace.search": "Пошук...",
  "marketplace.filter.all": "Усі елементи",
  "marketplace.filter.notInstalled": "Не встановлено",
  "marketplace.empty": "Елементів не знайдено",
  "marketplace.badge.mcpServer": "MCP-сервер",
  "marketplace.badge.mode": "Режим",
  "marketplace.card.by": "від {{author}}",
  "marketplace.install.method": "Метод встановлення",
  "marketplace.install.parameters": "Параметри",
  "marketplace.install.optional": "(необов'язково)",
  "marketplace.install.required": "{{name}} є обов'язковим",
  "marketplace.scope.project": "проєкт",
  "marketplace.scope.global": "глобально",
  "marketplace.remove.type.mcp": "MCP-сервер",
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
  "marketplace.contribute.prompt": "Бракує навички, агента або MCP-сервера?",
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
  "ui.messagePart.shell.command": "Команда",
  "ui.messagePart.shell.output": "Вивід",
  "ui.messagePart.openInEditor": "Відкрити в редакторі",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Це було корисно",
  "ui.message.feedback.notHelpful": "Це не було корисно",
  "ui.message.feedback.clearRating": "Очистити оцінку",
}
