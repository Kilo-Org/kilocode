export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.byok.prefix": "For flere brugsstatistikker, brug ",
  "provider.connect.kiloGateway.byok.link": "BYOK via Kilo's Gateway",
  "provider.connect.kiloGateway.byok.suffix": ".",

  // Provider settings translations
  "settings.providers.group.recommended": "Anbefalede",
  "settings.providers.note.kilo": "Adgang til 500+ AI-modeller",
  "settings.providers.note.opencode": "Udvalgte modeller inklusive Claude, GPT, Gemini og mere",
  "settings.providers.note.anthropic": "Direkte adgang til Claude-modeller, inklusive Pro og Max",
  "settings.providers.note.deepseek": "DeepSeek-modeller til ræsonnement og kodningsopgaver",
  "settings.providers.note.copilot": "Claude-modeller til kodningsassistance",
  "settings.providers.note.openai": "GPT- og Codex-modeller med API-nøgle eller ChatGPT-login",
  "settings.providers.note.google": "Gemini-modeller til hurtige, strukturerede svar",
  "settings.providers.note.openrouter": "Adgang til alle understøttede modeller fra én udbyder",
  "settings.providers.note.vercel": "Samlet adgang til AI-modeller med smart routing",

  // Reasoning block label
  "ui.reasoning.label": "Ræsonnement",

  // Marketplace
  "marketplace.card.installed": "Installeret",
  "marketplace.card.install": "Installer",
  "marketplace.card.remove": "Fjern",
  "marketplace.card.removeScope": "Fjern ({{scope}})",
  "marketplace.card.showMore": "Vis mere",
  "marketplace.card.showLess": "Vis mindre",
  "marketplace.install.title": "Installer {{name}}",
  "marketplace.install.scope": "Omfang",
  "marketplace.install.scope.project": "Projekt",
  "marketplace.install.scope.global": "Global",
  "marketplace.install.scope.project.description":
    "Kun dette projekt. De installerede filer kan føjes til versionsstyring og deles med dit team.",
  "marketplace.install.scope.global.description": "Alle projekter på denne maskine. Gemmes i din brugerkonfiguration.",
  "marketplace.install.destination": "Installationsplacering",
  "marketplace.install.includedSkills": "Inkluderede færdigheder",
  "marketplace.install.about.mcp":
    "En MCP-server giver Kilo yderligere værktøjer til at arbejde med eksterne tjenester eller lokale programmer.",
  "marketplace.install.about.agent": "En agent tilføjer en genanvendelig rolle med egne instruktioner og tilladelser.",
  "marketplace.install.about.skill":
    "En færdighed tilføjer opgavespecifikke instruktioner og ressourcer, som Kilo kan indlæse efter behov.",
  "marketplace.install.mcp.warning":
    "MCP-servere kan køre lokale kommandoer eller oprette forbindelse til eksterne tjenester. Kilo beder om tilladelse, før deres værktøjer bruges, medmindre dine tilladelser automatisk tillader det.",
  "marketplace.install.project.warning":
    "Projektfiler kan føjes til versionsstyring. Gem ikke hemmeligheder her, medmindre konfigurationen henviser til en miljøvariabel.",
  "marketplace.install.learnMore": "Se, hvordan installationer fra Marketplace fungerer",
  "marketplace.install.learnMcp": "Få mere at vide om MCP",
  "marketplace.install.about.plugin":
    "Et plugin tilføjer tilpassede værktøjer og integrationer til Kilo. Plugins kører med fulde tilladelser.",
  "marketplace.install.plugin.warning":
    "Plugins kører kode med fulde tilladelser. De kan læse og ændre dine filer, køre kommandoer og få adgang til dine legitimationsoplysninger og dit netværk. Installer kun plugins, du har tillid til.",
  "marketplace.intro":
    "Installer genanvendelige agenter, færdigheder, MCP-værktøjer og plugins til ét eller alle projekter.",
  "marketplace.intro.learnMore": "Om Marketplace",
  "marketplace.install.prerequisites": "Forudsætninger",
  "marketplace.install.installing": "Installerer...",
  "marketplace.install.cancel": "Annuller",
  "marketplace.install.success": "Installeret med succes!",
  "marketplace.install.failed": "Installation mislykkedes",
  "marketplace.install.done": "Færdig",
  "marketplace.install.close": "Luk",
  "marketplace.install.mcp.signIn.message": "{{name}} er installeret, men kræver login, før dens værktøjer kan bruges.",
  "marketplace.install.mcp.signIn.button": "Log ind",
  "marketplace.install.mcp.signIn.waiting": "Venter på login via browser…",
  "marketplace.install.mcp.signIn.cancel": "Annuller",
  "marketplace.install.mcp.signIn.skip": "Senere",
  "marketplace.install.mcp.signIn.success": "Logget ind på {{name}}.",
  "marketplace.install.mcp.signIn.failed": "Login til {{name}} mislykkedes.",
  "marketplace.remove.title": "Fjern {{name}}?",
  "marketplace.remove.confirm":
    "Er du sikker på, at du vil fjerne denne {{type}}? Dette vil fjerne den fra din {{scope}} konfiguration.",
  "marketplace.remove.cancel": "Annuller",
  "marketplace.remove.mcp.skills":
    "Dette fjerner også de medfølgende færdigheder, som tilhører denne installation. Selvstændigt installerede færdigheder bevares.",
  "marketplace.remove.confirm.button": "Fjern",
  "marketplace.search": "Søg...",
  "marketplace.filter.all": "Alle elementer",
  "marketplace.filter.notInstalled": "Ikke installeret",
  "marketplace.filter.relevant": "Relevante for mit arbejdsområde",
  "marketplace.empty": "Ingen elementer fundet",
  "marketplace.empty.relevant": "Der blev ikke fundet relevante marketplace-elementer for dette arbejdsområde.",
  "marketplace.badge.mcpServer": "MCP-server",
  "marketplace.badge.skills": "Inkluderer færdigheder",
  "marketplace.card.by": "af {{author}}",
  "marketplace.install.method": "Installationsmetode",
  "marketplace.install.parameters": "Parametre",
  "marketplace.install.optional": "(valgfrit)",
  "marketplace.scope.project": "projekt",
  "marketplace.scope.global": "global",
  "marketplace.remove.type.mcp": "MCP-server",
  "marketplace.remove.type.plugin": "plugin",
  "marketplace.remove.type.skill": "færdighed",
  "marketplace.remove.type.agent": "agent",
  "marketplace.remove.failed": "Kunne ikke fjerne {{name}}",
  "marketplace.install": "Installer",
  "marketplace.filter.installed": "Installeret",
  "marketplace.error.dismiss": "Afvis",
  "marketplace.warning.busyOne": "En session kører og vil blive afbrudt",
  "marketplace.warning.busyMany": "Flere sessioner kører og vil blive afbrudt",
  "marketplace.warning.installAnyway": "Installer alligevel",
  "marketplace.warning.cancel": "Annuller",
  "marketplace.contribute.prompt": "Mangler du en skill, agent, MCP-server eller et plugin?",
  "marketplace.contribute.cta": "Bidrag på GitHub",
  "marketplace.migration.notice":
    "Tilstande er blevet erstattet af agenter. Hvis du tidligere har installeret marketplace-tilstande, skal du fjerne dem og geninstallere dem som agenter for at migrere til det nye format.",

  // Plan follow-up question shown after plan_exit
  "plan.followup.header": "Implementér",
  "plan.followup.question": "Klar til at implementere?",
  "plan.followup.answer.newSession": "Start ny session",
  "plan.followup.answer.newSession.description": "Implementér i en ny session med ren kontekst",
  "plan.followup.answer.continue": "Fortsæt her",
  "plan.followup.answer.continue.description": "Implementér planen i denne session",
  "plan.followup.answer.keepRefining": "Fortsæt med at finpudse",
  "plan.followup.answer.keepRefining.description": "Fortsæt planlægningen uden at implementere endnu",

  // Slow-repo snapshot prompt
  "snapshot.slowRepo.header": "Snapshot er langsomt",
  "snapshot.slowRepo.question":
    "Det tager lang tid at initialisere snapshot-systemet, sandsynligvis på grund af størrelsen på repositoryet.\n\nVil du deaktivere snapshots for dette repository?",
  "snapshot.slowRepo.answer.continue": "Fortsæt med snapshots",
  "snapshot.slowRepo.answer.continue.description":
    "Vent, indtil snapshot'et er færdigt. Efterfølgende ture er hurtige, når det indledende snapshot er bygget.",
  "snapshot.slowRepo.answer.disable": "Deaktivér for dette projekt",
  "snapshot.slowRepo.answer.disable.description":
    "Slå Kilos snapshots fra for dette projekt. Du mister fortryd/gentag for Kilo-ændringer, men git sporer stadig alt.",

  // Edit-tool header and shell-tool section labels
  "ui.messagePart.openInDiffViewer": "Åbn i Diff-visning",
  "ui.messagePart.openInEditor": "Åbn i editor",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Dette var nyttigt",
  "ui.message.feedback.notHelpful": "Dette var ikke nyttigt",
  "ui.message.feedback.clearRating": "Ryd bedømmelse",
  // Chart tool card
  "ui.tool.chart": "Diagram",
  "ui.tool.chart.invalid": "Ugyldig diagramkonfiguration — skal indeholde type og data",
  "ui.tool.chart.failed": "Diagrammet kunne ikke vises",
  // Browser tools: backend, observation, sensitive steps and origin grants.
  "browser.command.title": "Browserindstillinger",
  "browser.command.description": "Vis browserens backend, om den kan køre, og oprindelsestilladelserne",
  "browser.command.backend": "Backend",
  "browser.command.observation": "Observation",
  "browser.command.sensitive": "Følsomme trin",
  "browser.command.grants": "Oprindelsestilladelser",
  "browser.backend.playwright": "Medfølgende browser (Playwright)",
  "browser.backend.extension": "Kilo-browserudvidelse",
  "browser.backend.off": "Fra",
  "browser.backend.offHint": "Skjul browserværktøjerne for agenter",
  "browser.observation.full": "Fuldt snapshot",
  "browser.observation.diff": "Kun det ændrede",
  "browser.observation.none": "Kun status",
  "browser.sensitive.allowed": "kør uden at spørge",
  "browser.sensitive.asks": "spørg en person",
  "browser.grants.title": "Tilladelser for browseroprindelser",
  "browser.grants.none": "Ingen oprindelsesregler endnu",
  "browser.grants.all": "alle oprindelser tilladt",
  "browser.grants.everyOriginAsk": "alle oprindelser → spørg",
  "browser.grants.everyOriginDeny": "alle oprindelser → afvis",
  "browser.grants.editHint":
    "Rediger reglerne i Kilo Code-indstillingerne på fanen Webværktøjer under Tilladelser pr. websted.",
  "browser.state.ready": "klar",
  "browser.state.unavailable": "utilgængelig",
  "browser.state.readyHint": "En Chromium-profil ejet af Kilo, startet ved det første browserkald",
  "browser.state.extensionHint": "Forbind Kilo-browserudvidelsen for at bruge din egen browser",
  "browser.notice.extension":
    "Kilo-browserudvidelsen er forbundet i {{browser}}. Vil du bruge din egen browser til browserværktøjerne i stedet for den medfølgende?",
  "browser.notice.switch": "Brug min browser",
  "settings.browser.status.extension.waiting": "Venter på browserudvidelsen",
  "settings.browser.origins.saved.title": "Tilladt i chats",
  "settings.browser.origins.saved.description":
    "Websteder, du har tilladt fra en chat med Tillad altid, for dette arbejdsområde. De gælder oven i reglerne ovenfor.",
  "settings.browser.origins.saved.empty": "Intet websted er tilladt fra en chat endnu.",
  "settings.browser.origins.saved.failed": "Gemte tilladelser er ikke tilgængelige",
  "settings.browser.origins.saved.revoke": "Tilbagekald",
  "ui.permission.reason": "Årsag: {{reason}}",

  // Auto-approve toggle for the TUI (`/auto-approve`, Ctrl+Alt+A).
  "tui.autoApprove.title": "Skift auto-godkendelse",
  "tui.autoApprove.description": "Godkend anmodninger om tilladelse automatisk for denne proces",
  "tui.autoApprove.enabled": "Auto-godkendelse aktiveret. Anmodninger om tilladelse godkendes automatisk.",
  "tui.autoApprove.disabled": "Auto-godkendelse deaktiveret.",
}
