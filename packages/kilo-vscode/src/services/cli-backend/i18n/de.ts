export const dict = {
  "server.processExited": "Der CLI-Prozess wurde mit dem Code {{code}} beendet, bevor der Server gestartet wurde",
  "server.startupTimeout": "Zeitüberschreitung beim Serverstart nach {{seconds}} Sekunden",
  "remote.connected": "Kilo Remote: Verbunden",
  "remote.connecting": "Kilo Remote: Verbindung wird hergestellt\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete wurde pausiert. Mögliche Ursachen: Ihr Kilo-Konto verfügt über kein verbleibendes Guthaben oder der konfigurierte API-Schlüssel (BYOK) hat sein Kontingent erreicht. Fügen Sie Kilo-Guthaben hinzu oder überprüfen Sie die Konfiguration Ihres API-Schlüssels, um die Autovervollständigung fortzusetzen.",
  "kilocode:autocomplete.authError.message":
    "Kilo Code Autocomplete wurde aufgrund eines Authentifizierungsproblems pausiert. Mögliche Ursachen: Sie sind nicht bei Kilo angemeldet oder Ihr API-Schlüssel (BYOK) ist ungültig oder fehlt. Melden Sie sich erneut an oder überprüfen Sie die API-Schlüsseleinstellungen Ihres Anbieters.",
} as const
