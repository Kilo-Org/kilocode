// Kilo-specific translations and overrides
// Keys here will override any matching keys from upstream translations
export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.line1":
    "Kilo Gateway ti offre una selezione curata di modelli affidabili e ottimizzati per agenti di coding.",
  "provider.connect.kiloGateway.line2":
    "Con una sola API key puoi accedere a modelli come Claude, GPT, Gemini, GLM e altri.",
  "provider.connect.kiloGateway.visit.prefix": "Visita ",
  "provider.connect.kiloGateway.visit.link": "kilo.ai",
  "provider.connect.kiloGateway.visit.suffix": " per ottenere la tua API key.",
  "provider.connect.kiloGateway.byok.prefix": "Per ulteriori statistiche sull'utilizzo, utilizza ",
  "provider.connect.kiloGateway.byok.link": "BYOK tramite Kilo's Gateway",
  "provider.connect.kiloGateway.byok.suffix": ".",

  // Provider settings translations
  "settings.providers.group.recommended": "Consigliati",
  "settings.providers.note.kilo": "Accesso a oltre 500 modelli AI",
  "settings.providers.note.opencode": "Modelli selezionati, inclusi Claude, GPT, Gemini e altri",
  "settings.providers.note.anthropic": "Accesso diretto ai modelli Claude, inclusi Pro e Max",
  "settings.providers.note.deepseek": "Modelli DeepSeek per attività di ragionamento e programmazione",
  "settings.providers.note.copilot": "Modelli Claude per assistenza alla programmazione",
  "settings.providers.note.openai": "Modelli GPT e Codex con chiave API o accesso ChatGPT",
  "settings.providers.note.google": "Modelli Gemini per risposte rapide e strutturate",
  "settings.providers.note.openrouter": "Accesso a tutti i modelli supportati da un unico provider",
  "settings.providers.note.vercel": "Accesso unificato ai modelli IA con routing intelligente",

  // Reasoning block label
  "ui.permission.run": "Esegui",
  "ui.reasoning.label": "Ragionamento",

  // Marketplace
  "marketplace.tab.skills": "Skill",
  "marketplace.tab.mcpServers": "Server MCP",
  "marketplace.tab.agents": "Agenti",
  "marketplace.category.all": "Tutti",
  "marketplace.placeholder": "Da implementare",
  "marketplace.card.installed": "Installato",
  "marketplace.card.install": "Installa",
  "marketplace.card.remove": "Rimuovi",
  "marketplace.card.removeScope": "Rimuovi ({{scope}})",
  "marketplace.card.showMore": "Mostra altro",
  "marketplace.card.showLess": "Mostra meno",
  "marketplace.install.title": "Installa {{name}}",
  "marketplace.install.scope": "Ambito",
  "marketplace.install.scope.project": "Progetto",
  "marketplace.install.scope.global": "Globale",
  "marketplace.install.scope.project.description":
    "Solo questo progetto. I file installati possono essere aggiunti al controllo versione e condivisi con il team.",
  "marketplace.install.scope.global.description":
    "Tutti i progetti su questo computer. Viene salvato nella configurazione utente.",
  "marketplace.install.destination": "Destinazione dell'installazione",
  "marketplace.install.about.mcp":
    "Un server MCP fornisce a Kilo strumenti aggiuntivi per interagire con servizi esterni o programmi locali.",
  "marketplace.install.about.agent":
    "Un agente aggiunge un ruolo riutilizzabile con istruzioni e autorizzazioni proprie.",
  "marketplace.install.about.skill":
    "Una skill aggiunge istruzioni e risorse specifiche per un'attività che Kilo può caricare quando necessario.",
  "marketplace.install.mcp.warning":
    "I server MCP possono eseguire comandi locali o connettersi a servizi esterni. Kilo chiederà l'autorizzazione prima di usare i loro strumenti, a meno che le tue autorizzazioni non lo consentano automaticamente.",
  "marketplace.install.project.warning":
    "I file del progetto possono essere aggiunti al controllo versione. Non salvare segreti qui, a meno che la configurazione non faccia riferimento a una variabile di ambiente.",
  "marketplace.install.learnMore": "Scopri come funzionano le installazioni dal Marketplace",
  "marketplace.install.learnMcp": "Scopri di più su MCP",
  "marketplace.install.installedAt": "Installato in {{path}}",
  "marketplace.intro": "Installa agenti, skill e strumenti MCP riutilizzabili per uno o tutti i progetti.",
  "marketplace.intro.learnMore": "Informazioni sul Marketplace",
  "marketplace.install.prerequisites": "Prerequisiti",
  "marketplace.install.installing": "Installazione...",
  "marketplace.install.cancel": "Annulla",
  "marketplace.install.success": "Installato correttamente!",
  "marketplace.install.failed": "Installazione non riuscita",
  "marketplace.install.done": "Fatto",
  "marketplace.install.close": "Chiudi",
  "marketplace.remove.title": "Rimuovere {{name}}?",
  "marketplace.remove.confirm": "Vuoi davvero rimuovere questo {{type}}? Verrà rimosso dalla configurazione {{scope}}.",
  "marketplace.remove.cancel": "Annulla",
  "marketplace.remove.confirm.button": "Rimuovi",
  "marketplace.tab.mcp": "MCP",
  "marketplace.search": "Cerca...",
  "marketplace.filter.all": "Tutti gli elementi",
  "marketplace.filter.notInstalled": "Non installati",
  "marketplace.filter.relevant": "Rilevanti per il mio spazio di lavoro",
  "marketplace.empty": "Nessun elemento trovato",
  "marketplace.empty.relevant": "Nessun elemento rilevante del marketplace trovato per questo spazio di lavoro.",
  "marketplace.badge.mcpServer": "Server MCP",
  "marketplace.badge.mode": "Modalità",
  "marketplace.card.by": "di {{author}}",
  "marketplace.install.method": "Metodo di installazione",
  "marketplace.install.parameters": "Parametri",
  "marketplace.install.optional": "(opzionale)",
  "marketplace.install.required": "{{name}} è obbligatorio",
  "marketplace.scope.project": "progetto",
  "marketplace.scope.global": "globale",
  "marketplace.remove.type.mcp": "server MCP",
  "marketplace.remove.type.skill": "skill",
  "marketplace.remove.type.agent": "agente",
  "marketplace.remove.failed": "Rimozione di {{name}} non riuscita",
  "marketplace.install": "Installa",
  "marketplace.filter.installed": "Installati",
  "marketplace.error.dismiss": "Ignora",
  "marketplace.warning.busyOne": "Una sessione è attiva e verrà interrotta",
  "marketplace.warning.busyMany": "Più sessioni sono attive e verranno interrotte",
  "marketplace.warning.installAnyway": "Installa comunque",
  "marketplace.warning.cancel": "Annulla",
  "marketplace.contribute.prompt": "Manca una skill, una modalità o un server MCP?",
  "marketplace.contribute.cta": "Contribuisci su GitHub",
  "marketplace.migration.notice":
    "Le Modalità sono state sostituite dagli agenti. Se in precedenza hai installato Modalità dal marketplace, rimuovile e reinstallale come agenti per migrare al nuovo formato.",

  // Plan follow-up question shown after plan_exit
  "plan.followup.header": "Implementa",
  "plan.followup.question": "Pronto per implementare?",
  "plan.followup.answer.newSession": "Avvia una nuova sessione",
  "plan.followup.answer.newSession.description": "Implementa in una nuova sessione con contesto vuoto",
  "plan.followup.answer.continue": "Continua qui",
  "plan.followup.answer.continue.description": "Implementa il piano in questa sessione",
  "plan.followup.answer.keepRefining": "Continua a rifinire",
  "plan.followup.answer.keepRefining.description": "Continua a pianificare senza implementare per ora",

  "snapshot.slowRepo.header": "Snapshot lento",
  "snapshot.slowRepo.question":
    "L'inizializzazione del sistema snapshot sta richiedendo molto tempo, probabilmente a causa delle dimensioni del repository.\n\nVuoi disabilitare gli snapshot per questo repository?",
  "snapshot.slowRepo.answer.continue": "Continua con gli snapshot",
  "snapshot.slowRepo.answer.continue.description":
    "Continua ad attendere il completamento dello snapshot. Le iterazioni successive saranno rapide dopo la creazione dello snapshot iniziale.",
  "snapshot.slowRepo.answer.disable": "Disabilita per questo progetto",
  "snapshot.slowRepo.answer.disable.description":
    "Disattiva gli snapshot di Kilo per questo progetto. Perderai annulla/ripeti sulle modifiche ai file fatte da Kilo, ma git continuerà a tracciare tutto.",

  "ui.messagePart.openInDiffViewer": "Apri nel visualizzatore diff",
  "ui.messagePart.shell.command": "Comando",
  "ui.messagePart.shell.output": "Output",
  "ui.messagePart.openInEditor": "Apri nell'editor",

  "ui.message.feedback.helpful": "È stato utile",
  "ui.message.feedback.notHelpful": "Non è stato utile",
  "ui.message.feedback.clearRating": "Cancella valutazione",
}
