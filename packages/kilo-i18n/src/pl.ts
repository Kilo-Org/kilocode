export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.byok.prefix": "Aby uzyskać więcej statystyk użycia, użyj ",
  "provider.connect.kiloGateway.byok.link": "BYOK przez Kilo's Gateway",
  "provider.connect.kiloGateway.byok.suffix": ".",

  // Provider settings translations
  "settings.providers.group.recommended": "Polecane",
  "settings.providers.note.kilo": "Dostęp do ponad 500 modeli AI",
  "settings.providers.note.opencode": "Wyselekcjonowane modele, w tym Claude, GPT, Gemini i inne",
  "settings.providers.note.anthropic": "Bezpośredni dostęp do modeli Claude, w tym Pro i Max",
  "settings.providers.note.deepseek": "Modele DeepSeek do zadań rozumowania i kodowania",
  "settings.providers.note.copilot": "Modele Claude do pomocy w kodowaniu",
  "settings.providers.note.openai": "Modele GPT i Codex z kluczem API lub logowaniem ChatGPT",
  "settings.providers.note.google": "Modele Gemini do szybkich, ustrukturyzowanych odpowiedzi",
  "settings.providers.note.openrouter": "Dostęp do wszystkich obsługiwanych modeli od jednego dostawcy",
  "settings.providers.note.vercel": "Ujednolicony dostęp do modeli AI z inteligentnym routingiem",

  // Reasoning block label
  "ui.reasoning.label": "Rozumowanie",

  // Marketplace
  "marketplace.card.installed": "Zainstalowano",
  "marketplace.card.install": "Zainstaluj",
  "marketplace.card.remove": "Usuń",
  "marketplace.card.removeScope": "Usuń ({{scope}})",
  "marketplace.card.showMore": "Pokaż więcej",
  "marketplace.card.showLess": "Pokaż mniej",
  "marketplace.install.title": "Instalacja: {{name}}",
  "marketplace.install.scope": "Zakres",
  "marketplace.install.scope.project": "Projekt",
  "marketplace.install.scope.global": "Globalny",
  "marketplace.install.scope.project.description":
    "Tylko ten projekt. Zainstalowane pliki można dodać do systemu kontroli wersji i udostępnić zespołowi.",
  "marketplace.install.scope.global.description":
    "Wszystkie projekty na tym komputerze. Zapisywane w konfiguracji użytkownika.",
  "marketplace.install.destination": "Miejsce instalacji",
  "marketplace.install.includedSkills": "Dołączone umiejętności",
  "marketplace.install.about.mcp":
    "Serwer MCP zapewnia Kilo dodatkowe narzędzia do pracy z usługami zewnętrznymi lub programami lokalnymi.",
  "marketplace.install.about.agent": "Agent dodaje rolę wielokrotnego użytku z własnymi instrukcjami i uprawnieniami.",
  "marketplace.install.about.skill":
    "Umiejętność dodaje instrukcje i zasoby dotyczące określonych zadań, które Kilo może wczytać w razie potrzeby.",
  "marketplace.install.mcp.warning":
    "Serwery MCP mogą uruchamiać lokalne polecenia lub łączyć się z usługami zewnętrznymi. Kilo poprosi o pozwolenie przed użyciem ich narzędzi, chyba że uprawnienia zezwalają na to automatycznie.",
  "marketplace.install.project.warning":
    "Pliki projektu mogą zostać dodane do systemu kontroli wersji. Nie przechowuj tutaj sekretów, chyba że konfiguracja odwołuje się do zmiennej środowiskowej.",
  "marketplace.install.learnMore": "Dowiedz się, jak działają instalacje z Marketplace",
  "marketplace.install.learnMcp": "Dowiedz się więcej o MCP",
  "marketplace.install.about.plugin":
    "Wtyczka dodaje niestandardowe narzędzia i integracje do Kilo. Wtyczki działają z pełnymi uprawnieniami.",
  "marketplace.install.plugin.warning":
    "Wtyczki wykonują kod z pełnymi uprawnieniami. Mogą odczytywać i zmieniać Twoje pliki, uruchamiać polecenia oraz uzyskiwać dostęp do Twoich danych uwierzytelniających i sieci. Instaluj tylko wtyczki, którym ufasz.",
  "marketplace.intro":
    "Instaluj agentów, umiejętności, narzędzia MCP i wtyczki wielokrotnego użytku w jednym lub we wszystkich projektach.",
  "marketplace.intro.learnMore": "O Marketplace",
  "marketplace.install.prerequisites": "Wymagania wstępne",
  "marketplace.install.installing": "Instalowanie...",
  "marketplace.install.cancel": "Anuluj",
  "marketplace.install.success": "Zainstalowano pomyślnie!",
  "marketplace.install.failed": "Instalacja nie powiodła się",
  "marketplace.install.done": "Gotowe",
  "marketplace.install.close": "Zamknij",
  "marketplace.install.mcp.signIn.message":
    "{{name}} jest zainstalowany, ale wymaga zalogowania, zanim będzie można używać jego narzędzi.",
  "marketplace.install.mcp.signIn.button": "Zaloguj się",
  "marketplace.install.mcp.signIn.waiting": "Czekanie na zalogowanie w przeglądarce…",
  "marketplace.install.mcp.signIn.cancel": "Anuluj",
  "marketplace.install.mcp.signIn.skip": "Później",
  "marketplace.install.mcp.signIn.success": "Zalogowano do {{name}}.",
  "marketplace.install.mcp.signIn.failed": "Logowanie do {{name}} nie powiodło się.",
  "marketplace.remove.title": "Usunąć {{name}}?",
  "marketplace.remove.confirm":
    "Czy na pewno chcesz usunąć ten {{type}}? Spowoduje to usunięcie z konfiguracji: {{scope}}.",
  "marketplace.remove.cancel": "Anuluj",
  "marketplace.remove.mcp.skills":
    "Spowoduje to również usunięcie towarzyszących umiejętności należących do tej instalacji. Umiejętności zainstalowane niezależnie zostaną zachowane.",
  "marketplace.remove.confirm.button": "Usuń",
  "marketplace.search": "Szukaj...",
  "marketplace.filter.all": "Wszystkie elementy",
  "marketplace.filter.notInstalled": "Nie zainstalowano",
  "marketplace.filter.relevant": "Istotne dla mojego obszaru roboczego",
  "marketplace.empty": "Nie znaleziono elementów",
  "marketplace.empty.relevant": "Nie znaleziono elementów marketplace istotnych dla tego obszaru roboczego.",
  "marketplace.badge.mcpServer": "Serwer MCP",
  "marketplace.badge.skills": "Zawiera umiejętności",
  "marketplace.card.by": "autor: {{author}}",
  "marketplace.install.method": "Metoda instalacji",
  "marketplace.install.parameters": "Parametry",
  "marketplace.install.optional": "(opcjonalne)",
  "marketplace.scope.project": "projekt",
  "marketplace.scope.global": "globalny",
  "marketplace.remove.type.mcp": "serwer MCP",
  "marketplace.remove.type.plugin": "wtyczka",
  "marketplace.remove.type.skill": "umiejętność",
  "marketplace.remove.type.agent": "agent",
  "marketplace.remove.failed": "Nie udało się usunąć {{name}}",
  "marketplace.install": "Zainstaluj",
  "marketplace.filter.installed": "Zainstalowano",
  "marketplace.error.dismiss": "Odrzuć",
  "marketplace.warning.busyOne": "Jedna sesja jest uruchomiona i zostanie przerwana",
  "marketplace.warning.busyMany": "Kilka sesji jest uruchomionych i zostanie przerwanych",
  "marketplace.warning.installAnyway": "Zainstaluj mimo to",
  "marketplace.warning.cancel": "Anuluj",
  "marketplace.contribute.prompt": "Brakuje umiejętności, agenta, serwera MCP lub wtyczki?",
  "marketplace.contribute.cta": "Wnieś wkład na GitHubie",
  "marketplace.migration.notice":
    "Tryby zostały zastąpione przez agentów. Jeśli wcześniej instalowałeś tryby z marketplace, usuń je i zainstaluj ponownie jako agenty, aby przejść na nowy format.",

  // Plan follow-up question shown after plan_exit
  "plan.followup.header": "Wdróż",
  "plan.followup.question": "Gotowy do wdrożenia?",
  "plan.followup.answer.newSession": "Rozpocznij nową sesję",
  "plan.followup.answer.newSession.description": "Wdróż w nowej sesji z czystym kontekstem",
  "plan.followup.answer.continue": "Kontynuuj tutaj",
  "plan.followup.answer.continue.description": "Wdróż plan w tej sesji",
  "plan.followup.answer.keepRefining": "Dalej dopracowuj",
  "plan.followup.answer.keepRefining.description": "Kontynuuj planowanie bez wdrażania na razie",

  // Slow-repo snapshot prompt
  "snapshot.slowRepo.header": "Snapshot jest wolny",
  "snapshot.slowRepo.question":
    "Inicjalizacja systemu snapshotów trwa długo, prawdopodobnie ze względu na rozmiar repozytorium.\n\nCzy chcesz wyłączyć snapshoty dla tego repozytorium?",
  "snapshot.slowRepo.answer.continue": "Kontynuuj ze snapshotami",
  "snapshot.slowRepo.answer.continue.description":
    "Poczekaj, aż snapshot się zakończy. Kolejne tury są szybkie, gdy początkowy snapshot jest już zbudowany.",
  "snapshot.slowRepo.answer.disable": "Wyłącz dla tego projektu",
  "snapshot.slowRepo.answer.disable.description":
    "Wyłącz snapshoty Kilo dla tego projektu. Stracisz cofanie/przywracanie zmian Kilo, ale git nadal śledzi wszystko.",

  // Edit-tool header and shell-tool section labels
  "ui.messagePart.openInDiffViewer": "Otwórz w podglądzie różnic",
  "ui.messagePart.openInEditor": "Otwórz w edytorze",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "To było pomocne",
  "ui.message.feedback.notHelpful": "To nie było pomocne",
  "ui.message.feedback.clearRating": "Wyczyść ocenę",
  // Chart tool card
  "ui.tool.chart": "Wykres",
  "ui.tool.chart.invalid": "Nieprawidłowa konfiguracja wykresu — musi zawierać typ i dane",
  "ui.tool.chart.failed": "Nie udało się wyrenderować wykresu",
  // Browser tools: backend, observation, sensitive steps and origin grants.
  "browser.command.title": "Ustawienia przeglądarki",
  "browser.command.description": "Pokaż backend przeglądarki, jego dostępność i uprawnienia dla źródeł",
  "browser.command.backend": "Backend",
  "browser.command.observation": "Obserwacja",
  "browser.command.sensitive": "Kroki wrażliwe",
  "browser.command.grants": "Uprawnienia dla źródeł",
  "browser.backend.playwright": "Przeglądarka dołączona (Playwright)",
  "browser.backend.extension": "Rozszerzenie przeglądarki Kilo",
  "browser.backend.off": "Wyłączone",
  "browser.backend.offHint": "Ukryj narzędzia przeglądarki przed agentami",
  "browser.observation.full": "Pełny zrzut",
  "browser.observation.diff": "Tylko zmiany",
  "browser.observation.none": "Tylko status",
  "browser.sensitive.allowed": "wykonuj bez pytania",
  "browser.sensitive.asks": "zapytaj osobę",
  "browser.grants.title": "Uprawnienia przeglądarki dla źródeł",
  "browser.grants.none": "Brak reguł dla źródeł",
  "browser.grants.all": "wszystkie źródła dozwolone",
  "browser.grants.everyOriginAsk": "wszystkie źródła → pytaj",
  "browser.grants.everyOriginDeny": "wszystkie źródła → odmów",
  "browser.grants.editHint":
    "Edytuj reguły w ustawieniach Kilo Code, na karcie Narzędzia internetowe, w sekcji Uprawnienia witryn.",
  "browser.state.ready": "gotowa",
  "browser.state.unavailable": "niedostępna",
  "browser.state.readyHint": "Profil Chromium należący do Kilo, uruchamiany przy pierwszym wywołaniu przeglądarki",
  "browser.state.extensionHint": "Podłącz rozszerzenie przeglądarki Kilo, aby używać własnej przeglądarki",

  // Agent Manager: Cloud workspaces and chat
  "agentManager.cloud.newWorkspace": "Utwórz obszar roboczy w chmurze",
  "agentManager.cloud.newSession": "Rozpocznij sesję w chmurze",
  "agentManager.cloud.launchSibling":
    "Wyślij zadanie, aby uruchomić niezależnego agenta w tym obszarze roboczym. Agenci współdzielą pliki, ale każdy prowadzi osobną rozmowę.",
  "agentManager.cloud.launchWorkspace":
    "Wyślij zadanie, aby uruchomić agenta w chmurze w nowej kopii roboczej tego repozytorium.",
  "agentManager.cloud.disconnected":
    "Utracono połączenie z aktualizacjami na żywo. Agent może nadal pracować. Po przywróceniu połączenia wiadomość nie zostanie wysłana ponownie.",
  "agentManager.cloud.sleeping": "Ten obszar roboczy jest uśpiony. Wyślij wiadomość, aby agent wznowił pracę.",
  "agentManager.cloud.shellEnded":
    "Ta powłoka zakończyła pracę lub utracono z nią połączenie. Otwórz nowy terminal, aby uruchomić nową powłokę. Rozmowa z agentem jest nadal dostępna.",
  "agentManager.cloud.stopping": "Trwa kończenie tego uruchomienia w chmurze. Rozmowa pozostanie dostępna.",
  "agentManager.cloud.empty": "Brak obszarów roboczych w chmurze dla tego repozytorium.",
  "agentManager.cloud.signedOut": "Zaloguj się, aby zobaczyć obszary robocze w chmurze.",
  "agentManager.cloud.noRepository":
    "Aby korzystać z obszarów roboczych w chmurze, projekt musi mieć skonfigurowane obsługiwane zdalne repozytorium Git.",
  "agentManager.cloud.unsupported": "Obszary robocze w chmurze są niedostępne dla tego konta.",
  "agentManager.cloud.loadFailed": "Nie udało się wczytać obszarów roboczych w chmurze.",
  "agentManager.cloud.createFailed": "Nie udało się utworzyć obszaru roboczego lub sesji w chmurze.",
  "agentManager.cloud.optionalPrompt": "Pierwsze zapytanie (opcjonalne)",
  "agentManager.cloud.prompt": "Pierwsze zapytanie",
  "agentManager.cloud.model": "Model w chmurze",
  "agentManager.cloud.noModels": "Brak dostępnych modeli Kilo.",
  "agentManager.cloud.chat.empty": "Nie ma jeszcze wiadomości. Wyślij wiadomość, aby rozpocząć tę sesję w chmurze.",
  "agentManager.cloud.chat.user": "Ty",
  "agentManager.cloud.chat.assistant": "Agent w chmurze",
  "agentManager.cloud.chat.reconnecting": "Ponowne łączenie z chmurą…",
  "agentManager.cloud.review.autoCommit": "Zatwierdź zmiany po zakończeniu uruchomienia",
  "agentManager.cloud.share.title": "Udostępnij sesję",
  "agentManager.cloud.share.visibility": "Każdy, kto ma link, może odczytać tę sesję.",
  "agentManager.cloud.share.snapshot": "Link obejmuje tylko wiadomości otrzymane przed jego utworzeniem.",
  "agentManager.cloud.share.expires": "Wygasa za {{duration}}",
  "agentManager.cloud.share.sevenDays": "7 dni",
  "agentManager.cloud.share.replaces": "Utworzenie nowego linku z tymi ustawieniami zastąpi go, a stary link przestanie działać.",
  "agentManager.cloud.share.create": "Utwórz link",
  "agentManager.cloud.chat.unavailable": "Nie udało się otworzyć tej sesji w chmurze.",
  "agentManager.cloud.chat.permission": "Prośba o uprawnienie: {{permission}}",
  "agentManager.cloud.profile": "Profil środowiska",
  "agentManager.cloud.show": "Pokaż obszary robocze w chmurze",
  "agentManager.cloud.showDescription": "Pokaż obszary robocze tego repozytorium w chmurze w Agent Manager.",
}
