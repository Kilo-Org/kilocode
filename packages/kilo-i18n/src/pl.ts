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
  "browser.command.starting": "Kilo nadal się uruchamia. Spróbuj ponownie za chwilę.",
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
  "browser.command.usage":
    "Użyj /browser, aby otworzyć ustawienia, /browser share, aby udostępnić tej sesji aktywną kartę, lub /browser adopt, aby ponownie użyć ostatniej zakończonej grupy kart.",
  "browser.command.sessionDescription":
    "Udostępnij aktywną kartę (/browser share) lub użyj ponownie ostatniej zakończonej grupy kart (/browser adopt)",
  // Browser permission prompt: one class on one origin, or one sensitive step.
  "browser.permission.read.title": "Odczytuj strony w {{origin}}",
  "browser.permission.act.title": "Klikaj i pisz w {{origin}}",
  "browser.permission.navigate.title": "Otwieraj strony w {{origin}}",
  "browser.permission.read.detail": "Agent może odczytywać tekst strony, zrzuty i zrzuty ekranu z tego źródła.",
  "browser.permission.act.detail": "Agent może klikać, pisać i uruchamiać skrypty strony w tym źródle.",
  "browser.permission.navigate.detail": "Agent może otwierać strony w tym źródle.",
  "browser.permission.frame": "To źródło jest ramką wewnątrz strony, a nie samą stroną.",
  "browser.permission.sensitive.title": "Krok wrażliwy przeglądarki w {{origin}}",
  "browser.permission.sensitive.reason": "Powód: {{reason}}",
  "browser.permission.sensitive.once":
    "Ten krok może zatwierdzić tylko osoba. Zatwierdzenie obejmuje wyłącznie ten jeden krok.",
  // `/browser share` and `/browser adopt`.
  "browser.share.title": "Udostępnij aktywną kartę przeglądarki",
  "browser.share.description": "Przenieś aktywną kartę przeglądarki do grupy kart tej sesji",
  "browser.share.done": "Twoja aktywna karta jest teraz w grupie kart tej sesji.",
  "browser.adopt.title": "Użyj ponownie zakończonej grupy kart",
  "browser.adopt.description": "Przypisz tej sesji najnowszą zakończoną grupę kart Kilo",
  "browser.adopt.done": "Ta sesja używa teraz ostatniej zakończonej grupy kart.",
  "browser.adopt.none": "Brak zakończonej grupy kart do ponownego użycia.",
  "browser.adopt.kept": "Ta sesja ma już własne karty i zachowuje je.",
  "browser.adopt.unconfirmed":
    "Poproszono przeglądarkę o ponowne użycie ostatniej zakończonej grupy kart. Zaktualizuj rozszerzenie przeglądarki Kilo, aby sprawdzić, czy to zrobiła.",
  "browser.control.notExtension":
    "Udostępnianie i ponowne używanie kart wymaga rozszerzenia przeglądarki Kilo. Wybierz je w /browser.",
  // Notices for a browser call the user has to act on.
  "browser.notice.unavailableTitle": "Przeglądarka niedostępna",
  "browser.notice.outdatedTitle": "Rozszerzenie przeglądarki jest nieaktualne",
  "browser.notice.stopped": "Zatrzymano przeglądarkę dla tej sesji. Uruchom /browser adopt, aby zwrócić jej karty.",

  // Auto-approve toggle for the TUI (`/auto-approve`, Ctrl+Alt+A).
  "tui.autoApprove.title": "Przełącz automatyczne zatwierdzanie",
  "tui.autoApprove.description": "Automatycznie zatwierdzaj prośby o uprawnienia dla tego procesu",
  "tui.autoApprove.enabled": "Automatyczne zatwierdzanie włączone. Prośby o uprawnienia są zatwierdzane automatycznie.",
  "tui.autoApprove.disabled": "Automatyczne zatwierdzanie wyłączone.",
}
