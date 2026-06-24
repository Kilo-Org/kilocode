export const dict = {
  "server.processExited": "CLI-processen afsluttede med kode {{code}} før serveren startede",
  "server.startupTimeout": "Serverens opstartstid udløb efter {{seconds}} sekunder",
  "remote.connected": "Kilo Remote: Forbundet",
  "remote.connecting": "Kilo Remote: Forbinder\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete er sat på pause. Mulige årsager: Din Kilo-konto har ingen resterende kreditter, eller den konfigurerede API-nøgle (BYOK) har nået sin kvotegrænse. Tilføj Kilo-kreditter, eller kontrollér konfigurationen af din API-nøgle for at genoptage autofuldførelse.",
  "kilocode:autocomplete.authError.message":
    "Kilo Code Autocomplete er sat på pause på grund af et godkendelsesproblem. Mulige årsager: Du er ikke logget ind på Kilo, eller din API-nøgle (BYOK) er ugyldig eller mangler. Log ind igen, eller kontrollér indstillingerne for din udbyders API-nøgle.",
} as const
