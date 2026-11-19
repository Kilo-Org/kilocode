export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.byok.prefix": "Para más estadísticas de uso, utiliza ",
  "provider.connect.kiloGateway.byok.link": "BYOK a través de Kilo's Gateway",
  "provider.connect.kiloGateway.byok.suffix": ".",

  // Provider settings translations
  "settings.providers.group.recommended": "Recomendados",
  "settings.providers.note.kilo": "Acceso a más de 500 modelos de IA",
  "settings.providers.note.opencode": "Modelos seleccionados, incluidos Claude, GPT, Gemini y más",
  "settings.providers.note.anthropic": "Acceso directo a modelos Claude, incluidos Pro y Max",
  "settings.providers.note.deepseek": "Modelos DeepSeek para tareas de razonamiento y programación",
  "settings.providers.note.copilot": "Modelos Claude para asistencia de programación",
  "settings.providers.note.openai": "Modelos GPT y Codex con clave de API o inicio de sesión de ChatGPT",
  "settings.providers.note.google": "Modelos Gemini para respuestas rápidas y estructuradas",
  "settings.providers.note.openrouter": "Accede a todos los modelos compatibles desde un solo proveedor",
  "settings.providers.note.vercel": "Acceso unificado a modelos de IA con enrutamiento inteligente",

  // Reasoning block label
  "ui.reasoning.label": "Razonamiento",

  // Marketplace
  "marketplace.card.installed": "Instalado",
  "marketplace.card.install": "Instalar",
  "marketplace.card.remove": "Eliminar",
  "marketplace.card.removeScope": "Eliminar ({{scope}})",
  "marketplace.card.showMore": "Mostrar más",
  "marketplace.card.showLess": "Mostrar menos",
  "marketplace.install.title": "Instalar {{name}}",
  "marketplace.install.scope": "Alcance",
  "marketplace.install.scope.project": "Proyecto",
  "marketplace.install.scope.global": "Global",
  "marketplace.install.scope.project.description":
    "Solo este proyecto. Los archivos instalados se pueden añadir al control de versiones y compartir con tu equipo.",
  "marketplace.install.scope.global.description":
    "Todos los proyectos de este equipo. Se almacena en tu configuración de usuario.",
  "marketplace.install.destination": "Destino de la instalación",
  "marketplace.install.includedSkills": "Habilidades incluidas",
  "marketplace.install.about.mcp":
    "Un servidor MCP proporciona a Kilo herramientas adicionales para trabajar con servicios externos o programas locales.",
  "marketplace.install.about.agent": "Un agente añade un rol reutilizable con sus propias instrucciones y permisos.",
  "marketplace.install.about.skill":
    "Una habilidad añade instrucciones y recursos específicos para tareas que Kilo puede cargar cuando sea necesario.",
  "marketplace.install.mcp.warning":
    "Los servidores MCP pueden ejecutar comandos locales o conectarse a servicios externos. Kilo pedirá permiso antes de usar sus herramientas, a menos que tus permisos lo permitan automáticamente.",
  "marketplace.install.project.warning":
    "Los archivos del proyecto pueden añadirse al control de versiones. No guardes secretos aquí, a menos que la configuración haga referencia a una variable de entorno.",
  "marketplace.install.learnMore": "Descubre cómo funcionan las instalaciones de Marketplace",
  "marketplace.install.learnMcp": "Más información sobre MCP",
  "marketplace.install.about.plugin":
    "Un complemento añade herramientas e integraciones personalizadas a Kilo. Los complementos se ejecutan con todos los permisos.",
  "marketplace.install.plugin.warning":
    "Los complementos ejecutan código con todos los permisos. Pueden leer y modificar tus archivos, ejecutar comandos y acceder a tus credenciales y a tu red. Instala solo complementos en los que confíes.",
  "marketplace.intro":
    "Instala agentes, habilidades, herramientas MCP y complementos reutilizables en uno o todos los proyectos.",
  "marketplace.intro.learnMore": "Acerca de Marketplace",
  "marketplace.install.prerequisites": "Requisitos previos",
  "marketplace.install.installing": "Instalando...",
  "marketplace.install.cancel": "Cancelar",
  "marketplace.install.success": "¡Instalado con éxito!",
  "marketplace.install.failed": "La instalación falló",
  "marketplace.install.done": "Hecho",
  "marketplace.install.close": "Cerrar",
  "marketplace.install.mcp.signIn.message":
    "{{name}} está instalado, pero necesita iniciar sesión antes de poder usar sus herramientas.",
  "marketplace.install.mcp.signIn.button": "Iniciar sesión",
  "marketplace.install.mcp.signIn.waiting": "Esperando el inicio de sesión en el navegador…",
  "marketplace.install.mcp.signIn.cancel": "Cancelar",
  "marketplace.install.mcp.signIn.skip": "Más tarde",
  "marketplace.install.mcp.signIn.success": "Sesión iniciada en {{name}}.",
  "marketplace.install.mcp.signIn.failed": "No se pudo iniciar sesión en {{name}}.",
  "marketplace.remove.title": "¿Eliminar {{name}}?",
  "marketplace.remove.confirm":
    "¿Estás seguro de que deseas eliminar este {{type}}? Esto lo eliminará de tu configuración {{scope}}.",
  "marketplace.remove.cancel": "Cancelar",
  "marketplace.remove.mcp.skills":
    "Esto también elimina las habilidades complementarias que pertenecen a esta instalación. Se conservan las habilidades instaladas de forma independiente.",
  "marketplace.remove.confirm.button": "Eliminar",
  "marketplace.search": "Buscar...",
  "marketplace.filter.all": "Todos los elementos",
  "marketplace.filter.notInstalled": "No instalado",
  "marketplace.filter.relevant": "Relevantes para mi espacio de trabajo",
  "marketplace.empty": "No se encontraron elementos",
  "marketplace.empty.relevant": "No se encontraron elementos relevantes del marketplace para este espacio de trabajo.",
  "marketplace.badge.mcpServer": "Servidor MCP",
  "marketplace.badge.skills": "Incluye habilidades",
  "marketplace.card.by": "por {{author}}",
  "marketplace.install.method": "Método de instalación",
  "marketplace.install.parameters": "Parámetros",
  "marketplace.install.optional": "(opcional)",
  "marketplace.scope.project": "proyecto",
  "marketplace.scope.global": "global",
  "marketplace.remove.type.mcp": "servidor MCP",
  "marketplace.remove.type.plugin": "complemento",
  "marketplace.remove.type.skill": "habilidad",
  "marketplace.remove.type.agent": "agente",
  "marketplace.remove.failed": "Error al eliminar {{name}}",
  "marketplace.install": "Instalar",
  "marketplace.filter.installed": "Instalado",
  "marketplace.error.dismiss": "Descartar",
  "marketplace.warning.busyOne": "Una sesión está en ejecución y se interrumpirá",
  "marketplace.warning.busyMany": "Varias sesiones están en ejecución y se interrumpirán",
  "marketplace.warning.installAnyway": "Instalar de todas formas",
  "marketplace.warning.cancel": "Cancelar",
  "marketplace.contribute.prompt": "¿Falta una skill, agente, servidor MCP o complemento?",
  "marketplace.contribute.cta": "Contribuir en GitHub",
  "marketplace.migration.notice":
    "Los modos han sido reemplazados por agentes. Si anteriormente instalaste modos del marketplace, elimínalos y reinstálalos como agentes para migrar al nuevo formato.",

  // Plan follow-up question shown after plan_exit
  "plan.followup.header": "Implementar",
  "plan.followup.question": "¿Listo para implementar?",
  "plan.followup.answer.newSession": "Iniciar nueva sesión",
  "plan.followup.answer.newSession.description": "Implementar en una sesión nueva con contexto limpio",
  "plan.followup.answer.continue": "Continuar aquí",
  "plan.followup.answer.continue.description": "Implementar el plan en esta sesión",
  "plan.followup.answer.keepRefining": "Seguir refinando",
  "plan.followup.answer.keepRefining.description": "Seguir planificando sin implementar todavía",

  // Slow-repo snapshot prompt
  "snapshot.slowRepo.header": "La instantánea es lenta",
  "snapshot.slowRepo.question":
    "Está tardando mucho en inicializar el sistema de instantáneas, probablemente por el tamaño del repositorio.\n\n¿Quieres desactivar las instantáneas para este repositorio?",
  "snapshot.slowRepo.answer.continue": "Continuar con instantáneas",
  "snapshot.slowRepo.answer.continue.description":
    "Sigue esperando hasta que termine la instantánea. Los turnos siguientes serán rápidos una vez creada la instantánea inicial.",
  "snapshot.slowRepo.answer.disable": "Desactivar para este proyecto",
  "snapshot.slowRepo.answer.disable.description":
    "Apaga las instantáneas de Kilo para este proyecto. Perderás deshacer/rehacer de los cambios de Kilo, pero git seguirá rastreando todo.",

  // Edit-tool header and shell-tool section labels
  "ui.messagePart.openInDiffViewer": "Abrir en el visor de diferencias",
  "ui.messagePart.openInEditor": "Abrir en el editor",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Esto fue útil",
  "ui.message.feedback.notHelpful": "Esto no fue útil",
  "ui.message.feedback.clearRating": "Borrar valoración",
  // Chart tool card
  "ui.tool.chart": "Gráfico",
  "ui.tool.chart.invalid": "Configuración de gráfico no válida — debe incluir tipo y datos",
  "ui.tool.chart.failed": "No se pudo representar el gráfico",
  // Browser tools: backend, observation, sensitive steps and origin grants.
  "browser.command.title": "Ajustes del navegador",
  "browser.command.starting": "Kilo todavía se está iniciando. Vuelve a intentarlo en un momento.",
  "browser.command.description": "Mostrar el backend del navegador, si puede ejecutarse y los permisos de origen",
  "browser.command.backend": "Backend",
  "browser.command.observation": "Observación",
  "browser.command.sensitive": "Pasos sensibles",
  "browser.command.grants": "Permisos de origen",
  "browser.backend.playwright": "Navegador incluido (Playwright)",
  "browser.backend.extension": "Extensión de navegador de Kilo",
  "browser.backend.off": "Desactivado",
  "browser.backend.offHint": "Ocultar las herramientas de navegador a los agentes",
  "browser.observation.full": "Instantánea completa",
  "browser.observation.diff": "Solo lo que cambió",
  "browser.observation.none": "Solo estado",
  "browser.sensitive.allowed": "ejecutar sin preguntar",
  "browser.sensitive.asks": "preguntar a una persona",
  "browser.grants.title": "Permisos de origen del navegador",
  "browser.grants.none": "Aún no hay reglas de origen",
  "browser.grants.all": "todos los orígenes permitidos",
  "browser.grants.everyOriginAsk": "todos los orígenes → preguntar",
  "browser.grants.everyOriginDeny": "todos los orígenes → denegar",
  "browser.grants.editHint":
    "Edita las reglas en la configuración de Kilo Code, en la pestaña Herramientas web, en Permisos de sitios.",
  "browser.state.ready": "listo",
  "browser.state.unavailable": "no disponible",
  "browser.state.readyHint": "Un perfil de Chromium propio de Kilo, iniciado en la primera llamada al navegador",
  "browser.state.extensionHint": "Conecta la extensión de navegador de Kilo para usar tu propio navegador",
  "browser.command.usage":
    "Usa /browser para los ajustes, /browser share para dar a esta sesión tu pestaña activa, o /browser adopt para reutilizar el último grupo de pestañas finalizado.",
  // Browser permission prompt: one class on one origin, or one sensitive step.
  "browser.permission.read.title": "Leer páginas en {{origin}}",
  "browser.permission.act.title": "Hacer clic y escribir en {{origin}}",
  "browser.permission.navigate.title": "Abrir páginas en {{origin}}",
  "browser.permission.read.detail": "Aprobar permite que esta sesión lea páginas en {{origin}} hasta que termine.",
  "browser.permission.act.detail":
    "Aprobar permite que esta sesión haga clic, escriba y ejecute scripts de página en {{origin}} hasta que termine.",
  "browser.permission.navigate.detail": "Aprobar permite que esta sesión abra páginas en {{origin}} hasta que termine.",
  "browser.permission.frame": "Este origen es un marco dentro de la página, no la página en sí.",
  "browser.permission.sensitive.title": "Paso sensible del navegador en {{origin}}",
  "browser.permission.sensitive.reason": "Motivo: {{reason}}",
  "browser.permission.sensitive.once":
    "Solo una persona puede aprobar este paso. La aprobación cubre únicamente este paso.",
  // `/browser share` and `/browser adopt`.
  "browser.share.title": "Compartir la pestaña activa del navegador",
  "browser.share.description": "Mover la pestaña activa de tu navegador al grupo de pestañas de esta sesión",
  "browser.share.done": "Tu pestaña activa ya está en el grupo de pestañas de esta sesión.",
  "browser.adopt.title": "Reutilizar el grupo de pestañas finalizado",
  "browser.adopt.description": "Dar a esta sesión el grupo de pestañas de Kilo finalizado más reciente",
  "browser.adopt.done": "Esta sesión ahora usa el último grupo de pestañas finalizado.",
  "browser.adopt.none": "No hay ningún grupo de pestañas finalizado que reutilizar.",
  "browser.adopt.kept": "Esta sesión ya tiene sus propias pestañas y las conserva.",
  "browser.adopt.unconfirmed":
    "Se pidió al navegador que reutilizara el último grupo de pestañas finalizado. Actualiza la extensión de navegador de Kilo para ver si lo hizo.",
  "browser.control.notExtension":
    "Compartir y reutilizar pestañas requiere la extensión de navegador de Kilo. Elígela en /browser.",
  // Notices for a browser call the user has to act on.
  "browser.notice.unavailableTitle": "Navegador no disponible",
  "browser.notice.outdatedTitle": "Extensión de navegador desactualizada",
  "browser.notice.stopped":
    "Detuviste el navegador para esta sesión. Ejecuta /browser adopt para devolver sus pestañas a la sesión.",

  // Auto-approve toggle for the TUI (`/auto-approve`, Ctrl+Alt+A).
  "tui.autoApprove.title": "Alternar aprobación automática",
  "tui.autoApprove.description": "Aprobar solicitudes de permiso automáticamente para este proceso",
  "tui.autoApprove.enabled": "Aprobación automática activada. Las solicitudes de permiso se aprueban automáticamente.",
  "tui.autoApprove.disabled": "Aprobación automática desactivada.",
}
