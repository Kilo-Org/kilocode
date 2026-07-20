export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.line1":
    "O Kilo Gateway oferece acesso a um conjunto selecionado de modelos confiáveis e otimizados para agentes de codificação.",
  "provider.connect.kiloGateway.line2":
    "Com uma única chave de API, você terá acesso a modelos como Claude, GPT, Gemini, GLM e mais.",
  "provider.connect.kiloGateway.visit.prefix": "Visite ",
  "provider.connect.kiloGateway.visit.link": "kilo.ai",
  "provider.connect.kiloGateway.visit.suffix": " para obter sua chave de API.",
  "provider.connect.kiloGateway.byok.prefix": "Para mais estatísticas de uso, utilize ",
  "provider.connect.kiloGateway.byok.link": "BYOK via Kilo's Gateway",
  "provider.connect.kiloGateway.byok.suffix": ".",

  // Provider settings translations
  "settings.providers.group.recommended": "Recomendados",
  "settings.providers.note.kilo": "Acesso a mais de 500 modelos de IA",
  "settings.providers.note.opencode": "Modelos selecionados, incluindo Claude, GPT, Gemini e mais",
  "settings.providers.note.anthropic": "Acesso direto aos modelos Claude, incluindo Pro e Max",
  "settings.providers.note.deepseek": "Modelos DeepSeek para tarefas de raciocínio e programação",
  "settings.providers.note.copilot": "Modelos Claude para assistência em programação",
  "settings.providers.note.openai": "Modelos GPT e Codex com chave de API ou login do ChatGPT",
  "settings.providers.note.google": "Modelos Gemini para respostas rápidas e estruturadas",
  "settings.providers.note.openrouter": "Acesse todos os modelos compatíveis em um só provedor",
  "settings.providers.note.vercel": "Acesso unificado a modelos de IA com roteamento inteligente",

  // Reasoning block label
  "ui.permission.run": "Executar",
  "ui.reasoning.label": "Raciocínio",

  // Marketplace
  "marketplace.tab.skills": "Skills",
  "marketplace.tab.mcpServers": "Servidores MCP",
  "marketplace.category.all": "Todos",
  "marketplace.placeholder": "A ser implementado",
  "marketplace.card.installed": "Instalado",
  "marketplace.card.install": "Instalar",
  "marketplace.card.remove": "Remover",
  "marketplace.card.removeScope": "Remover ({{scope}})",
  "marketplace.card.showMore": "Mostrar mais",
  "marketplace.card.showLess": "Mostrar menos",
  "marketplace.install.title": "Instalar {{name}}",
  "marketplace.install.scope": "Escopo",
  "marketplace.install.scope.project": "Projeto",
  "marketplace.install.scope.global": "Global",
  "marketplace.install.scope.project.description":
    "Somente este projeto. Os arquivos instalados podem ser adicionados ao controle de versão e compartilhados com sua equipe.",
  "marketplace.install.scope.global.description":
    "Todos os projetos nesta máquina. Armazenado na sua configuração de usuário.",
  "marketplace.install.destination": "Destino da instalação",
  "marketplace.install.about.mcp":
    "Um servidor MCP fornece ao Kilo ferramentas adicionais para trabalhar com serviços externos ou programas locais.",
  "marketplace.install.about.agent": "Um agente adiciona uma função reutilizável com instruções e permissões próprias.",
  "marketplace.install.about.skill":
    "Uma habilidade adiciona instruções e recursos específicos para tarefas que o Kilo pode carregar quando necessário.",
  "marketplace.install.mcp.warning":
    "Servidores MCP podem executar comandos locais ou se conectar a serviços externos. O Kilo solicitará permissão antes de usar suas ferramentas, a menos que suas permissões permitam isso automaticamente.",
  "marketplace.install.project.warning":
    "Os arquivos do projeto podem ser adicionados ao controle de versão. Não armazene segredos aqui, a menos que a configuração faça referência a uma variável de ambiente.",
  "marketplace.install.learnMore": "Saiba como funcionam as instalações do Marketplace",
  "marketplace.install.learnMcp": "Saiba mais sobre MCP",
  "marketplace.install.installedAt": "Instalado em {{path}}",
  "marketplace.intro": "Instale agentes, habilidades e ferramentas MCP reutilizáveis em um projeto ou em todos os projetos.",
  "marketplace.intro.learnMore": "Sobre o Marketplace",
  "marketplace.install.prerequisites": "Pré-requisitos",
  "marketplace.install.installing": "Instalando...",
  "marketplace.install.cancel": "Cancelar",
  "marketplace.install.success": "Instalado com sucesso!",
  "marketplace.install.failed": "Falha na instalação",
  "marketplace.install.done": "Concluído",
  "marketplace.install.close": "Fechar",
  "marketplace.remove.title": "Remover {{name}}?",
  "marketplace.remove.confirm":
    "Tem certeza que deseja remover este {{type}}? Isso o removerá da sua configuração {{scope}}.",
  "marketplace.remove.cancel": "Cancelar",
  "marketplace.remove.confirm.button": "Remover",
  "marketplace.tab.mcp": "MCP",
  "marketplace.tab.agents": "Agentes",
  "marketplace.search": "Pesquisar...",
  "marketplace.filter.all": "Todos os Itens",
  "marketplace.filter.notInstalled": "Não Instalado",
  "marketplace.filter.relevant": "Relevantes para meu espaço de trabalho",
  "marketplace.empty": "Nenhum item encontrado",
  "marketplace.empty.relevant": "Nenhum item relevante do marketplace foi encontrado para este espaço de trabalho.",
  "marketplace.badge.mcpServer": "Servidor MCP",
  "marketplace.badge.mode": "Modo",
  "marketplace.card.by": "por {{author}}",
  "marketplace.install.method": "Método de Instalação",
  "marketplace.install.parameters": "Parâmetros",
  "marketplace.install.optional": "(opcional)",
  "marketplace.install.required": "{{name}} é obrigatório",
  "marketplace.scope.project": "projeto",
  "marketplace.scope.global": "global",
  "marketplace.remove.type.mcp": "servidor MCP",
  "marketplace.remove.type.skill": "habilidade",
  "marketplace.remove.type.agent": "agente",
  "marketplace.remove.failed": "Falha ao remover {{name}}",
  "marketplace.install": "Instalar",
  "marketplace.filter.installed": "Instalado",
  "marketplace.error.dismiss": "Dispensar",
  "marketplace.warning.busyOne": "Uma sessão está em execução e será interrompida",
  "marketplace.warning.busyMany": "Várias sessões estão em execução e serão interrompidas",
  "marketplace.warning.installAnyway": "Instalar mesmo assim",
  "marketplace.warning.cancel": "Cancelar",
  "marketplace.contribute.prompt": "Está faltando uma skill, agente ou servidor MCP?",
  "marketplace.contribute.cta": "Contribuir no GitHub",
  "marketplace.migration.notice":
    "Os modos foram substituídos por agentes. Se você instalou modos do marketplace anteriormente, remova-os e reinstale-os como agentes para migrar para o novo formato.",

  // Plan follow-up question shown after plan_exit
  "plan.followup.header": "Implementar",
  "plan.followup.question": "Pronto para implementar?",
  "plan.followup.answer.newSession": "Iniciar nova sessão",
  "plan.followup.answer.newSession.description": "Implementar em uma nova sessão com contexto limpo",
  "plan.followup.answer.newSession.recommended.description": "Implementar em uma nova sessão com contexto limpo (Recomendado)",
  "plan.followup.answer.continue": "Continuar aqui",
  "plan.followup.answer.continue.description": "Implementar o plano nesta sessão",
  "plan.followup.answer.continue.estimated.description": "Implementar o plano nesta sessão (usando {{0}}% do contexto do modo de código)",
  "plan.followup.answer.keepRefining": "Continuar refinando",
  "plan.followup.answer.keepRefining.description": "Continuar planejando sem implementar ainda",

  // Slow-repo snapshot prompt
  "snapshot.slowRepo.header": "Snapshot está lento",
  "snapshot.slowRepo.question":
    "Está demorando muito para inicializar o sistema de snapshots, provavelmente por causa do tamanho do repositório.\n\nDeseja desativar os snapshots para este repositório?",
  "snapshot.slowRepo.answer.continue": "Continuar com snapshots",
  "snapshot.slowRepo.answer.continue.description":
    "Aguarde a conclusão do snapshot. Os próximos turnos serão rápidos depois que o snapshot inicial for criado.",
  "snapshot.slowRepo.answer.disable": "Desativar para este projeto",
  "snapshot.slowRepo.answer.disable.description":
    "Desligue os snapshots do Kilo para este projeto. Você perde desfazer/refazer das mudanças feitas pelo Kilo, mas o git continua rastreando tudo.",

  // Edit-tool header and shell-tool section labels
  "ui.messagePart.openInDiffViewer": "Abrir no Visualizador de Diferenças",
  "ui.messagePart.shell.command": "Comando",
  "ui.messagePart.shell.output": "Saída",
  "ui.messagePart.openInEditor": "Abrir no Editor",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Isso foi útil",
  "ui.message.feedback.notHelpful": "Isso não foi útil",
  "ui.message.feedback.clearRating": "Limpar avaliação",
}
