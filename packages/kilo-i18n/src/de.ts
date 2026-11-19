export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.byok.prefix": "Für weitere Nutzungsstatistiken ",
  "provider.connect.kiloGateway.byok.link": "BYOK via Kilo's Gateway",
  "provider.connect.kiloGateway.byok.suffix": " nutzen.",

  // Provider settings translations
  "settings.providers.group.recommended": "Empfohlen",
  "settings.providers.note.kilo": "Zugriff auf 500+ KI-Modelle",
  "settings.providers.note.opencode": "Kuratierte Modelle, darunter Claude, GPT, Gemini und mehr",
  "settings.providers.note.anthropic": "Direkter Zugriff auf Claude-Modelle, einschließlich Pro und Max",
  "settings.providers.note.deepseek": "DeepSeek-Modelle für Denk- und Programmieraufgaben",
  "settings.providers.note.copilot": "Claude-Modelle für Programmierunterstützung",
  "settings.providers.note.openai": "GPT- und Codex-Modelle mit API-Schlüssel oder ChatGPT-Anmeldung",
  "settings.providers.note.google": "Gemini-Modelle für schnelle, strukturierte Antworten",
  "settings.providers.note.openrouter": "Zugriff auf alle unterstützten Modelle über einen Anbieter",
  "settings.providers.note.vercel": "Einheitlicher Zugriff auf KI-Modelle mit intelligentem Routing",

  // Reasoning block label
  "ui.reasoning.label": "Denken",

  // Marketplace
  "marketplace.card.installed": "Installiert",
  "marketplace.card.install": "Installieren",
  "marketplace.card.remove": "Entfernen",
  "marketplace.card.removeScope": "Entfernen ({{scope}})",
  "marketplace.card.showMore": "Mehr anzeigen",
  "marketplace.card.showLess": "Weniger anzeigen",
  "marketplace.install.title": "{{name}} installieren",
  "marketplace.install.scope": "Bereich",
  "marketplace.install.scope.project": "Projekt",
  "marketplace.install.scope.global": "Global",
  "marketplace.install.scope.project.description":
    "Nur dieses Projekt. Die installierten Dateien können versioniert und mit Ihrem Team geteilt werden.",
  "marketplace.install.scope.global.description":
    "Alle Projekte auf diesem Computer. Wird in Ihrer Benutzerkonfiguration gespeichert.",
  "marketplace.install.destination": "Installationsziel",
  "marketplace.install.includedSkills": "Enthaltene Skills",
  "marketplace.install.about.mcp":
    "Ein MCP-Server stellt Kilo zusätzliche Werkzeuge für die Arbeit mit externen Diensten oder lokalen Programmen bereit.",
  "marketplace.install.about.agent":
    "Ein Agent fügt eine wiederverwendbare Rolle mit eigenen Anweisungen und Berechtigungen hinzu.",
  "marketplace.install.about.skill":
    "Ein Skill fügt aufgabenspezifische Anweisungen und Ressourcen hinzu, die Kilo bei Bedarf laden kann.",
  "marketplace.install.mcp.warning":
    "MCP-Server können lokale Befehle ausführen oder eine Verbindung zu externen Diensten herstellen. Kilo fragt vor der Verwendung ihrer Werkzeuge um Erlaubnis, sofern Ihre Berechtigungen dies nicht automatisch erlauben.",
  "marketplace.install.project.warning":
    "Projektdateien können in die Versionsverwaltung aufgenommen werden. Speichern Sie hier keine Geheimnisse, es sei denn, die Konfiguration verweist auf eine Umgebungsvariable.",
  "marketplace.install.learnMore": "Erfahren Sie, wie Installationen aus dem Marketplace funktionieren",
  "marketplace.install.learnMcp": "Mehr über MCP erfahren",
  "marketplace.install.about.plugin":
    "Ein Plugin fügt Kilo benutzerdefinierte Werkzeuge und Integrationen hinzu. Plugins werden mit vollständigen Berechtigungen ausgeführt.",
  "marketplace.install.plugin.warning":
    "Plugins führen Code mit vollständigen Berechtigungen aus. Sie können Ihre Dateien lesen und ändern, Befehle ausführen und auf Ihre Zugangsdaten und Ihr Netzwerk zugreifen. Installieren Sie nur Plugins, denen Sie vertrauen.",
  "marketplace.intro":
    "Installieren Sie wiederverwendbare Agenten, Skills, MCP-Werkzeuge und Plugins für ein Projekt oder für alle Projekte.",
  "marketplace.intro.learnMore": "Über den Marketplace",
  "marketplace.install.prerequisites": "Voraussetzungen",
  "marketplace.install.installing": "Wird installiert...",
  "marketplace.install.cancel": "Abbrechen",
  "marketplace.install.success": "Erfolgreich installiert!",
  "marketplace.install.failed": "Installation fehlgeschlagen",
  "marketplace.install.done": "Fertig",
  "marketplace.install.close": "Schließen",
  "marketplace.install.mcp.signIn.message":
    "{{name}} ist installiert, benötigt aber eine Anmeldung, bevor die Tools verwendet werden können.",
  "marketplace.install.mcp.signIn.button": "Anmelden",
  "marketplace.install.mcp.signIn.waiting": "Warten auf Anmeldung im Browser…",
  "marketplace.install.mcp.signIn.cancel": "Abbrechen",
  "marketplace.install.mcp.signIn.skip": "Später",
  "marketplace.install.mcp.signIn.success": "Bei {{name}} angemeldet.",
  "marketplace.install.mcp.signIn.failed": "Anmeldung bei {{name}} fehlgeschlagen.",
  "marketplace.remove.title": "{{name}} entfernen?",
  "marketplace.remove.confirm":
    "Soll dieser Eintrag ({{type}}) wirklich entfernt werden? Er wird dadurch aus Ihrer {{scope}}-Konfiguration entfernt.",
  "marketplace.remove.cancel": "Abbrechen",
  "marketplace.remove.mcp.skills":
    "Dabei werden auch die zu dieser Installation gehörenden Begleit-Skills entfernt. Unabhängig installierte Skills bleiben erhalten.",
  "marketplace.remove.confirm.button": "Entfernen",
  "marketplace.search": "Suchen...",
  "marketplace.filter.all": "Alle Elemente",
  "marketplace.filter.notInstalled": "Nicht installiert",
  "marketplace.filter.relevant": "Relevant für meinen Arbeitsbereich",
  "marketplace.empty": "Keine Elemente gefunden",
  "marketplace.empty.relevant": "Keine relevanten Marketplace-Elemente für diesen Arbeitsbereich gefunden.",
  "marketplace.badge.mcpServer": "MCP-Server",
  "marketplace.badge.skills": "Enthält Skills",
  "marketplace.card.by": "von {{author}}",
  "marketplace.install.method": "Installationsmethode",
  "marketplace.install.parameters": "Parameter",
  "marketplace.install.optional": "(optional)",
  "marketplace.scope.project": "Projekt",
  "marketplace.scope.global": "Global",
  "marketplace.remove.type.mcp": "MCP-Server",
  "marketplace.remove.type.plugin": "Plugin",
  "marketplace.remove.type.skill": "Skill",
  "marketplace.remove.type.agent": "Agent",
  "marketplace.remove.failed": "Fehler beim Entfernen von {{name}}",
  "marketplace.install": "Installieren",
  "marketplace.filter.installed": "Installiert",
  "marketplace.error.dismiss": "Verwerfen",
  "marketplace.warning.busyOne": "Eine Sitzung läuft und wird unterbrochen",
  "marketplace.warning.busyMany": "Mehrere Sitzungen laufen und werden unterbrochen",
  "marketplace.warning.installAnyway": "Trotzdem installieren",
  "marketplace.warning.cancel": "Abbrechen",
  "marketplace.contribute.prompt": "Fehlt ein Skill, Agent, MCP-Server oder Plugin?",
  "marketplace.contribute.cta": "Auf GitHub beitragen",
  "marketplace.migration.notice":
    "Modi wurden durch Agenten ersetzt. Wenn Sie zuvor Marketplace-Modi installiert haben, entfernen Sie diese bitte und installieren Sie sie als Agenten neu, um zum neuen Format zu migrieren.",

  // Plan follow-up question shown after plan_exit
  "plan.followup.header": "Umsetzen",
  "plan.followup.question": "Bereit zur Umsetzung?",
  "plan.followup.answer.newSession": "Neue Sitzung starten",
  "plan.followup.answer.newSession.description": "In einer neuen Sitzung mit leerem Kontext umsetzen",
  "plan.followup.answer.continue": "Hier fortfahren",
  "plan.followup.answer.continue.description": "Den Plan in dieser Sitzung umsetzen",
  "plan.followup.answer.keepRefining": "Weiter verfeinern",
  "plan.followup.answer.keepRefining.description": "Weiter planen, ohne jetzt zu implementieren",

  // Slow-repo snapshot prompt
  "snapshot.slowRepo.header": "Snapshot ist langsam",
  "snapshot.slowRepo.question":
    "Die Initialisierung des Snapshot-Systems dauert lange, wahrscheinlich aufgrund der Größe des Repositorys.\n\nMöchtest du Snapshots für dieses Repository deaktivieren?",
  "snapshot.slowRepo.answer.continue": "Snapshots beibehalten",
  "snapshot.slowRepo.answer.continue.description":
    "Auf den Abschluss des Snapshots warten. Nachfolgende Runden sind schnell, sobald der initiale Snapshot erstellt ist.",
  "snapshot.slowRepo.answer.disable": "Für dieses Projekt deaktivieren",
  "snapshot.slowRepo.answer.disable.description":
    "Kilo-Snapshots für dieses Projekt ausschalten. Rückgängig/Wiederherstellen für Kilo-Änderungen ist nicht mehr möglich, aber git verfolgt weiterhin alles.",

  // Edit-tool header and shell-tool section labels
  "ui.messagePart.openInDiffViewer": "Im Diff-Viewer öffnen",
  "ui.messagePart.openInEditor": "Im Editor öffnen",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Das war hilfreich",
  "ui.message.feedback.notHelpful": "Das war nicht hilfreich",
  "ui.message.feedback.clearRating": "Bewertung löschen",
  // Chart tool card
  "ui.tool.chart": "Diagramm",
  "ui.tool.chart.invalid": "Ungültige Diagrammkonfiguration — muss Typ und Daten enthalten",
  "ui.tool.chart.failed": "Diagramm konnte nicht gerendert werden",
  // Browser tools: backend, observation, sensitive steps and origin grants.
  "browser.command.title": "Browser-Einstellungen",
  "browser.command.starting": "Kilo startet noch. Versuchen Sie es gleich noch einmal.",
  "browser.command.description": "Browser-Backend, Ausführbarkeit und Origin-Freigaben anzeigen",
  "browser.command.backend": "Backend",
  "browser.command.observation": "Beobachtung",
  "browser.command.sensitive": "Sensible Schritte",
  "browser.command.grants": "Origin-Freigaben",
  "browser.backend.playwright": "Mitgelieferter Browser (Playwright)",
  "browser.backend.extension": "Kilo-Browser-Erweiterung",
  "browser.backend.off": "Aus",
  "browser.backend.offHint": "Browser-Werkzeuge für Agenten ausblenden",
  "browser.observation.full": "Vollständiger Snapshot",
  "browser.observation.diff": "Nur Änderungen",
  "browser.observation.none": "Nur Status",
  "browser.sensitive.allowed": "ohne Nachfrage ausführen",
  "browser.sensitive.asks": "eine Person fragen",
  "browser.grants.title": "Freigaben für Browser-Origins",
  "browser.grants.none": "Noch keine Origin-Regeln",
  "browser.grants.all": "alle Origins erlaubt",
  "browser.grants.everyOriginAsk": "alle Origins → fragen",
  "browser.grants.everyOriginDeny": "alle Origins → ablehnen",
  "browser.grants.editHint":
    "Regeln in den Kilo-Code-Einstellungen im Tab „Web-Tools“ unter „Website-Berechtigungen“ bearbeiten.",
  "browser.state.ready": "bereit",
  "browser.state.unavailable": "nicht verfügbar",
  "browser.state.readyHint": "Ein Chromium-Profil von Kilo, gestartet beim ersten Browser-Aufruf",
  "browser.state.extensionHint": "Kilo-Browser-Erweiterung verbinden, um den eigenen Browser zu steuern",
  "browser.command.usage":
    "Verwenden Sie /browser für die Einstellungen, /browser share, um dieser Sitzung Ihren aktiven Tab zu geben, oder /browser adopt, um die zuletzt beendete Tab-Gruppe wiederzuverwenden.",
  // Browser permission prompt: one class on one origin, or one sensitive step.
  "browser.permission.read.title": "Seiten auf {{origin}} lesen",
  "browser.permission.act.title": "Auf {{origin}} klicken und Text eingeben",
  "browser.permission.navigate.title": "Seiten auf {{origin}} öffnen",
  "browser.permission.read.detail":
    "Die Genehmigung erlaubt dieser Sitzung, bis zu ihrem Ende Seiten auf {{origin}} zu lesen.",
  "browser.permission.act.detail":
    "Die Genehmigung erlaubt dieser Sitzung, bis zu ihrem Ende auf {{origin}} zu klicken, Text einzugeben und Seitenskripte auszuführen.",
  "browser.permission.navigate.detail":
    "Die Genehmigung erlaubt dieser Sitzung, bis zu ihrem Ende Seiten auf {{origin}} zu öffnen.",
  "browser.permission.frame": "Diese Origin ist ein Frame innerhalb der Seite, nicht die Seite selbst.",
  "browser.permission.sensitive.title": "Sensibler Browser-Schritt auf {{origin}}",
  "browser.permission.sensitive.reason": "Grund: {{reason}}",
  "browser.permission.sensitive.once":
    "Nur eine Person kann diesen Schritt genehmigen. Die Genehmigung gilt nur für diesen einen Schritt.",
  // `/browser share` and `/browser adopt`.
  "browser.share.title": "Aktiven Browser-Tab teilen",
  "browser.share.description": "Den aktiven Tab Ihres Browsers in die Tab-Gruppe dieser Sitzung verschieben",
  "browser.share.done": "Ihr aktiver Tab ist jetzt in der Tab-Gruppe dieser Sitzung.",
  "browser.adopt.title": "Beendete Browser-Tab-Gruppe wiederverwenden",
  "browser.adopt.description": "Dieser Sitzung die zuletzt beendete Kilo-Tab-Gruppe geben",
  "browser.adopt.done": "Diese Sitzung verwendet jetzt die zuletzt beendete Tab-Gruppe.",
  "browser.adopt.none": "Es gibt keine beendete Tab-Gruppe zum Wiederverwenden.",
  "browser.adopt.kept": "Diese Sitzung hat bereits eigene Tabs und behält sie.",
  "browser.adopt.unconfirmed":
    "Der Browser wurde gebeten, die zuletzt beendete Tab-Gruppe wiederzuverwenden. Aktualisieren Sie die Kilo-Browser-Erweiterung, um zu sehen, ob er es getan hat.",
  "browser.control.notExtension":
    "Teilen und Wiederverwenden von Tabs erfordern die Kilo-Browser-Erweiterung. Wählen Sie sie in /browser.",
  "browser.control.organizationOff": "Ihre Organisation hat die Browsersteuerung in Kilo deaktiviert.",
  // Notices for a browser call the user has to act on.
  "browser.notice.unavailableTitle": "Browser nicht verfügbar",
  "browser.notice.outdatedTitle": "Browser-Erweiterung veraltet",
  "browser.notice.stopped":
    "Sie haben den Browser für diese Sitzung gestoppt. Führen Sie /browser adopt aus, um der Sitzung ihre Tabs zurückzugeben.",

  // Auto-approve toggle for the TUI (`/auto-approve`, Ctrl+Alt+A).
  "tui.autoApprove.title": "Automatische Genehmigung umschalten",
  "tui.autoApprove.description": "Berechtigungsanfragen für diesen Prozess automatisch genehmigen",
  "tui.autoApprove.enabled": "Automatische Genehmigung aktiviert. Berechtigungsanfragen werden automatisch genehmigt.",
  "tui.autoApprove.disabled": "Automatische Genehmigung deaktiviert.",
}
