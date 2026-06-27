export const dict = {
  "server.processExited": "El proceso de la CLI finalizó con el código {{code}} antes de que se iniciara el servidor",
  "server.startupTimeout": "Tiempo de espera de inicio del servidor agotado después de {{seconds}} segundos",
  "remote.connected": "Kilo Remote: Conectado",
  "remote.connecting": "Kilo Remote: Conectando\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete se ha pausado. Posibles causas: tu cuenta de Kilo no tiene créditos disponibles o la clave API configurada (BYOK) ha alcanzado su límite de cuota. Añade créditos de Kilo o revisa la configuración de tu clave API para reanudar el autocompletado.",
  "kilocode:autocomplete.authError.message":
    "Kilo Code Autocomplete se ha pausado debido a un problema de autenticación. Posibles causas: no has iniciado sesión en Kilo o tu clave API (BYOK) no es válida o no está configurada. Vuelve a iniciar sesión o revisa la configuración de la clave API de tu proveedor.",
} as const
