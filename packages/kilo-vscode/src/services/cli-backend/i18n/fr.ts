export const dict = {
  "server.processExited": "Le processus CLI s'est terminé avec le code {{code}} avant le démarrage du serveur",
  "server.startupTimeout": "Délai de démarrage du serveur dépassé après {{seconds}} secondes",
  "remote.connected": "Kilo Remote\u00a0: Connecté",
  "remote.connecting": "Kilo Remote\u00a0: Connexion\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete a été mis en pause. Causes possibles : votre compte Kilo n’a plus de crédits disponibles ou la clé API configurée (BYOK) a atteint sa limite de quota. Ajoutez des crédits Kilo ou vérifiez la configuration de votre clé API pour réactiver l’autocomplétion.",
  "kilocode:autocomplete.authError.message":
    "Kilo Code Autocomplete a été mis en pause en raison d’un problème d’authentification. Causes possibles : vous n’êtes pas connecté à Kilo, ou votre clé API (BYOK) est invalide ou manquante. Reconnectez-vous ou vérifiez les paramètres de la clé API de votre fournisseur.",
} as const
