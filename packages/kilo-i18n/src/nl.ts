// Kilo-specific translations and overrides
// Keys here will override any matching keys from upstream translations
export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.byok.prefix": "Voor meer gebruiksstatistieken, gebruik ",
  "provider.connect.kiloGateway.byok.link": "BYOK via Kilo's Gateway",
  "provider.connect.kiloGateway.byok.suffix": ".",

  // Provider settings translations
  "settings.providers.group.recommended": "Aanbevolen",
  "settings.providers.note.kilo": "Toegang tot 500+ AI modellen",
  "settings.providers.note.opencode": "Geselecteerde modellen, waaronder Claude, GPT, Gemini en meer",
  "settings.providers.note.anthropic": "Directe toegang tot Claude-modellen, inclusief Pro en Max",
  "settings.providers.note.deepseek": "DeepSeek-modellen voor redeneer- en codeertaken",
  "settings.providers.note.copilot": "Claude-modellen voor hulp bij programmeren",
  "settings.providers.note.openai": "GPT- en Codex-modellen met API-sleutel of ChatGPT-login",
  "settings.providers.note.google": "Gemini-modellen voor snelle, gestructureerde antwoorden",
  "settings.providers.note.openrouter": "Toegang tot alle ondersteunde modellen via één provider",
  "settings.providers.note.vercel": "Geïntegreerde toegang tot AI-modellen met slimme routering",

  // Reasoning block label
  "ui.reasoning.label": "Redenering",

  // Marketplace
  "marketplace.card.installed": "Geïnstalleerd",
  "marketplace.card.install": "Installeren",
  "marketplace.card.remove": "Verwijderen",
  "marketplace.card.removeScope": "Verwijderen ({{scope}})",
  "marketplace.card.showMore": "Toon meer",
  "marketplace.card.showLess": "Toon minder",
  "marketplace.install.title": "Installeer {{name}}",
  "marketplace.install.scope": "Scope",
  "marketplace.install.scope.project": "Project",
  "marketplace.install.scope.global": "Globaal",
  "marketplace.install.scope.project.description":
    "Alleen dit project. De geïnstalleerde bestanden kunnen aan versiebeheer worden toegevoegd en met je team worden gedeeld.",
  "marketplace.install.scope.global.description":
    "Alle projecten op deze computer. Wordt opgeslagen in je gebruikersconfiguratie.",
  "marketplace.install.destination": "Installatielocatie",
  "marketplace.install.includedSkills": "Meegeleverde skills",
  "marketplace.install.about.mcp":
    "Een MCP-server geeft Kilo extra hulpmiddelen om met externe diensten of lokale programma's te werken.",
  "marketplace.install.about.agent": "Een agent voegt een herbruikbare rol toe met eigen instructies en machtigingen.",
  "marketplace.install.about.skill":
    "Een vaardigheid voegt taakspecifieke instructies en bronnen toe die Kilo indien nodig kan laden.",
  "marketplace.install.mcp.warning":
    "MCP-servers kunnen lokale opdrachten uitvoeren of verbinding maken met externe diensten. Kilo vraagt toestemming voordat hun hulpmiddelen worden gebruikt, tenzij je machtigingen dit automatisch toestaan.",
  "marketplace.install.project.warning":
    "Projectbestanden kunnen aan versiebeheer worden toegevoegd. Sla hier geen geheimen op, tenzij de configuratie naar een omgevingsvariabele verwijst.",
  "marketplace.install.learnMore": "Lees hoe installaties vanuit Marketplace werken",
  "marketplace.install.learnMcp": "Meer informatie over MCP",
  "marketplace.install.about.plugin":
    "Een plugin voegt aangepaste hulpmiddelen en integraties toe aan Kilo. Plugins worden uitgevoerd met volledige machtigingen.",
  "marketplace.install.plugin.warning":
    "Plugins voeren code uit met volledige machtigingen. Ze kunnen je bestanden lezen en wijzigen, opdrachten uitvoeren en toegang krijgen tot je inloggegevens en netwerk. Installeer alleen plugins die je vertrouwt.",
  "marketplace.intro":
    "Installeer herbruikbare agenten, vaardigheden, MCP-hulpmiddelen en plugins voor één project of voor alle projecten.",
  "marketplace.intro.learnMore": "Over Marketplace",
  "marketplace.install.prerequisites": "Vereisten",
  "marketplace.install.installing": "Installeren...",
  "marketplace.install.cancel": "Annuleren",
  "marketplace.install.success": "Succesvol geïnstalleerd!",
  "marketplace.install.failed": "Installatie mislukt",
  "marketplace.install.done": "Klaar",
  "marketplace.install.close": "Sluiten",
  "marketplace.install.mcp.signIn.message": "{{name}} is geïnstalleerd, maar vereist een login voordat de tools gebruikt kunnen worden.",
  "marketplace.install.mcp.signIn.button": "Inloggen",
  "marketplace.install.mcp.signIn.waiting": "Wachten op inloggen via de browser…",
  "marketplace.install.mcp.signIn.cancel": "Annuleren",
  "marketplace.install.mcp.signIn.skip": "Later",
  "marketplace.install.mcp.signIn.success": "Ingelogd bij {{name}}.",
  "marketplace.install.mcp.signIn.failed": "Inloggen bij {{name}} mislukt.",
  "marketplace.remove.title": "{{name}} verwijderen?",
  "marketplace.remove.confirm":
    "Weet je zeker dat je deze {{type}} wilt verwijderen? Dit verwijdert het uit je {{scope}} configuratie.",
  "marketplace.remove.cancel": "Annuleren",
  "marketplace.remove.mcp.skills":
    "Dit verwijdert ook de bijbehorende skills die bij deze installatie horen. Afzonderlijk geïnstalleerde skills blijven behouden.",
  "marketplace.remove.confirm.button": "Verwijderen",
  "marketplace.search": "Zoeken...",
  "marketplace.filter.all": "Alle items",
  "marketplace.filter.notInstalled": "Niet geïnstalleerd",
  "marketplace.filter.relevant": "Relevant voor mijn werkruimte",
  "marketplace.empty": "Geen items gevonden",
  "marketplace.empty.relevant": "Geen relevante marketplace-items gevonden voor deze werkruimte.",
  "marketplace.badge.mcpServer": "MCP Server",
  "marketplace.badge.skills": "Inclusief skills",
  "marketplace.card.by": "door {{author}}",
  "marketplace.install.method": "Installatiemethode",
  "marketplace.install.parameters": "Parameters",
  "marketplace.install.optional": "(optioneel)",
  "marketplace.scope.project": "project",
  "marketplace.scope.global": "globaal",
  "marketplace.remove.type.mcp": "MCP server",
  "marketplace.remove.type.plugin": "plugin",
  "marketplace.remove.type.skill": "skill",
  "marketplace.remove.type.agent": "agent",
  "marketplace.remove.failed": "Verwijderen van {{name}} mislukt",
  "marketplace.install": "Installeren",
  "marketplace.filter.installed": "Geïnstalleerd",
  "marketplace.error.dismiss": "Sluiten",
  "marketplace.warning.busyOne": "Er is één sessie actief en deze zal worden onderbroken",
  "marketplace.warning.busyMany": "Er zijn meerdere sessies actief en deze zullen worden onderbroken",
  "marketplace.warning.installAnyway": "Toch installeren",
  "marketplace.warning.cancel": "Annuleren",
  "marketplace.contribute.prompt": "Mist u een skill, agent, MCP-server of plugin?",
  "marketplace.contribute.cta": "Bijdragen op GitHub",
  "marketplace.migration.notice":
    "Modi zijn vervangen door agenten. Als u eerder marketplace-modi hebt geïnstalleerd, verwijder ze dan en installeer ze opnieuw als agenten om naar het nieuwe formaat te migreren.",

  // Plan follow-up question shown after plan_exit
  "plan.followup.header": "Implementeren",
  "plan.followup.question": "Klaar om te implementeren?",
  "plan.followup.answer.newSession": "Nieuwe sessie starten",
  "plan.followup.answer.newSession.description": "Implementeren in een nieuwe sessie met een lege context",
  "plan.followup.answer.continue": "Hier doorgaan",
  "plan.followup.answer.continue.description": "Het plan in deze sessie implementeren",
  "plan.followup.answer.keepRefining": "Blijven verfijnen",
  "plan.followup.answer.keepRefining.description": "Blijven plannen zonder nu te implementeren",

  // Slow-repo snapshot prompt
  "snapshot.slowRepo.header": "Snapshot is traag",
  "snapshot.slowRepo.question":
    "Het initialiseren van het snapshot-systeem duurt lang, waarschijnlijk vanwege de grootte van de repository.\n\nWil je snapshots voor deze repository uitschakelen?",
  "snapshot.slowRepo.answer.continue": "Doorgaan met snapshots",
  "snapshot.slowRepo.answer.continue.description":
    "Wacht tot de snapshot klaar is. Volgende beurten zijn snel zodra de eerste snapshot is gemaakt.",
  "snapshot.slowRepo.answer.disable": "Uitschakelen voor dit project",
  "snapshot.slowRepo.answer.disable.description":
    "Zet Kilo-snapshots uit voor dit project. Je verliest ongedaan maken/opnieuw doen van Kilo-wijzigingen, maar git blijft alles volgen.",

  // Edit-tool header and shell-tool section labels
  "ui.messagePart.openInDiffViewer": "Openen in Diff-weergave",
  "ui.messagePart.openInEditor": "Openen in editor",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Dit was nuttig",
  "ui.message.feedback.notHelpful": "Dit was niet nuttig",
  "ui.message.feedback.clearRating": "Beoordeling wissen",
  // Chart tool card
  "ui.tool.chart": "Grafiek",
  "ui.tool.chart.invalid": "Ongeldige grafiekconfiguratie — moet type en data bevatten",
  "ui.tool.chart.failed": "Grafiek kon niet worden weergegeven",

  // Project memory: the VS Code Quick Pick overview and memory errors
  "memory.host.error.noProject":
    "Geen actief project voor geheugen. Open een bestand in de doelmap om het geheugen ervan te beheren.",
  "memory.host.error.notConnected": "Niet verbonden met de Kilo-server",
  "memory.host.error.unavailable": "Geheugen is niet beschikbaar op de Kilo-server",
  "memory.host.error.load": "Laden van geheugen mislukt",
  "memory.host.error.show": "Tonen van geheugen mislukt",
  "memory.host.error.operation": "Geheugenbewerking mislukt",
  "memory.host.error.disabled": "Geheugen is uitgeschakeld. Voer eerst /memory on uit.",
  "memory.host.error.invalidInput": "Ongeldige geheugeninvoer",
  "memory.host.error.root": "De map van het projectgeheugen is niet beschikbaar",
  "memory.host.error.storage": "Kan projectgeheugen niet lezen of schrijven",
  "memory.host.error.corrupt": "De status van het projectgeheugen is onleesbaar",
  "memory.host.show.empty": "Dit project heeft nog geen geheugen. Het verschijnt zodra je Kilo hebt gebruikt.",
  "memory.host.show.enabled": "Ingeschakeld",
  "memory.host.show.disabled": "Uitgeschakeld",
  "memory.host.show.autoSaveOn": "Automatisch opslaan aan",
  "memory.host.show.autoSaveOff": "Automatisch opslaan uit",
  "memory.host.show.storage": "Opslag",
  "memory.host.show.sources": "Bronnen",
  "memory.host.show.index": "Index",
  "memory.host.show.tokens": "Geschatte tokens: {{tokens}}",
  "memory.host.show.stored": "Opgeslagen geheugen",
  "memory.host.show.shownOf": "{{shown}} van {{total}} getoond",
  "memory.host.show.shown": "Getoond: {{shown}}",
  "memory.host.show.title": "Geheugen",
  "memory.host.show.statusTitle": "Geheugenstatus",
  "memory.host.show.placeholder": "Opgeslagen projectgeheugen",
  "memory.host.show.statusPlaceholder": "Status van projectgeheugen",
}
