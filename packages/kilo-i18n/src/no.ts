export const dict = {
  // Kilo Gateway provider translations
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
  "ui.reasoning.label": "Resonnement",

  // Marketplace
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
  "marketplace.install.includedSkills": "Inkluderte ferdigheter",
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
  "marketplace.install.about.plugin":
    "Et programtillegg legger til tilpassede verktøy og integrasjoner i Kilo. Programtillegg kjører med fulle tillatelser.",
  "marketplace.install.plugin.warning":
    "Programtillegg kjører kode med fulle tillatelser. De kan lese og endre filene dine, kjøre kommandoer og få tilgang til påloggingsopplysningene dine og nettverket ditt. Installer bare programtillegg du stoler på.",
  "marketplace.intro":
    "Installer gjenbrukbare agenter, ferdigheter, MCP-verktøy og programtillegg for ett eller alle prosjekter.",
  "marketplace.intro.learnMore": "Om Marketplace",
  "marketplace.install.prerequisites": "Forutsetninger",
  "marketplace.install.installing": "Installerer...",
  "marketplace.install.cancel": "Avbryt",
  "marketplace.install.success": "Installert!",
  "marketplace.install.failed": "Installasjonen mislyktes",
  "marketplace.install.done": "Ferdig",
  "marketplace.install.close": "Lukk",
  "marketplace.install.mcp.signIn.message": "{{name}} er installert, men krever innlogging før verktøyene kan brukes.",
  "marketplace.install.mcp.signIn.button": "Logg inn",
  "marketplace.install.mcp.signIn.waiting": "Venter på innlogging via nettleseren…",
  "marketplace.install.mcp.signIn.cancel": "Avbryt",
  "marketplace.install.mcp.signIn.skip": "Senere",
  "marketplace.install.mcp.signIn.success": "Logget inn på {{name}}.",
  "marketplace.install.mcp.signIn.failed": "Innlogging til {{name}} mislyktes.",
  "marketplace.remove.title": "Fjern {{name}}?",
  "marketplace.remove.confirm":
    "Er du sikker på at du vil fjerne denne {{type}}? Dette vil fjerne den fra din {{scope}}-konfigurasjon.",
  "marketplace.remove.cancel": "Avbryt",
  "marketplace.remove.mcp.skills":
    "Dette fjerner også de medfølgende ferdighetene som tilhører denne installasjonen. Ferdigheter som er installert separat, beholdes.",
  "marketplace.remove.confirm.button": "Fjern",
  "marketplace.search": "Søk...",
  "marketplace.filter.all": "Alle elementer",
  "marketplace.filter.notInstalled": "Ikke installert",
  "marketplace.filter.relevant": "Relevant for arbeidsområdet mitt",
  "marketplace.empty": "Ingen elementer funnet",
  "marketplace.empty.relevant": "Ingen relevante marketplace-elementer funnet for dette arbeidsområdet.",
  "marketplace.badge.mcpServer": "MCP-server",
  "marketplace.badge.skills": "Inkluderer ferdigheter",
  "marketplace.card.by": "av {{author}}",
  "marketplace.install.method": "Installasjonsmetode",
  "marketplace.install.parameters": "Parametere",
  "marketplace.install.optional": "(valgfritt)",
  "marketplace.scope.project": "prosjekt",
  "marketplace.scope.global": "global",
  "marketplace.remove.type.mcp": "MCP-server",
  "marketplace.remove.type.plugin": "programtillegg",
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
  "marketplace.contribute.prompt": "Mangler du en skill, agent, MCP-server eller et programtillegg?",
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
  "ui.messagePart.openInEditor": "Åpne i editor",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Dette var nyttig",
  "ui.message.feedback.notHelpful": "Dette var ikke nyttig",
  "ui.message.feedback.clearRating": "Fjern vurdering",
  // Chart tool card
  "ui.tool.chart": "Diagram",
  "ui.tool.chart.invalid": "Ugyldig diagramkonfigurasjon — må inneholde type og data",
  "ui.tool.chart.failed": "Diagrammet kunne ikke vises",
  // Browser tools: backend, observation, sensitive steps and origin grants.
  "browser.command.title": "Nettleserinnstillinger",
  "browser.command.starting": "Kilo starter fortsatt. Prøv igjen om et øyeblikk.",
  "browser.command.description": "Vis nettleserens backend, om den kan kjøre, og opphavstillatelsene",
  "browser.command.backend": "Backend",
  "browser.command.observation": "Observasjon",
  "browser.command.sensitive": "Følsomme trinn",
  "browser.command.grants": "Opphavstillatelser",
  "browser.backend.playwright": "Innebygd nettleser (Playwright)",
  "browser.backend.extension": "Kilo-nettleserutvidelse",
  "browser.backend.off": "Av",
  "browser.backend.offHint": "Skjul nettleserverktøyene for agenter",
  "browser.observation.full": "Fullt øyeblikksbilde",
  "browser.observation.diff": "Bare det som endret seg",
  "browser.observation.none": "Bare status",
  "browser.sensitive.allowed": "kjør uten å spørre",
  "browser.sensitive.asks": "spør en person",
  "browser.grants.title": "Tillatelser for nettleseropphav",
  "browser.grants.none": "Ingen opphavsregler ennå",
  "browser.grants.all": "alle opphav tillatt",
  "browser.grants.everyOriginAsk": "alle opphav → spør",
  "browser.grants.everyOriginDeny": "alle opphav → avslå",
  "browser.grants.editHint":
    "Rediger reglene i Kilo Code-innstillingene på fanen Nettverktøy under Nettstedstillatelser.",
  "browser.state.ready": "klar",
  "browser.state.unavailable": "utilgjengelig",
  "browser.state.readyHint": "En Chromium-profil eid av Kilo, startet ved det første nettleserkallet",
  "browser.state.extensionHint": "Koble til Kilo-nettleserutvidelsen for å bruke din egen nettleser",
  "browser.command.usage":
    "Bruk /browser for innstillinger, /browser share for å gi denne økten den aktive fanen din, eller /browser adopt for å gjenbruke den sist avsluttede fanegruppen.",
  "browser.command.sessionDescription":
    "Del den aktive fanen din (/browser share) eller gjenbruk den sist avsluttede fanegruppen (/browser adopt)",
  // Browser permission prompt: one class on one origin, or one sensitive step.
  "browser.permission.read.title": "Les sider på {{origin}}",
  "browser.permission.act.title": "Klikk og skriv på {{origin}}",
  "browser.permission.navigate.title": "Åpne sider på {{origin}}",
  "browser.permission.read.detail": "Godkjenning lar denne økten lese sider på {{origin}} til den avsluttes.",
  "browser.permission.act.detail":
    "Godkjenning lar denne økten klikke, skrive og kjøre sideskript på {{origin}} til den avsluttes.",
  "browser.permission.navigate.detail": "Godkjenning lar denne økten åpne sider på {{origin}} til den avsluttes.",
  "browser.permission.frame": "Dette opphavet er en ramme inne i siden, ikke selve siden.",
  "browser.permission.sensitive.title": "Følsomt nettlesertrinn på {{origin}}",
  "browser.permission.sensitive.reason": "Årsak: {{reason}}",
  "browser.permission.sensitive.once":
    "Bare en person kan godkjenne dette trinnet. Godkjenningen gjelder bare dette ene trinnet.",
  // `/browser share` and `/browser adopt`.
  "browser.share.title": "Del den aktive nettleserfanen",
  "browser.share.description": "Flytt nettleserens aktive fane til fanegruppen for denne økten",
  "browser.share.done": "Den aktive fanen er nå i fanegruppen for denne økten.",
  "browser.adopt.title": "Gjenbruk den avsluttede nettleserfanegruppen",
  "browser.adopt.description": "Gi denne økten den sist avsluttede Kilo-fanegruppen",
  "browser.adopt.done": "Denne økten bruker nå den sist avsluttede fanegruppen.",
  "browser.adopt.none": "Det er ingen avsluttet fanegruppe å gjenbruke.",
  "browser.adopt.kept": "Denne økten har allerede egne faner og beholder dem.",
  "browser.adopt.unconfirmed":
    "Ba nettleseren gjenbruke den sist avsluttede fanegruppen. Oppdater Kilo-nettleserutvidelsen for å se om den gjorde det.",
  "browser.control.notExtension": "Deling og gjenbruk av faner krever Kilo-nettleserutvidelsen. Velg den i /browser.",
  // Notices for a browser call the user has to act on.
  "browser.notice.unavailableTitle": "Nettleseren er ikke tilgjengelig",
  "browser.notice.outdatedTitle": "Nettleserutvidelsen er utdatert",
  "browser.notice.stopped": "Du stoppet nettleseren for denne økten. Kjør /browser adopt for å gi den fanene tilbake.",

  // Auto-approve toggle for the TUI (`/auto-approve`, Ctrl+Alt+A).
  "tui.autoApprove.title": "Veksle automatisk godkjenning",
  "tui.autoApprove.description": "Godkjenn forespørsler om tillatelse automatisk for denne prosessen",
  "tui.autoApprove.enabled": "Automatisk godkjenning aktivert. Forespørsler om tillatelse godkjennes automatisk.",
  "tui.autoApprove.disabled": "Automatisk godkjenning deaktivert.",
}
