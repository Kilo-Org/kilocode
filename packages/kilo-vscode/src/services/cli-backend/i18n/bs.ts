export const dict = {
  "server.processExited": "CLI proces je izašao sa kodom {{code}} prije nego što se server pokrenuo",
  "server.startupTimeout": "Vrijeme pokretanja servera je isteklo nakon {{seconds}} sekundi",
  "remote.connected": "Kilo Remote: Povezano",
  "remote.connecting": "Kilo Remote: Povezivanje\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete je pauziran. Mogući uzroci: na vašem Kilo računu nema preostalih kredita ili je konfigurirani API ključ (BYOK) dostigao ograničenje kvote. Dodajte Kilo kredite ili provjerite konfiguraciju API ključa kako biste nastavili koristiti automatsko dovršavanje.",
  "kilocode:autocomplete.authError.message":
    "Kilo Code Autocomplete je pauziran zbog problema s autentifikacijom. Mogući uzroci: niste prijavljeni na Kilo ili vaš API ključ (BYOK) nije važeći ili nedostaje. Ponovo se prijavite ili provjerite postavke API ključa svog pružatelja usluge.",
} as const
