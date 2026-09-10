export const dict = {
  "kilocode:autocomplete.statusBar.enabled": "$(kilo-logo) Completamento automatico",
  "kilocode:autocomplete.statusBar.snoozed": "posticipato",
  "kilocode:autocomplete.statusBar.warning": "$(warning) Completamento automatico",
  "kilocode:autocomplete.statusBar.tooltip.basic": "Completamento automatico Kilo Code",
  "kilocode:autocomplete.statusBar.tooltip.noUsableProvider":
    "**Nessun modello di completamento automatico configurato**\n\nPer abilitare il completamento automatico, aggiungi un profilo con uno di questi provider supportati: {{providers}}.\n\n[Apri impostazioni]({{command}})",
  "kilocode:autocomplete.statusBar.tooltip.completionSummary":
    "Eseguiti {{count}} completamenti tra {{startTime}} e {{endTime}}, per un costo totale di {{cost}}.",
  "kilocode:autocomplete.statusBar.tooltip.providerInfo":
    "Completamenti automatici forniti da {{model}} tramite {{provider}}.",
  "kilocode:autocomplete.statusBar.cost.zero": "$0.00",
  "kilocode:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "kilocode:autocomplete.codeAction.title": "Kilo Code: modifiche suggerite",
  "kilocode:autocomplete.incompatibilityExtensionPopup.message":
    "Il completamento automatico di Kilo Code è bloccato da un conflitto con GitHub Copilot. Per risolvere il problema, devi disabilitare i suggerimenti inline di Copilot.",
  "kilocode:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Disabilita Copilot",
  "kilocode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Disabilita completamento automatico",
  "kilocode:autocomplete.creditsExhausted.message":
    "Il completamento automatico di Kilo Code è stato messo in pausa. Possibili cause: il tuo account Kilo non ha crediti residui, oppure la chiave API configurata (BYOK) ha raggiunto il limite di quota. Aggiungi crediti Kilo o controlla la configurazione della chiave API per riprendere il completamento automatico.",
  "kilocode:autocomplete.creditsExhausted.addCredits": "Aggiungi crediti",
  "kilocode:autocomplete.authError.message":
    "Il completamento automatico di Kilo Code è stato messo in pausa a causa di un problema di autenticazione. Possibili cause: non hai effettuato l’accesso a Kilo, oppure la tua chiave API (BYOK) non è valida o manca. Accedi di nuovo o controlla le impostazioni della chiave API del provider.",
}
