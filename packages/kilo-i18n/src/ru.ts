export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.byok.prefix": "Для получения дополнительной статистики использования используйте ",
  "provider.connect.kiloGateway.byok.link": "BYOK через Kilo's Gateway",
  "provider.connect.kiloGateway.byok.suffix": ".",

  // Provider settings translations
  "settings.providers.group.recommended": "Рекомендуемые",
  "settings.providers.note.kilo": "Доступ к 500+ моделям ИИ",
  "settings.providers.note.opencode": "Подобранные модели, включая Claude, GPT, Gemini и другие",
  "settings.providers.note.anthropic": "Прямой доступ к моделям Claude, включая Pro и Max",
  "settings.providers.note.deepseek": "Модели DeepSeek для задач рассуждения и программирования",
  "settings.providers.note.copilot": "Модели Claude для помощи в программировании",
  "settings.providers.note.openai": "Модели GPT и Codex с API-ключом или входом через ChatGPT",
  "settings.providers.note.google": "Модели Gemini для быстрых структурированных ответов",
  "settings.providers.note.openrouter": "Доступ ко всем поддерживаемым моделям через одного провайдера",
  "settings.providers.note.vercel": "Единый доступ к AI-моделям с умной маршрутизацией",

  // Reasoning block label
  "ui.reasoning.label": "Рассуждение",

  // Marketplace
  "marketplace.card.installed": "Установлено",
  "marketplace.card.install": "Установить",
  "marketplace.card.remove": "Удалить",
  "marketplace.card.removeScope": "Удалить ({{scope}})",
  "marketplace.card.showMore": "Показать больше",
  "marketplace.card.showLess": "Показать меньше",
  "marketplace.install.title": "Установка {{name}}",
  "marketplace.install.scope": "Область",
  "marketplace.install.scope.project": "Проект",
  "marketplace.install.scope.global": "Глобально",
  "marketplace.install.scope.project.description":
    "Только этот проект. Установленные файлы можно добавить в систему контроля версий и предоставить команде.",
  "marketplace.install.scope.global.description":
    "Все проекты на этом компьютере. Сохраняется в вашей пользовательской конфигурации.",
  "marketplace.install.destination": "Место установки",
  "marketplace.install.includedSkills": "Включённые навыки",
  "marketplace.install.about.mcp":
    "MCP-сервер предоставляет Kilo дополнительные инструменты для работы с внешними сервисами или локальными программами.",
  "marketplace.install.about.agent":
    "Агент добавляет многократно используемую роль с собственными инструкциями и разрешениями.",
  "marketplace.install.about.skill":
    "Навык добавляет инструкции и ресурсы для определённых задач, которые Kilo может загрузить при необходимости.",
  "marketplace.install.mcp.warning":
    "MCP-серверы могут выполнять локальные команды или подключаться к внешним сервисам. Kilo запросит разрешение перед использованием их инструментов, если только ваши разрешения не допускают это автоматически.",
  "marketplace.install.project.warning":
    "Файлы проекта могут быть добавлены в систему контроля версий. Не храните здесь секреты, если только конфигурация не ссылается на переменную окружения.",
  "marketplace.install.learnMore": "Узнайте, как работает установка из Marketplace",
  "marketplace.install.learnMcp": "Подробнее о MCP",
  "marketplace.install.about.plugin":
    "Плагин добавляет в Kilo пользовательские инструменты и интеграции. Плагины выполняются с полными правами доступа.",
  "marketplace.install.plugin.warning":
    "Плагины выполняют код с полными правами доступа. Они могут читать и изменять ваши файлы, выполнять команды и получать доступ к вашим учётным данным и сети. Устанавливайте только те плагины, которым доверяете.",
  "marketplace.intro":
    "Устанавливайте многократно используемых агентов, навыки, инструменты MCP и плагины для одного или всех проектов.",
  "marketplace.intro.learnMore": "О Marketplace",
  "marketplace.install.prerequisites": "Предварительные требования",
  "marketplace.install.installing": "Установка...",
  "marketplace.install.cancel": "Отмена",
  "marketplace.install.success": "Успешно установлено!",
  "marketplace.install.failed": "Сбой установки",
  "marketplace.install.done": "Готово",
  "marketplace.install.close": "Закрыть",
  "marketplace.install.mcp.signIn.message": "{{name}} установлен, но требуется вход, прежде чем его инструменты можно будет использовать.",
  "marketplace.install.mcp.signIn.button": "Войти",
  "marketplace.install.mcp.signIn.waiting": "Ожидание входа через браузер…",
  "marketplace.install.mcp.signIn.cancel": "Отмена",
  "marketplace.install.mcp.signIn.skip": "Позже",
  "marketplace.install.mcp.signIn.success": "Вход в {{name}} выполнен.",
  "marketplace.install.mcp.signIn.failed": "Не удалось войти в {{name}}.",
  "marketplace.remove.title": "Удалить {{name}}?",
  "marketplace.remove.confirm":
    "Вы уверены, что хотите удалить этот {{type}}? Это удалит его из вашей конфигурации ({{scope}}).",
  "marketplace.remove.cancel": "Отмена",
  "marketplace.remove.mcp.skills":
    "Также будут удалены сопутствующие навыки, принадлежащие этой установке. Независимо установленные навыки сохранятся.",
  "marketplace.remove.confirm.button": "Удалить",
  "marketplace.search": "Поиск...",
  "marketplace.filter.all": "Все элементы",
  "marketplace.filter.notInstalled": "Не установлено",
  "marketplace.filter.relevant": "Подходящие для моего рабочего пространства",
  "marketplace.empty": "Элементы не найдены",
  "marketplace.empty.relevant": "Для этого рабочего пространства не найдено подходящих элементов маркетплейса.",
  "marketplace.badge.mcpServer": "MCP-сервер",
  "marketplace.badge.skills": "Включает навыки",
  "marketplace.card.by": "от {{author}}",
  "marketplace.install.method": "Способ установки",
  "marketplace.install.parameters": "Параметры",
  "marketplace.install.optional": "(необязательно)",
  "marketplace.scope.project": "проект",
  "marketplace.scope.global": "глобально",
  "marketplace.remove.type.mcp": "MCP-сервер",
  "marketplace.remove.type.plugin": "плагин",
  "marketplace.remove.type.skill": "навык",
  "marketplace.remove.type.agent": "агент",
  "marketplace.remove.failed": "Не удалось удалить {{name}}",
  "marketplace.install": "Установить",
  "marketplace.filter.installed": "Установлено",
  "marketplace.error.dismiss": "Закрыть",
  "marketplace.warning.busyOne": "Один сеанс выполняется и будет прерван",
  "marketplace.warning.busyMany": "Несколько сеансов выполняются и будут прерваны",
  "marketplace.warning.installAnyway": "Установить в любом случае",
  "marketplace.warning.cancel": "Отмена",
  "marketplace.contribute.prompt": "Не хватает навыка, агента, MCP-сервера или плагина?",
  "marketplace.contribute.cta": "Внести вклад на GitHub",
  "marketplace.migration.notice":
    "Режимы заменены агентами. Если вы ранее устанавливали режимы из магазина, удалите их и переустановите как агенты, чтобы перейти на новый формат.",

  // Plan follow-up question shown after plan_exit
  "plan.followup.header": "Реализовать",
  "plan.followup.question": "Готовы реализовать?",
  "plan.followup.answer.newSession": "Начать новую сессию",
  "plan.followup.answer.newSession.description": "Реализовать в новой сессии с чистым контекстом",
  "plan.followup.answer.continue": "Продолжить здесь",
  "plan.followup.answer.continue.description": "Реализовать план в этой сессии",
  "plan.followup.answer.keepRefining": "Продолжить уточнение",
  "plan.followup.answer.keepRefining.description": "Продолжить планирование без реализации пока что",

  // Slow-repo snapshot prompt
  "snapshot.slowRepo.header": "Снимок выполняется медленно",
  "snapshot.slowRepo.question":
    "Инициализация системы снимков занимает много времени, вероятно, из-за размера репозитория.\n\nОтключить снимки для этого репозитория?",
  "snapshot.slowRepo.answer.continue": "Продолжить со снимками",
  "snapshot.slowRepo.answer.continue.description":
    "Подождите, пока снимок не завершится. Последующие ходы выполняются быстро после создания первоначального снимка.",
  "snapshot.slowRepo.answer.disable": "Отключить для этого проекта",
  "snapshot.slowRepo.answer.disable.description":
    "Выключите снимки Kilo для этого проекта. Вы потеряете отмену/повтор изменений Kilo, но git по-прежнему отслеживает всё.",

  // Edit-tool header and shell-tool section labels
  "ui.messagePart.openInDiffViewer": "Открыть в просмотре различий",
  "ui.messagePart.openInEditor": "Открыть в редакторе",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Это было полезно",
  "ui.message.feedback.notHelpful": "Это было бесполезно",
  "ui.message.feedback.clearRating": "Очистить оценку",
  // Chart tool card
  "ui.tool.chart": "Диаграмма",
  "ui.tool.chart.invalid": "Недопустимая конфигурация диаграммы — должны быть указаны тип и данные",
  "ui.tool.chart.failed": "Не удалось отобразить диаграмму",

  // Project memory: the VS Code Quick Pick overview and memory errors
  "memory.host.error.noProject":
    "Нет активного проекта для памяти. Откройте файл в целевой папке, чтобы управлять её памятью.",
  "memory.host.error.notConnected": "Нет подключения к серверу Kilo",
  "memory.host.error.unavailable": "Память недоступна на сервере Kilo",
  "memory.host.error.load": "Не удалось загрузить память",
  "memory.host.error.show": "Не удалось показать память",
  "memory.host.error.operation": "Операция с памятью не выполнена",
  "memory.host.error.disabled": "Память отключена. Сначала выполните /memory on.",
  "memory.host.error.invalidInput": "Недопустимые данные памяти",
  "memory.host.error.root": "Папка памяти проекта недоступна",
  "memory.host.error.storage": "Не удалось прочитать или записать память проекта",
  "memory.host.error.corrupt": "Не удаётся прочитать состояние памяти проекта",
  "memory.host.show.empty": "У этого проекта пока нет памяти. Она начнёт отображаться после использования Kilo.",
  "memory.host.show.enabled": "Включена",
  "memory.host.show.disabled": "Отключена",
  "memory.host.show.autoSaveOn": "Автосохранение включено",
  "memory.host.show.autoSaveOff": "Автосохранение отключено",
  "memory.host.show.storage": "Хранилище",
  "memory.host.show.sources": "Источники",
  "memory.host.show.index": "Индекс",
  "memory.host.show.tokens": "Примерное число токенов: {{tokens}}",
  "memory.host.show.stored": "Сохранённая память",
  "memory.host.show.shownOf": "Показано: {{shown}} из {{total}}",
  "memory.host.show.shown": "Показано: {{shown}}",
  "memory.host.show.title": "Память",
  "memory.host.show.statusTitle": "Состояние памяти",
  "memory.host.show.placeholder": "Сохранённая память проекта",
  "memory.host.show.statusPlaceholder": "Состояние памяти проекта",
}
