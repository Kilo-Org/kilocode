// Kilo-specific translations and overrides
// Keys here will override any matching keys from upstream translations
export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.line1":
    "Kilo Gateway geeft je toegang tot een gecureerde set van betrouwbare, geoptimaliseerde modellen voor coding agents.",
  "provider.connect.kiloGateway.line2":
    "Met één enkele API key krijg je toegang tot modellen zoals Claude, GPT, Gemini, GLM en meer.",
  "provider.connect.kiloGateway.visit.prefix": "Bezoek ",
  "provider.connect.kiloGateway.visit.link": "kilo.ai",
  "provider.connect.kiloGateway.visit.suffix": " om je API key op te halen.",
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
  "ui.permission.run": "Uitvoeren",
  "session.messages.receivingToolInput": "Invoer ontvangen {{size}}",
  "ui.reasoning.label": "Redenering",

  // Marketplace
  "marketplace.tab.skills": "Skills",
  "marketplace.tab.mcpServers": "MCP Servers",
  "marketplace.category.all": "Alle",
  "marketplace.placeholder": "Nog te implementeren",
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
  "marketplace.install.installedAt": "Geïnstalleerd in {{path}}",
  "marketplace.intro":
    "Installeer herbruikbare agenten, vaardigheden en MCP-hulpmiddelen voor één project of voor alle projecten.",
  "marketplace.intro.learnMore": "Over Marketplace",
  "marketplace.install.prerequisites": "Vereisten",
  "marketplace.install.installing": "Installeren...",
  "marketplace.install.cancel": "Annuleren",
  "marketplace.install.success": "Succesvol geïnstalleerd!",
  "marketplace.install.failed": "Installatie mislukt",
  "marketplace.install.done": "Klaar",
  "marketplace.install.close": "Sluiten",
  "marketplace.remove.title": "{{name}} verwijderen?",
  "marketplace.remove.confirm":
    "Weet je zeker dat je deze {{type}} wilt verwijderen? Dit verwijdert het uit je {{scope}} configuratie.",
  "marketplace.remove.cancel": "Annuleren",
  "marketplace.remove.confirm.button": "Verwijderen",
  "marketplace.tab.mcp": "MCP",
  "marketplace.tab.agents": "Agenten",
  "marketplace.search": "Zoeken...",
  "marketplace.filter.all": "Alle items",
  "marketplace.filter.notInstalled": "Niet geïnstalleerd",
  "marketplace.filter.relevant": "Relevant voor mijn werkruimte",
  "marketplace.empty": "Geen items gevonden",
  "marketplace.empty.relevant": "Geen relevante marketplace-items gevonden voor deze werkruimte.",
  "marketplace.badge.mcpServer": "MCP Server",
  "marketplace.badge.mode": "Modus",
  "marketplace.card.by": "door {{author}}",
  "marketplace.install.method": "Installatiemethode",
  "marketplace.install.parameters": "Parameters",
  "marketplace.install.optional": "(optioneel)",
  "marketplace.install.required": "{{name}} is vereist",
  "marketplace.scope.project": "project",
  "marketplace.scope.global": "globaal",
  "marketplace.remove.type.mcp": "MCP server",
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
  "marketplace.contribute.prompt": "Mist u een skill, agent of MCP-server?",
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
  "ui.messagePart.shell.command": "Opdracht",
  "ui.messagePart.shell.output": "Uitvoer",
  "ui.messagePart.openInEditor": "Openen in editor",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Dit was nuttig",
  "ui.message.feedback.notHelpful": "Dit was niet nuttig",
  "ui.message.feedback.clearRating": "Beoordeling wissen",
}
