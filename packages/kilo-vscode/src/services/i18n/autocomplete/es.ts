export const dict = {
  "kilocode:autocomplete.statusBar.enabled": "$(kilo-logo) Autocompletado",
  "kilocode:autocomplete.statusBar.snoozed": "pospuesto",
  "kilocode:autocomplete.statusBar.warning": "$(warning) Autocompletado",
  "kilocode:autocomplete.statusBar.tooltip.basic": "Autocompletado de Kilo Code",
  "kilocode:autocomplete.statusBar.tooltip.noUsableProvider":
    "**No hay ningún modelo de autocompletado configurado**\n\nPara habilitar el autocompletado, añade un perfil con uno de estos proveedores compatibles: {{providers}}.\n\n[Abrir configuración]({{command}})",
  "kilocode:autocomplete.statusBar.tooltip.completionSummary":
    "Se realizaron {{count}} completados entre {{startTime}} y {{endTime}}, con un coste total de {{cost}}.",
  "kilocode:autocomplete.statusBar.tooltip.providerInfo":
    "Autocompletados proporcionados por {{model}} mediante {{provider}}.",
  "kilocode:autocomplete.statusBar.cost.zero": "$0.00",
  "kilocode:autocomplete.statusBar.cost.lessThanCent": "<$0.01",
  "kilocode:autocomplete.codeAction.title": "Kilo Code: Ediciones sugeridas",
  "kilocode:autocomplete.incompatibilityExtensionPopup.message":
    "El autocompletado de Kilo Code está bloqueado por un conflicto con GitHub Copilot. Para solucionarlo, debes deshabilitar las sugerencias en línea de Copilot.",
  "kilocode:autocomplete.incompatibilityExtensionPopup.disableCopilot": "Deshabilitar Copilot",
  "kilocode:autocomplete.incompatibilityExtensionPopup.disableInlineAssist": "Deshabilitar autocompletado",
  "kilocode:autocomplete.creditsExhausted.message":
    "El autocompletado de Kilo Code se ha pausado. Posibles causas: tu cuenta de Kilo no tiene créditos restantes, o tu clave de API configurada (BYOK) alcanzó su límite de cuota. Agrega créditos de Kilo o revisa la configuración de tu clave de API para reanudar el autocompletado.",
  "kilocode:autocomplete.creditsExhausted.addCredits": "Añadir créditos",
  "kilocode:autocomplete.authError.message":
    "El autocompletado de Kilo Code se ha pausado por un problema de autenticación. Posibles causas: no has iniciado sesión en Kilo, o tu clave de API (BYOK) no es válida o falta. Vuelve a iniciar sesión o revisa la configuración de la clave de API de tu proveedor.",
}
