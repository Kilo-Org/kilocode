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

  // Agent Manager: Cloud workspaces and chat
  "agentManager.cloud.newWorkspace": "Создать облачное рабочее пространство",
  "agentManager.cloud.newSession": "Начать облачную сессию",
  "agentManager.cloud.launchSibling":
    "Отправьте задачу, чтобы запустить независимого агента в этом рабочем пространстве. Агенты работают с общими файлами, но у каждого своя беседа.",
  "agentManager.cloud.launchWorkspace":
    "Отправьте задачу, чтобы запустить облачного агента в новой рабочей копии этого репозитория.",
  "agentManager.cloud.disconnected":
    "Связь с потоком обновлений прервана. Возможно, агент всё ещё работает. При восстановлении соединения ваше сообщение не будет отправлено повторно.",
  "agentManager.cloud.sleeping":
    "Это рабочее пространство находится в спящем режиме. Отправьте сообщение, чтобы агент продолжил работу.",
  "agentManager.cloud.shellEnded":
    "Оболочка завершила работу или связь с ней прервалась. Откройте новый терминал, чтобы запустить новую оболочку. Ваша беседа с агентом по-прежнему доступна.",
  "agentManager.cloud.stopping": "Этот запуск в облаке завершается. Ваша беседа останется доступной.",
  "agentManager.cloud.empty": "У этого репозитория нет облачных рабочих пространств.",
  "agentManager.cloud.signedOut": "Войдите, чтобы увидеть облачные рабочие пространства.",
  "agentManager.cloud.noRepository": "Для работы в облаке проекту нужен поддерживаемый удалённый репозиторий Git.",
  "agentManager.cloud.unsupported": "Облачные рабочие пространства недоступны для этой учётной записи.",
  "agentManager.cloud.loadFailed": "Не удалось загрузить облачные рабочие пространства.",
  "agentManager.cloud.createFailed": "Не удалось создать облачное рабочее пространство или сессию.",
  "agentManager.cloud.optionalPrompt": "Первый запрос (необязательно)",
  "agentManager.cloud.prompt": "Первый запрос",
  "agentManager.cloud.model": "Облачная модель",
  "agentManager.cloud.noModels": "Нет доступных моделей Kilo.",
  "agentManager.cloud.chat.empty": "Сообщений пока нет. Отправьте сообщение, чтобы начать эту облачную сессию.",
  "agentManager.cloud.chat.user": "Вы",
  "agentManager.cloud.chat.assistant": "Облачный агент",
  "agentManager.cloud.chat.reconnecting": "Повторное подключение к облаку…",
  "agentManager.cloud.review.autoCommit": "Фиксировать изменения по завершении запуска",
  "agentManager.cloud.share.title": "Поделиться сессией",
  "agentManager.cloud.share.visibility": "Любой, у кого есть ссылка, может читать эту сессию.",
  "agentManager.cloud.share.snapshot": "Ссылка включает только сообщения, полученные до её создания.",
  "agentManager.cloud.share.expires": "Истекает через {{duration}}",
  "agentManager.cloud.share.sevenDays": "7 дн.",
  "agentManager.cloud.share.replaces": "Новая ссылка с этими настройками заменит её, и старая перестанет работать.",
  "agentManager.cloud.share.create": "Создать ссылку",
  "agentManager.cloud.chat.unavailable": "Не удалось открыть эту облачную сессию.",
  "agentManager.cloud.chat.permission": "Запрашиваемое разрешение: {{permission}}",
  "agentManager.cloud.profile": "Профиль окружения",
  "agentManager.cloud.show": "Показывать облачные рабочие пространства",
  "agentManager.cloud.showDescription": "Показывать облачные рабочие пространства этого репозитория в Agent Manager.",
}
