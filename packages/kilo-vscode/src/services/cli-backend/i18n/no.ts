export const dict = {
  "server.processExited": "CLI-prosessen avsluttet med kode {{code}} før serveren startet",
  "server.startupTimeout": "Tidsavbrudd for serveroppstart etter {{seconds}} sekunder",
  "remote.connected": "Kilo Remote: Tilkoblet",
  "remote.connecting": "Kilo Remote: Kobler til\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete er satt på pause. Mulige årsaker: Kilo-kontoen din har ingen gjenværende kreditter, eller den konfigurerte API-nøkkelen (BYOK) har nådd kvotegrensen. Legg til Kilo-kreditter eller kontroller konfigurasjonen av API-nøkkelen for å gjenoppta autofullføring.",
  "kilocode:autocomplete.authError.message":
    "Kilo Code Autocomplete er satt på pause på grunn av et autentiseringsproblem. Mulige årsaker: Du er ikke logget på Kilo, eller API-nøkkelen din (BYOK) er ugyldig eller mangler. Logg på igjen eller kontroller innstillingene for leverandørens API-nøkkel.",
} as const
