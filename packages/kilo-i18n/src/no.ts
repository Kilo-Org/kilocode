export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.line1":
    "Kilo Gateway gir deg tilgang til et utvalgt sett med pålitelige, optimaliserte modeller for kodingsagenter.",
  "provider.connect.kiloGateway.line2":
    "Med én enkelt API-nøkkel får du tilgang til modeller som Claude, GPT, Gemini, GLM og flere.",
  "provider.connect.kiloGateway.visit.prefix": "Besøk ",
  "provider.connect.kiloGateway.visit.link": "kilo.ai",
  "provider.connect.kiloGateway.visit.suffix": " for å hente API-nøkkelen din.",
  "provider.connect.kiloGateway.byok.prefix": "For mer bruksstatistikk, bruk ",
  "provider.connect.kiloGateway.byok.link": "BYOK via Kilo's Gateway",
  "provider.connect.kiloGateway.byok.suffix": ".",

  // Provider settings translations
  "settings.providers.group.recommended": "Anbefalt",
  "settings.providers.note.kilo": "Tilgang til 500+ AI-modeller",
  "settings.providers.note.opencode": "Utvalgte modeller, inkludert Claude, GPT, Gemini og mer",
  "settings.providers.note.anthropic": "Direkte tilgang til Claude-modeller, inkludert Pro og Max",
  "settings.providers.note.deepseek": "DeepSeek-modeller for resonnering og kodeoppgaver",
  "settings.providers.note.copilot": "Claude-modeller for kodeassistanse",
  "settings.providers.note.openai": "GPT- og Codex-modeller med API-nøkkel eller ChatGPT-innlogging",
  "settings.providers.note.google": "Gemini-modeller for raske, strukturerte svar",
  "settings.providers.note.openrouter": "Tilgang til alle støttede modeller fra én leverandør",
  "settings.providers.note.vercel": "Samlet tilgang til AI-modeller med smart ruting",

  // Reasoning block label
  "ui.permission.run": "Kjør",
  "ui.reasoning.label": "Resonnement",

  // Marketplace
  "marketplace.tab.skills": "Skills",
  "marketplace.tab.mcpServers": "MCP-servere",
  "marketplace.category.all": "Alle",
  "marketplace.placeholder": "Skal implementeres",
  "marketplace.card.installed": "Installert",
  "marketplace.card.install": "Installer",
  "marketplace.card.remove": "Fjern",
  "marketplace.card.removeScope": "Fjern ({{scope}})",
  "marketplace.card.showMore": "Vis mer",
  "marketplace.card.showLess": "Vis mindre",
  "marketplace.install.title": "Installer {{name}}",
  "marketplace.install.scope": "Omfang",
  "marketplace.install.scope.project": "Prosjekt",
  "marketplace.install.scope.global": "Globalt",
  "marketplace.install.scope.project.description":
    "Bare dette prosjektet. De installerte filene kan legges til i versjonskontroll og deles med teamet ditt.",
  "marketplace.install.scope.global.description":
    "Alle prosjekter på denne maskinen. Lagres i brukerkonfigurasjonen din.",
  "marketplace.install.destination": "Installasjonssted",
  "marketplace.install.about.mcp":
    "En MCP-server gir Kilo flere verktøy for å arbeide med eksterne tjenester eller lokale programmer.",
  "marketplace.install.about.agent": "En agent legger til en gjenbrukbar rolle med egne instruksjoner og tillatelser.",
  "marketplace.install.about.skill":
    "En ferdighet legger til oppgavespesifikke instruksjoner og ressurser som Kilo kan laste inn ved behov.",
  "marketplace.install.mcp.warning":
    "MCP-servere kan kjøre lokale kommandoer eller koble til eksterne tjenester. Kilo ber om tillatelse før verktøyene brukes, med mindre tillatelsene dine automatisk tillater det.",
  "marketplace.install.project.warning":
    "Prosjektfiler kan legges til i versjonskontroll. Ikke lagre hemmeligheter her med mindre konfigurasjonen viser til en miljøvariabel.",
  "marketplace.install.learnMore": "Finn ut hvordan installasjoner fra Marketplace fungerer",
  "marketplace.install.learnMcp": "Finn ut mer om MCP",
  "marketplace.install.installedAt": "Installert i {{path}}",
  "marketplace.intro": "Installer gjenbrukbare agenter, ferdigheter og MCP-verktøy for ett eller alle prosjekter.",
  "marketplace.intro.learnMore": "Om Marketplace",
  "marketplace.install.prerequisites": "Forutsetninger",
  "marketplace.install.installing": "Installerer...",
  "marketplace.install.cancel": "Avbryt",
  "marketplace.install.success": "Installert!",
  "marketplace.install.failed": "Installasjonen mislyktes",
  "marketplace.install.done": "Ferdig",
  "marketplace.install.close": "Lukk",
  "marketplace.remove.title": "Fjern {{name}}?",
  "marketplace.remove.confirm":
    "Er du sikker på at du vil fjerne denne {{type}}? Dette vil fjerne den fra din {{scope}}-konfigurasjon.",
  "marketplace.remove.cancel": "Avbryt",
  "marketplace.remove.confirm.button": "Fjern",
  "marketplace.tab.mcp": "MCP",
  "marketplace.tab.agents": "Agenter",
  "marketplace.search": "Søk...",
  "marketplace.filter.all": "Alle elementer",
  "marketplace.filter.notInstalled": "Ikke installert",
  "marketplace.filter.relevant": "Relevant for arbeidsområdet mitt",
  "marketplace.empty": "Ingen elementer funnet",
  "marketplace.empty.relevant": "Ingen relevante marketplace-elementer funnet for dette arbeidsområdet.",
  "marketplace.badge.mcpServer": "MCP-server",
  "marketplace.badge.mode": "Modus",
  "marketplace.card.by": "av {{author}}",
  "marketplace.install.method": "Installasjonsmetode",
  "marketplace.install.parameters": "Parametere",
  "marketplace.install.optional": "(valgfritt)",
  "marketplace.install.required": "{{name}} er påkrevd",
  "marketplace.scope.project": "prosjekt",
  "marketplace.scope.global": "global",
  "marketplace.remove.type.mcp": "MCP-server",
  "marketplace.remove.type.skill": "ferdighet",
  "marketplace.remove.type.agent": "agent",
  "marketplace.remove.failed": "Kunne ikke fjerne {{name}}",
  "marketplace.install": "Installer",
  "marketplace.filter.installed": "Installert",
  "marketplace.error.dismiss": "Avvis",
  "marketplace.warning.busyOne": "En økt kjører og vil bli avbrutt",
  "marketplace.warning.busyMany": "Flere økter kjører og vil bli avbrutt",
  "marketplace.warning.installAnyway": "Installer uansett",
  "marketplace.warning.cancel": "Avbryt",
  "marketplace.contribute.prompt": "Mangler du en skill, agent eller MCP-server?",
  "marketplace.contribute.cta": "Bidra på GitHub",
  "marketplace.migration.notice":
    "Modi er erstattet av agenter. Hvis du tidligere har installert marketplace-modi, fjern dem og installer dem på nytt som agenter for å migrere til det nye formatet.",

  // Plan follow-up question shown after plan_exit
  "plan.followup.header": "Implementer",
  "plan.followup.question": "Klar til å implementere?",
  "plan.followup.answer.newSession": "Start ny økt",
  "plan.followup.answer.newSession.description": "Implementer i en ny økt med ren kontekst",
  "plan.followup.answer.continue": "Fortsett her",
  "plan.followup.answer.continue.description": "Implementer planen i denne økten",
  "plan.followup.answer.keepRefining": "Fortsett å finpusse",
  "plan.followup.answer.keepRefining.description": "Fortsett planleggingen uten å implementere ennå",

  // Slow-repo snapshot prompt
  "snapshot.slowRepo.header": "Snapshot er tregt",
  "snapshot.slowRepo.question":
    "Det tar lang tid å initialisere snapshot-systemet, sannsynligvis på grunn av størrelsen på depotet.\n\nVil du deaktivere snapshots for dette depotet?",
  "snapshot.slowRepo.answer.continue": "Fortsett med snapshots",
  "snapshot.slowRepo.answer.continue.description":
    "Vent til snapshotet er ferdig. Påfølgende runder er raske når det første snapshotet er bygget.",
  "snapshot.slowRepo.answer.disable": "Deaktiver for dette prosjektet",
  "snapshot.slowRepo.answer.disable.description":
    "Slå av Kilos snapshots for dette prosjektet. Du mister angre/gjør om for Kilo-endringer, men git fortsetter å spore alt.",

  // Edit-tool header and shell-tool section labels
  "ui.messagePart.openInDiffViewer": "Åpne i diff-visning",
  "ui.messagePart.shell.command": "Kommando",
  "ui.messagePart.shell.output": "Utdata",
  "ui.messagePart.openInEditor": "Åpne i editor",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Dette var nyttig",
  "ui.message.feedback.notHelpful": "Dette var ikke nyttig",
  "ui.message.feedback.clearRating": "Fjern vurdering",

  "timeline.menu.goToPart": "Gå til del",
  "timeline.menu.stepDetails": "Stegdetaljer",
  "timeline.step.label": "Steg {{step}}",
  "timeline.step.inProgress": "pågår",
  "timeline.details.title": "Detaljer - {{step}}",
  "timeline.details.agent": "Agent",
  "timeline.details.provider": "Leverandør",
  "timeline.details.model": "Modell",
  "timeline.details.started": "Startet",
  "timeline.details.finished": "Fullført",
  "timeline.details.duration": "Varighet",
  "timeline.details.totalCost": "Total kostnad",
  "timeline.details.tokens": "Tokener",
  "timeline.details.tokens.summary": "Inn {{input}} · Ut {{output}} · Resonnering {{reasoning}}",
  "timeline.details.tokens.cacheSummary": "Cache R {{read}} · W {{write}} · Treffrate {{rate}}",
}
