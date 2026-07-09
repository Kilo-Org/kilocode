export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.line1":
    "Kilo Gateway te da acceso a un conjunto seleccionado de modelos optimizados y confiables para agentes de codificación.",
  "provider.connect.kiloGateway.line2":
    "Con una sola clave API tendrás acceso a modelos como Claude, GPT, Gemini, GLM y más.",
  "provider.connect.kiloGateway.visit.prefix": "Visita ",
  "provider.connect.kiloGateway.visit.link": "kilo.ai",
  "provider.connect.kiloGateway.visit.suffix": " para obtener tu clave API.",
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
  "ui.permission.run": "Ejecutar",
  "ui.reasoning.label": "Razonamiento",

  // Marketplace
  "marketplace.tab.skills": "Skills",
  "marketplace.tab.mcpServers": "Servidores MCP",
  "marketplace.category.all": "Todos",
  "marketplace.placeholder": "Por implementar",
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
  "marketplace.install.about.mcp":
    "Un servidor MCP proporciona a Kilo herramientas adicionales para trabajar con servicios externos o programas locales.",
  "marketplace.install.about.agent":
    "Un agente añade un rol reutilizable con sus propias instrucciones y permisos.",
  "marketplace.install.about.skill":
    "Una habilidad añade instrucciones y recursos específicos para tareas que Kilo puede cargar cuando sea necesario.",
  "marketplace.install.mcp.warning":
    "Los servidores MCP pueden ejecutar comandos locales o conectarse a servicios externos. Kilo pedirá permiso antes de usar sus herramientas, a menos que tus permisos lo permitan automáticamente.",
  "marketplace.install.project.warning":
    "Los archivos del proyecto pueden añadirse al control de versiones. No guardes secretos aquí, a menos que la configuración haga referencia a una variable de entorno.",
  "marketplace.install.learnMore": "Descubre cómo funcionan las instalaciones de Marketplace",
  "marketplace.install.learnMcp": "Más información sobre MCP",
  "marketplace.install.installedAt": "Instalado en {{path}}",
  "marketplace.intro": "Instala agentes, habilidades y herramientas MCP reutilizables en uno o todos los proyectos.",
  "marketplace.intro.learnMore": "Acerca de Marketplace",
  "marketplace.install.prerequisites": "Requisitos previos",
  "marketplace.install.installing": "Instalando...",
  "marketplace.install.cancel": "Cancelar",
  "marketplace.install.success": "¡Instalado con éxito!",
  "marketplace.install.failed": "La instalación falló",
  "marketplace.install.done": "Hecho",
  "marketplace.install.close": "Cerrar",
  "marketplace.remove.title": "¿Eliminar {{name}}?",
  "marketplace.remove.confirm":
    "¿Estás seguro de que deseas eliminar este {{type}}? Esto lo eliminará de tu configuración {{scope}}.",
  "marketplace.remove.cancel": "Cancelar",
  "marketplace.remove.confirm.button": "Eliminar",
  "marketplace.tab.mcp": "MCP",
  "marketplace.tab.agents": "Agentes",
  "marketplace.search": "Buscar...",
  "marketplace.filter.all": "Todos los elementos",
  "marketplace.filter.notInstalled": "No instalado",
  "marketplace.filter.relevant": "Relevantes para mi espacio de trabajo",
  "marketplace.empty": "No se encontraron elementos",
  "marketplace.empty.relevant": "No se encontraron elementos relevantes del marketplace para este espacio de trabajo.",
  "marketplace.badge.mcpServer": "Servidor MCP",
  "marketplace.badge.mode": "Modo",
  "marketplace.card.by": "por {{author}}",
  "marketplace.install.method": "Método de instalación",
  "marketplace.install.parameters": "Parámetros",
  "marketplace.install.optional": "(opcional)",
  "marketplace.install.required": "{{name}} es obligatorio",
  "marketplace.scope.project": "proyecto",
  "marketplace.scope.global": "global",
  "marketplace.remove.type.mcp": "servidor MCP",
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
  "marketplace.contribute.prompt": "¿Falta una skill, agente o servidor MCP?",
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
  "ui.messagePart.shell.command": "Comando",
  "ui.messagePart.shell.output": "Salida",
  "ui.messagePart.openInEditor": "Abrir en el editor",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Esto fue útil",
  "ui.message.feedback.notHelpful": "Esto no fue útil",
  "ui.message.feedback.clearRating": "Borrar valoración",
}
