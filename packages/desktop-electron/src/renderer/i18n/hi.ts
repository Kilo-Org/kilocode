// Kilo-specific translations and overrides
// Language: Hindi (hi)
// Validated: April 4, 2026 — back-translation + native Hindi linguistic review
// Keys here will override any matching keys from upstream translations

export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.line1":
    "Kilo Gateway आपको कोडिंग एजेंटों के लिए विश्वसनीय, चुने हुए और अनुकूलित मॉडलों के एक सेट तक पहुंच प्रदान करता है।",
  "provider.connect.kiloGateway.line2":
    "एक API key से आपको Claude, GPT, Gemini, GLM और अन्य मॉडलों का एक्सेस मिलेगा।",
  "provider.connect.kiloGateway.visit.prefix": "देखें ",
  "provider.connect.kiloGateway.visit.link": "kilo.ai",
  "provider.connect.kiloGateway.visit.suffix": " पर जाकर अपनी API key लें।",

  // Provider dialog translations
  "dialog.provider.group.recommended": "अनुशंसित",
  "dialog.provider.kilo.note": "500+ AI मॉडलों का एक्सेस",

  // UI labels
  "ui.permission.run": "चलाएं",
  "ui.reasoning.label": "तर्क",

  // Marketplace tabs
  "marketplace.tab.skills": "Skills",
  "marketplace.tab.mcpServers": "MCP Servers",
  "marketplace.tab.modes": "Modes",
  "marketplace.tab.mcp": "MCP",

  // Marketplace general
  "marketplace.category.all": "सभी",
  "marketplace.placeholder": "जल्द आ रहा है",
  "marketplace.search": "खोजें...",
  "marketplace.empty": "कोई आइटम नहीं मिले",

  // Marketplace filters
  "marketplace.filter.all": "सभी आइटम",
  "marketplace.filter.notInstalled": "इंस्टॉल नहीं",
  "marketplace.filter.installed": "इंस्टॉल किए गए",

  // Marketplace card actions
  "marketplace.card.installed": "इंस्टॉल है",
  "marketplace.card.install": "इंस्टॉल करें",
  "marketplace.card.remove": "हटाएं",
  "marketplace.card.removeScope": "हटाएं ({{scope}})",
  "marketplace.card.showMore": "और दिखाएं",
  "marketplace.card.showLess": "कम दिखाएं",
  "marketplace.card.by": "{{author}} द्वारा",

  // Marketplace badges
  "marketplace.badge.mcpServer": "MCP Server",
  "marketplace.badge.mode": "Mode",

  // Marketplace install flow
  "marketplace.install": "इंस्टॉल करें",
  "marketplace.install.title": "{{name}} इंस्टॉल करें",
  "marketplace.install.scope": "दायरा",
  "marketplace.install.scope.project": "प्रोजेक्ट",
  "marketplace.install.scope.global": "ग्लोबल",
  "marketplace.install.prerequisites": "पूर्वशर्तें",
  "marketplace.install.method": "इंस्टॉलेशन विधि",
  "marketplace.install.parameters": "पैरामीटर",
  "marketplace.install.optional": "(वैकल्पिक)",
  "marketplace.install.required": "{{name}} आवश्यक है",
  "marketplace.install.installing": "इंस्टॉल हो रहा है...",
  "marketplace.install.cancel": "रद्द करें",
  "marketplace.install.success": "सफलतापूर्वक इंस्टॉल हो गया!",
  "marketplace.install.failed": "इंस्टॉलेशन विफल हुई",
  "marketplace.install.done": "हो गया",
  "marketplace.install.close": "बंद करें",

  // Marketplace scope labels
  "marketplace.scope.project": "प्रोजेक्ट",
  "marketplace.scope.global": "ग्लोबल",

  // Marketplace remove flow
  "marketplace.remove.title": "{{name}} हटाएं?",
  "marketplace.remove.confirm":
    "क्या आप वाकई इस {{type}} को हटाना चाहते हैं? यह आपकी {{scope}} कॉन्फिगरेशन से हट जाएगा।",
  "marketplace.remove.cancel": "रद्द करें",
  "marketplace.remove.confirm.button": "हटाएं",
  "marketplace.remove.failed": "{{name}} हटाने में विफल",

  // Marketplace remove type labels
  "marketplace.remove.type.mcp": "MCP server",
  "marketplace.remove.type.skill": "skill",
  "marketplace.remove.type.mode": "mode",

  // Marketplace error / warning states
  "marketplace.error.dismiss": "खारिज करें",
  "marketplace.warning.busyOne": "एक सेशन चल रहा है और बाधित होगा।",
  "marketplace.warning.busyMany": "कई सेशन चल रहे हैं और बाधित होंगे।",
  "marketplace.warning.installAnyway": "फिर भी इंस्टॉल करें",
  "marketplace.warning.cancel": "रद्द करें",
}
