export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.byok.prefix": "Pour plus de statistiques d'utilisation, utilisez ",
  "provider.connect.kiloGateway.byok.link": "BYOK via Kilo's Gateway",
  "provider.connect.kiloGateway.byok.suffix": ".",

  // Provider settings translations
  "settings.providers.group.recommended": "Recommandés",
  "settings.providers.note.kilo": "Accès à plus de 500 modèles d'IA",
  "settings.providers.note.opencode": "Modèles sélectionnés, dont Claude, GPT, Gemini et plus encore",
  "settings.providers.note.anthropic": "Accès direct aux modèles Claude, y compris Pro et Max",
  "settings.providers.note.deepseek": "Modèles DeepSeek pour les tâches de raisonnement et de codage",
  "settings.providers.note.copilot": "Modèles Claude pour l'assistance au codage",
  "settings.providers.note.openai": "Modèles GPT et Codex avec clé API ou connexion ChatGPT",
  "settings.providers.note.google": "Modèles Gemini pour des réponses rapides et structurées",
  "settings.providers.note.openrouter": "Accédez à tous les modèles pris en charge depuis un seul fournisseur",
  "settings.providers.note.vercel": "Accès unifié aux modèles IA avec routage intelligent",

  // Reasoning block label
  "ui.reasoning.label": "Raisonnement",

  // Marketplace
  "marketplace.card.installed": "Installé",
  "marketplace.card.install": "Installer",
  "marketplace.card.remove": "Supprimer",
  "marketplace.card.removeScope": "Supprimer ({{scope}})",
  "marketplace.card.showMore": "Afficher plus",
  "marketplace.card.showLess": "Afficher moins",
  "marketplace.install.title": "Installer {{name}}",
  "marketplace.install.scope": "Portée",
  "marketplace.install.scope.project": "Projet",
  "marketplace.install.scope.global": "Global",
  "marketplace.install.scope.project.description":
    "Uniquement ce projet. Les fichiers installés peuvent être ajoutés au contrôle de version et partagés avec votre équipe.",
  "marketplace.install.scope.global.description":
    "Tous les projets sur cette machine. Enregistré dans votre configuration utilisateur.",
  "marketplace.install.destination": "Destination de l'installation",
  "marketplace.install.includedSkills": "Compétences incluses",
  "marketplace.install.about.mcp":
    "Un serveur MCP fournit à Kilo des outils supplémentaires pour interagir avec des services externes ou des programmes locaux.",
  "marketplace.install.about.agent":
    "Un agent ajoute un rôle réutilisable avec ses propres instructions et autorisations.",
  "marketplace.install.about.skill":
    "Une compétence ajoute des instructions et des ressources propres à une tâche que Kilo peut charger en cas de besoin.",
  "marketplace.install.mcp.warning":
    "Les serveurs MCP peuvent exécuter des commandes locales ou se connecter à des services externes. Kilo demandera votre autorisation avant d'utiliser leurs outils, sauf si vos autorisations le permettent automatiquement.",
  "marketplace.install.project.warning":
    "Les fichiers du projet peuvent être ajoutés au contrôle de version. N'y stockez pas de secrets, sauf si la configuration fait référence à une variable d'environnement.",
  "marketplace.install.learnMore": "Découvrir le fonctionnement des installations depuis le Marketplace",
  "marketplace.install.learnMcp": "En savoir plus sur MCP",
  "marketplace.install.about.plugin":
    "Un plugin ajoute des outils et des intégrations personnalisés à Kilo. Les plugins s'exécutent avec toutes les autorisations.",
  "marketplace.install.plugin.warning":
    "Les plugins exécutent du code avec toutes les autorisations. Ils peuvent lire et modifier vos fichiers, exécuter des commandes et accéder à vos identifiants et à votre réseau. Installez uniquement des plugins auxquels vous faites confiance.",
  "marketplace.intro":
    "Installez des agents, des compétences, des outils MCP et des plugins réutilisables pour un projet ou pour tous vos projets.",
  "marketplace.intro.learnMore": "À propos du Marketplace",
  "marketplace.install.prerequisites": "Prérequis",
  "marketplace.install.installing": "Installation en cours...",
  "marketplace.install.cancel": "Annuler",
  "marketplace.install.success": "Installé avec succès !",
  "marketplace.install.failed": "L'installation a échoué",
  "marketplace.install.done": "Terminé",
  "marketplace.install.close": "Fermer",
  "marketplace.install.mcp.signIn.message": "{{name}} est installé, mais nécessite une connexion avant que ses outils puissent être utilisés.",
  "marketplace.install.mcp.signIn.button": "Se connecter",
  "marketplace.install.mcp.signIn.waiting": "En attente de connexion via le navigateur…",
  "marketplace.install.mcp.signIn.cancel": "Annuler",
  "marketplace.install.mcp.signIn.skip": "Plus tard",
  "marketplace.install.mcp.signIn.success": "Connecté à {{name}}.",
  "marketplace.install.mcp.signIn.failed": "La connexion à {{name}} a échoué.",
  "marketplace.remove.title": "Supprimer {{name}} ?",
  "marketplace.remove.confirm":
    "Êtes-vous sûr de vouloir supprimer ce {{type}} ? Cela le supprimera de votre configuration {{scope}}.",
  "marketplace.remove.cancel": "Annuler",
  "marketplace.remove.mcp.skills":
    "Cela supprime aussi les compétences associées qui appartiennent à cette installation. Les compétences installées indépendamment sont conservées.",
  "marketplace.remove.confirm.button": "Supprimer",
  "marketplace.search": "Rechercher...",
  "marketplace.filter.all": "Tous les éléments",
  "marketplace.filter.notInstalled": "Non installé",
  "marketplace.filter.relevant": "Pertinents pour mon espace de travail",
  "marketplace.empty": "Aucun élément trouvé",
  "marketplace.empty.relevant": "Aucun élément pertinent du marketplace trouvé pour cet espace de travail.",
  "marketplace.badge.mcpServer": "Serveur MCP",
  "marketplace.badge.skills": "Inclut des compétences",
  "marketplace.card.by": "par {{author}}",
  "marketplace.install.method": "Méthode d'installation",
  "marketplace.install.parameters": "Paramètres",
  "marketplace.install.optional": "(facultatif)",
  "marketplace.scope.project": "projet",
  "marketplace.scope.global": "global",
  "marketplace.remove.type.mcp": "serveur MCP",
  "marketplace.remove.type.plugin": "plugin",
  "marketplace.remove.type.skill": "compétence",
  "marketplace.remove.type.agent": "agent",
  "marketplace.remove.failed": "Échec de la suppression de {{name}}",
  "marketplace.install": "Installer",
  "marketplace.filter.installed": "Installé",
  "marketplace.error.dismiss": "Ignorer",
  "marketplace.warning.busyOne": "Une session est en cours et sera interrompue",
  "marketplace.warning.busyMany": "Plusieurs sessions sont en cours et seront interrompues",
  "marketplace.warning.installAnyway": "Installer quand même",
  "marketplace.warning.cancel": "Annuler",
  "marketplace.contribute.prompt": "Il manque une compétence, un agent, un serveur MCP ou un plugin ?",
  "marketplace.contribute.cta": "Contribuer sur GitHub",
  "marketplace.migration.notice":
    "Les modes ont été remplacés par des agents. Si vous avez précédemment installé des modes depuis le marketplace, veuillez les supprimer et les réinstaller en tant qu'agents pour migrer vers le nouveau format.",

  // Plan follow-up question shown after plan_exit
  "plan.followup.header": "Implémenter",
  "plan.followup.question": "Prêt à implémenter ?",
  "plan.followup.answer.newSession": "Démarrer une nouvelle session",
  "plan.followup.answer.newSession.description": "Implémenter dans une nouvelle session avec un contexte vierge",
  "plan.followup.answer.continue": "Continuer ici",
  "plan.followup.answer.continue.description": "Implémenter le plan dans cette session",
  "plan.followup.answer.keepRefining": "Continuer à affiner",
  "plan.followup.answer.keepRefining.description": "Continuer à planifier sans implémenter pour l'instant",

  // Slow-repo snapshot prompt
  "snapshot.slowRepo.header": "Instantané lent",
  "snapshot.slowRepo.question":
    "L'initialisation du système d'instantanés prend beaucoup de temps, probablement en raison de la taille du dépôt.\n\nVoulez-vous désactiver les instantanés pour ce dépôt ?",
  "snapshot.slowRepo.answer.continue": "Continuer avec les instantanés",
  "snapshot.slowRepo.answer.continue.description":
    "Attendez la fin de l'instantané. Les tours suivants sont rapides une fois l'instantané initial créé.",
  "snapshot.slowRepo.answer.disable": "Désactiver pour ce projet",
  "snapshot.slowRepo.answer.disable.description":
    "Désactivez les instantanés Kilo pour ce projet. Vous perdez l'annulation/restauration des modifications faites par Kilo, mais git continue de tout suivre.",

  // Edit-tool header and shell-tool section labels
  "ui.messagePart.openInDiffViewer": "Ouvrir dans le visualiseur de différences",
  "ui.messagePart.openInEditor": "Ouvrir dans l'éditeur",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "C'était utile",
  "ui.message.feedback.notHelpful": "Ce n'était pas utile",
  "ui.message.feedback.clearRating": "Effacer la notation",
  // Chart tool card
  "ui.tool.chart": "Graphique",
  "ui.tool.chart.invalid": "Configuration de graphique non valide — doit inclure le type et les données",
  "ui.tool.chart.failed": "Échec du rendu du graphique",

  // Project memory: the VS Code Quick Pick overview and memory errors
  "memory.host.error.noProject":
    "Aucun projet actif pour la mémoire. Ouvrez un fichier dans le dossier cible pour gérer sa mémoire.",
  "memory.host.error.notConnected": "Non connecté au serveur Kilo",
  "memory.host.error.unavailable": "La mémoire n'est pas disponible sur le serveur Kilo",
  "memory.host.error.load": "Échec du chargement de la mémoire",
  "memory.host.error.show": "Échec de l'affichage de la mémoire",
  "memory.host.error.operation": "L'opération sur la mémoire a échoué",
  "memory.host.error.disabled": "La mémoire est désactivée. Exécutez d'abord /memory on.",
  "memory.host.error.invalidInput": "Entrée de mémoire non valide",
  "memory.host.error.root": "Le dossier de mémoire du projet n'est pas disponible",
  "memory.host.error.storage": "Impossible de lire ou d'écrire la mémoire du projet",
  "memory.host.error.corrupt": "L'état de la mémoire du projet est illisible",
  "memory.host.show.empty":
    "Ce projet n'a pas encore de mémoire. Elle apparaîtra une fois que vous aurez utilisé Kilo.",
  "memory.host.show.enabled": "Activée",
  "memory.host.show.disabled": "Désactivée",
  "memory.host.show.autoSaveOn": "Enregistrement automatique activé",
  "memory.host.show.autoSaveOff": "Enregistrement automatique désactivé",
  "memory.host.show.storage": "Stockage",
  "memory.host.show.sources": "Sources",
  "memory.host.show.index": "Index",
  "memory.host.show.tokens": "Tokens estimés : {{tokens}}",
  "memory.host.show.stored": "Mémoire stockée",
  "memory.host.show.shownOf": "{{shown}} affichés sur {{total}}",
  "memory.host.show.shown": "Affichés : {{shown}}",
  "memory.host.show.title": "Mémoire",
  "memory.host.show.statusTitle": "État de la mémoire",
  "memory.host.show.placeholder": "Mémoire stockée du projet",
  "memory.host.show.statusPlaceholder": "État de la mémoire du projet",
}
