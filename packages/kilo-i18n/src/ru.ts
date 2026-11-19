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
  "marketplace.install.mcp.signIn.message":
    "{{name}} установлен, но требуется вход, прежде чем его инструменты можно будет использовать.",
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
  // Browser tools: backend, observation, sensitive steps and origin grants.
  "browser.command.title": "Настройки браузера",
  "browser.command.description": "Показать бэкенд браузера, его доступность и разрешения для источников",
  "browser.command.backend": "Бэкенд",
  "browser.command.observation": "Наблюдение",
  "browser.command.sensitive": "Чувствительные шаги",
  "browser.command.grants": "Разрешения для источников",
  "browser.backend.playwright": "Встроенный браузер (Playwright)",
  "browser.backend.extension": "Расширение браузера Kilo",
  "browser.backend.off": "Выключено",
  "browser.backend.offHint": "Скрыть браузерные инструменты от агентов",
  "browser.observation.full": "Полный снимок",
  "browser.observation.diff": "Только изменения",
  "browser.observation.none": "Только статус",
  "browser.sensitive.allowed": "выполнять без запроса",
  "browser.sensitive.asks": "спросить человека",
  "browser.grants.title": "Разрешения браузера для источников",
  "browser.grants.none": "Правил для источников пока нет",
  "browser.grants.all": "все источники разрешены",
  "browser.grants.everyOriginAsk": "все источники → спросить",
  "browser.grants.everyOriginDeny": "все источники → запретить",
  "browser.grants.editHint":
    "Измените правила в настройках Kilo Code, на вкладке «Веб-инструменты», в разделе «Разрешения сайтов».",
  "browser.state.ready": "готов",
  "browser.state.unavailable": "недоступен",
  "browser.state.readyHint": "Профиль Chromium, принадлежащий Kilo, запускается при первом вызове браузера",
  "browser.state.extensionHint": "Подключите расширение браузера Kilo, чтобы управлять своим браузером",
  "browser.command.usage":
    "Используйте /browser для настроек, /browser share, чтобы передать этой сессии активную вкладку, или /browser adopt, чтобы повторно использовать последнюю завершённую группу вкладок.",
  "browser.command.sessionDescription":
    "Поделитесь активной вкладкой (/browser share) или повторно используйте последнюю завершённую группу вкладок (/browser adopt)",
  // Browser permission prompt: one class on one origin, or one sensitive step.
  "browser.permission.read.title": "Читать страницы на {{origin}}",
  "browser.permission.act.title": "Нажимать и вводить текст на {{origin}}",
  "browser.permission.navigate.title": "Открывать страницы на {{origin}}",
  "browser.permission.read.detail": "Агент может читать текст страницы, снимки и скриншоты с этого источника.",
  "browser.permission.act.detail":
    "Агент может нажимать, вводить текст и запускать скрипты страницы на этом источнике.",
  "browser.permission.navigate.detail": "Агент может открывать страницы на этом источнике.",
  "browser.permission.frame": "Этот источник — фрейм внутри страницы, а не сама страница.",
  "browser.permission.sensitive.title": "Чувствительный шаг браузера на {{origin}}",
  "browser.permission.sensitive.reason": "Причина: {{reason}}",
  "browser.permission.sensitive.once":
    "Одобрить этот шаг может только человек. Одобрение распространяется только на этот один шаг.",
  // `/browser share` and `/browser adopt`.
  "browser.share.title": "Поделиться активной вкладкой браузера",
  "browser.share.description": "Переместить активную вкладку браузера в группу вкладок этой сессии",
  "browser.share.done": "Активная вкладка теперь в группе вкладок этой сессии.",
  "browser.adopt.title": "Повторно использовать завершённую группу вкладок",
  "browser.adopt.description": "Передать этой сессии последнюю завершённую группу вкладок Kilo",
  "browser.adopt.done": "Эта сессия теперь использует последнюю завершённую группу вкладок.",
  "browser.adopt.none": "Нет завершённой группы вкладок для повторного использования.",
  "browser.adopt.kept": "У этой сессии уже есть свои вкладки, и они сохраняются.",
  "browser.adopt.unconfirmed":
    "Браузеру предложено повторно использовать последнюю завершённую группу вкладок. Обновите расширение браузера Kilo, чтобы узнать, сделал ли он это.",
  "browser.control.notExtension":
    "Для обмена вкладками и их повторного использования нужно расширение браузера Kilo. Выберите его в /browser.",
  // Notices for a browser call the user has to act on.
  "browser.notice.unavailableTitle": "Браузер недоступен",
  "browser.notice.outdatedTitle": "Расширение браузера устарело",
  "browser.notice.stopped":
    "Вы остановили браузер для этой сессии. Выполните /browser adopt, чтобы вернуть ему вкладки.",

  // Auto-approve toggle for the TUI (`/auto-approve`, Ctrl+Alt+A).
  "tui.autoApprove.title": "Переключить автоодобрение",
  "tui.autoApprove.description": "Автоматически одобрять запросы разрешений для этого процесса",
  "tui.autoApprove.enabled": "Автоодобрение включено. Запросы разрешений одобряются автоматически.",
  "tui.autoApprove.disabled": "Автоодобрение отключено.",
}
