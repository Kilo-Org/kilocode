export const dict = {
  "server.processExited": "Il processo CLI è uscito con codice {{code}} prima dell'avvio del server",
  "server.startupTimeout": "Timeout di avvio del server dopo {{seconds}} secondi",
  "remote.connected": "Kilo Remote: connesso",
  "remote.connecting": "Kilo Remote: connessione...",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete è stato sospeso. Possibili cause: il tuo account Kilo non ha più crediti disponibili oppure la chiave API configurata (BYOK) ha raggiunto il limite della quota. Aggiungi crediti Kilo o controlla la configurazione della chiave API per riattivare il completamento automatico.",
  "kilocode:autocomplete.authError.message":
    "Kilo Code Autocomplete è stato sospeso a causa di un problema di autenticazione. Possibili cause: non hai effettuato l’accesso a Kilo oppure la chiave API (BYOK) non è valida o è mancante. Effettua nuovamente l’accesso o controlla le impostazioni della chiave API del provider.",
} as const
