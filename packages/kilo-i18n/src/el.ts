// Kilo-specific translations and overrides
// Keys here will override any matching keys from upstream translations
export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.byok.prefix": "Για περισσότερα στατιστικά χρήσης, ",
  "provider.connect.kiloGateway.byok.link": "BYOK μέσω του Gateway της Kilo",
  "provider.connect.kiloGateway.byok.suffix": ".",

  // Provider settings translations
  "settings.providers.group.recommended": "Προτεινόμενα",
  "settings.providers.note.kilo": "Πρόσβαση σε 500+ μοντέλα AI",
  "settings.providers.note.opencode": "Επιλεγμένα μοντέλα όπως Claude, GPT, Gemini και άλλα",
  "settings.providers.note.anthropic": "Άμεση πρόσβαση στα μοντέλα Claude, συμπεριλαμβανομένων Pro και Max",
  "settings.providers.note.deepseek": "Μοντέλα DeepSeek για εργασίες συλλογισμού και προγραμματισμού",
  "settings.providers.note.copilot": "Μοντέλα Claude για υποστήριξη προγραμματισμού",
  "settings.providers.note.openai": "Μοντέλα GPT και Codex με κλειδί API ή σύνδεση ChatGPT",
  "settings.providers.note.google": "Μοντέλα Gemini για γρήγορες, δομημένες απαντήσεις",
  "settings.providers.note.openrouter": "Πρόσβαση σε όλα τα υποστηριζόμενα μοντέλα από έναν πάροχο",
  "settings.providers.note.vercel": "Ενιαία πρόσβαση σε μοντέλα AI με έξυπνη δρομολόγηση",

  // Reasoning block label
  "ui.reasoning.label": "Συλλογισμός",

  // Marketplace
  "marketplace.card.installed": "Εγκαταστάθηκε",
  "marketplace.card.install": "Εγκατάσταση",
  "marketplace.card.remove": "Κατάργηση",
  "marketplace.card.removeScope": "Κατάργηση ({{scope}})",
  "marketplace.card.showMore": "Εμφάνιση περισσότερων",
  "marketplace.card.showLess": "Εμφάνιση λιγότερων",
  "marketplace.install.title": "Εγκατάσταση {{name}}",
  "marketplace.install.scope": "Πού πρέπει να είναι διαθέσιμο;",
  "marketplace.install.scope.project": "Έργο",
  "marketplace.install.scope.global": "Καθολικά",
  "marketplace.install.scope.project.description":
    "Μόνο σε αυτό το έργο. Τα εγκατεστημένα αρχεία μπορούν να γίνουν commit και να μοιραστούν με την ομάδα σας.",
  "marketplace.install.scope.global.description":
    "Σε όλα τα έργα αυτού του υπολογιστή. Αποθηκεύονται στη διαμόρφωση χρήστη σας.",
  "marketplace.install.destination": "Προορισμός εγκατάστασης",
  "marketplace.install.includedSkills": "Συμπεριλαμβανόμενες δεξιότητες",
  "marketplace.install.about.mcp":
    "Ένας διακομιστής MCP δίνει στην Kilo πρόσθετα εργαλεία για εργασία με εξωτερικές υπηρεσίες ή τοπικά προγράμματα.",
  "marketplace.install.about.agent":
    "Ένας πράκτορας προσθέτει έναν επαναχρησιμοποιήσιμο ρόλο με τις δικές του οδηγίες και άδειές του.",
  "marketplace.install.about.skill":
    "Μια δεξιότητα προσθέτει οδηγίες και πόρους ειδικούς για συγκεκριμένες εργασίες, που η Kilo μπορεί να φορτώνει όταν χρειάζεται.",
  "marketplace.install.about.plugin":
    "Ένα πρόσθετο προσθέτει προσαρμοσμένα εργαλεία και ενσωματώσεις στην Kilo. Τα πρόσθετα εκτελούνται με πλήρεις άδειες.",
  "marketplace.install.mcp.warning":
    "Οι διακομιστές MCP μπορούν να εκτελούν τοπικές εντολές ή να συνδέονται σε εξωτερικές υπηρεσίες. Η Kilo θα ζητήσει άδεια πριν χρησιμοποιήσει τα εργαλεία τους, εκτός αν οι άδειές σας τα επιτρέπουν αυτόματα.",
  "marketplace.install.plugin.warning":
    "Τα πρόσθετα εκτελούν κώδικα με πλήρεις άδειες. Μπορούν να διαβάσουν και να αλλάξουν τα αρχεία σας, να εκτελέσουν εντολές και να έχουν πρόσβαση στα διαπιστευτήρια και το δίκτυό σας. Εγκαταστήστε μόνο πρόσθετα που εμπιστεύεστε.",
  "marketplace.install.project.warning":
    "Τα αρχεία του έργου μπορεί να μπουν στον έλεγχο εκδόσεων. Μην αποθηκεύετε μυστικά εδώ, εκτός αν η διαμόρφωση αναφέρεται σε μεταβλητή περιβάλλοντος.",
  "marketplace.install.learnMore": "Μάθετε πώς λειτουργούν οι εγκαταστάσεις Marketplace",
  "marketplace.install.learnMcp": "Μάθετε περισσότερα για το MCP",
  "marketplace.intro":
    "Εγκαταστήστε επαναχρησιμοποιήσιμους πράκτορες, δεξιότητες, εργαλεία MCP και πρόσθετα για ένα έργο ή για κάθε έργο.",
  "marketplace.intro.learnMore": "Σχετικά με το Marketplace",
  "marketplace.install.prerequisites": "Προαπαιτούμενα",
  "marketplace.install.installing": "Εγκατάσταση...",
  "marketplace.install.cancel": "Ακύρωση",
  "marketplace.install.success": "Εγκαταστάθηκε με επιτυχία!",
  "marketplace.install.failed": "Η εγκατάσταση απέτυχε",
  "marketplace.install.done": "Τέλος",
  "marketplace.install.close": "Κλείσιμο",
  "marketplace.install.mcp.signIn.message":
    "Το {{name}} εγκαταστάθηκε αλλά χρειάζεται σύνδεση πριν μπορέσουν να χρησιμοποιηθούν τα εργαλεία του.",
  "marketplace.install.mcp.signIn.button": "Σύνδεση",
  "marketplace.install.mcp.signIn.waiting": "Αναμονή για σύνδεση μέσω περιηγητή…",
  "marketplace.install.mcp.signIn.cancel": "Ακύρωση",
  "marketplace.install.mcp.signIn.skip": "Αργότερα",
  "marketplace.install.mcp.signIn.success": "Συνδεθήκατε στο {{name}}.",
  "marketplace.install.mcp.signIn.failed": "Η σύνδεση στο {{name}} απέτυχε.",
  "marketplace.remove.title": "Κατάργηση {{name}};",
  "marketplace.remove.confirm":
    "Είστε βέβαιοι ότι θέλετε να καταργήσετε αυτό το {{type}}; Αυτό θα το καταργήσει από τη διαμόρφωση {{scope}} σας.",
  "marketplace.remove.cancel": "Ακύρωση",
  "marketplace.remove.mcp.skills":
    "Αυτό καταργεί επίσης τις συνοδές δεξιότητες που ανήκουν σε αυτή την εγκατάσταση. Οι ανεξάρτητα εγκατεστημένες δεξιότητες παραμένουν.",
  "marketplace.remove.confirm.button": "Κατάργηση",
  "marketplace.search": "Αναζήτηση...",
  "marketplace.filter.all": "Όλα τα στοιχεία",
  "marketplace.filter.notInstalled": "Μη εγκατεστημένα",
  "marketplace.filter.relevant": "Σχετικά με τον χώρο εργασίας μου",
  "marketplace.empty": "Δεν βρέθηκαν στοιχεία",
  "marketplace.empty.relevant": "Δεν βρέθηκαν σχετικά στοιχεία marketplace για αυτόν τον χώρο εργασίας.",
  "marketplace.badge.mcpServer": "Διακομιστής MCP",
  "marketplace.badge.skills": "Περιλαμβάνει δεξιότητες",
  "marketplace.card.by": "από {{author}}",
  "marketplace.install.method": "Μέθοδος εγκατάστασης",
  "marketplace.install.agent.mode": "λειτουργία: {{mode}}",
  "marketplace.install.agent.steps": "βήματα: {{steps}}",
  "marketplace.install.parameters": "Παράμετροι",
  "marketplace.install.optional": "(προαιρετικό)",
  "marketplace.scope.project": "έργο",
  "marketplace.scope.global": "καθολικά",
  "marketplace.remove.type.mcp": "διακομιστή MCP",
  "marketplace.remove.type.skill": "δεξιότητα",
  "marketplace.remove.type.agent": "πράκτορα",
  "marketplace.remove.type.plugin": "πρόσθετο",
  "marketplace.remove.failed": "Η κατάργηση του {{name}} απέτυχε",
  "marketplace.install": "Εγκατάσταση",
  "marketplace.filter.installed": "Εγκατεστημένα",
  "marketplace.error.dismiss": "Απόρριψη",
  "marketplace.warning.busyOne": "Μια συνεδρία εκτελείται και θα διακοπεί",
  "marketplace.warning.busyMany": "Πολλαπλές συνεδρίες εκτελούνται και θα διακοπούν",
  "marketplace.warning.installAnyway": "Εγκατάσταση ούτως ή άλλως",
  "marketplace.warning.cancel": "Ακύρωση",
  "marketplace.contribute.prompt": "Λείπει μια δεξιότητα, ένας πράκτορας, ένας διακομιστής MCP ή ένα πρόσθετο;",
  "marketplace.contribute.cta": "Συνεισφορά στο GitHub",
  "marketplace.migration.notice":
    "Οι λειτουργίες έχουν αντικατασταθεί από τους πράκτορες. Είχατε εγκαταστήσει λειτουργίες marketplace, καταργήστε τις και εγκαταστήστε τις εκ νέου ως πράκτορες για να μεταβείτε στη νέα μορφή.",
  "marketplace.intro.v2":
    "Εγκαταστήστε επαναχρησιμοποιήσιμους πράκτορες, δεξιότητες και εργαλεία MCP για ένα έργο ή για κάθε έργο.",
  "marketplace.contribute.prompt.v2": "Λείπει μια δεξιότητα, ένας πράκτορας ή ένας διακομιστής MCP;",
  "marketplace.status.missing": "Λείπουν αρχεία",
  "marketplace.status.modified": "Τροποποιήθηκε τοπικά",
  "marketplace.status.incomplete": "Ατελές",
  "marketplace.status.recovering": "Ανάκτηση",
  "marketplace.card.repair": "Επισκευή",
  "marketplace.card.reinstall": "Επανεγκατάσταση",
  "marketplace.card.modified":
    "Οι τοπικές αλλαγές προστατεύονται· καταργήστε το χειροκίνητα αν δεν το θέλετε πια.",
  "marketplace.installed.empty": "Δεν έχουν εγκατασταθεί στοιχεία marketplace.",
  "marketplace.install.config": "Αρχείο διαμόρφωσης",
  "marketplace.install.server": "Διαμόρφωση διακομιστή",
  "marketplace.install.secrets": "Μυστικά",
  "marketplace.install.secret.warning":
    "Αυτές οι τιμές αποθηκεύονται ως απλό κείμενο στη διαμόρφωση MCP: {{secrets}}.",
  "marketplace.install.secret.project":
    "Μην κάνετε commit αυτή τη διαμόρφωση αν περιέχει μυστικά· χρησιμοποιήστε μεταβλητή περιβάλλοντος.",
  "marketplace.install.agent.warning":
    "Αυτός ο πράκτορας προσθέτει οδηγίες και άδειες που ισχύουν κάθε φορά που εκτελείται. Ελέγξτε τις πριν την εγκατάσταση.",
  "marketplace.install.skill.warning":
    "Οι δεξιότητες προσθέτουν οδηγίες και πόρους που η Kilo φορτώνει όταν μια εργασία τους χρειάζεται.",
  "marketplace.install.warnings": "Προειδοποιήσεις εγκατάστασης",
  "marketplace.remove.keepsSignIn": "Τυχόν υπάρχουσα σύνδεση για αυτόν τον διακομιστή διατηρείται.",

  // Plan follow-up question shown after plan_exit. The English strings here must match
  // the canonical `label`/`header`/`question` sent by the backend — those canonical labels
  // are still what the backend matches on (see packages/kilo-plugin/src/plan/plan-followup.ts).
  "plan.followup.header": "Υλοποίηση",
  "plan.followup.question": "Έτοιμοι για υλοποίηση;",
  "plan.followup.answer.newSession": "Έναρξη νέας συνεδρίας",
  "plan.followup.answer.newSession.description": "Υλοποίηση σε νέα συνεδρία με καθαρό πλαίσιο",
  "plan.followup.answer.continue": "Συνέχεια εδώ",
  "plan.followup.answer.continue.description": "Υλοποίηση του σχεδίου σε αυτή τη συνεδρία",
  "plan.followup.answer.keepRefining": "Συνέχεια βελτίωσης",
  "plan.followup.answer.keepRefining.description": "Συνέχεια σχεδιασμού χωρίς υλοποίηση ακόμη",

  // Slow-repo snapshot prompt. The English strings here are the canonical
  // labels sent by the backend and must stay in sync with
  // packages/opencode/src/kilocode/snapshot/track.ts.
  "snapshot.slowRepo.header": "Το στιγμιότυπο είναι αργό",
  "snapshot.slowRepo.question":
    "Η αρχικοποίηση του συστήματος στιγμιοτύπων διαρκεί πολύ, πιθανόν λόγω του μεγέθους του αποθετηρίου.\n\nΘέλετε να απενεργοποιηθούν τα στιγμιότυπα για αυτό το αποθετήριο;",
  "snapshot.slowRepo.answer.continue": "Συνέχεια με στιγμιότυπα",
  "snapshot.slowRepo.answer.continue.description":
    "Αναμονή μέχρι την ολοκλήρωση του στιγμιοτύπου. Οι επόμενες γύροι είναι γρήγοροι αφού δημιουργηθεί το αρχικό στιγμιότυπο.",
  "snapshot.slowRepo.answer.disable": "Απενεργοποίηση για αυτό το έργο",
  "snapshot.slowRepo.answer.disable.description":
    "Απενεργοποίηση των στιγμιοτύπων της Kilo για αυτό το έργο. Θα χάσετε την αναίρεση/επανάληψη των αλλαγών αρχείων της Kilo, αλλά το git συνεχίζει να παρακολουθεί όλα.",

  // Edit-tool header: hover-revealed action opening the diff in a full tab.
  "ui.messagePart.openInDiffViewer": "Άνοιγμα στην Προβολή Διαφορών",
  // Shell-tool section labels and actions.
  "ui.messagePart.openInEditor": "Άνοιγμα στον Επεξεργαστή",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "Αυτό ήταν χρήσιμο",
  "ui.message.feedback.notHelpful": "Αυτό δεν ήταν χρήσιμο",
  "ui.message.feedback.clearRating": "Καθαρισμός αξιολόγησης",
  // Chart tool card
  "ui.tool.chart": "Γράφημα",
  "ui.tool.chart.invalid": "Μη έγκυρη διαμόρφωση γραφήματος — πρέπει να περιλαμβάνει τύπο και δεδομένα",
  "ui.tool.chart.failed": "Η απόδοση του γραφήματος απέτυχε",
  // Browser tools: backend, observation, sensitive steps and origin grants.
  "browser.command.title": "Ρυθμίσεις περιηγητή",
  "browser.command.starting": "Η Kilo εξακολουθεί να ξεκινά. Δοκιμάστε ξανά σε λίγο.",
  "browser.command.description":
    "Εμφάνιση του backend του περιηγητή, αν μπορεί να εκτελεστεί, και των αδειών προέλευσης",
  "browser.command.backend": "Backend",
  "browser.command.observation": "Παρατήρηση",
  "browser.command.sensitive": "Ευαίσθητα βήματα",
  "browser.command.grants": "Άδειες προέλευσης",
  "browser.backend.playwright": "Ενσωματωμένος περιηγητής (Playwright)",
  "browser.backend.extension": "Επέκταση περιηγητή Kilo",
  "browser.backend.off": "Απενεργοποιημένο",
  "browser.backend.offHint": "Απόκρυψη των εργαλείων περιηγητή από τους πράκτορες",
  "browser.observation.full": "Πλήρες στιγμιότυπο",
  "browser.observation.diff": "Μόνο ό,τι άλλαξε",
  "browser.observation.none": "Μόνο κατάσταση",
  "browser.sensitive.allowed": "εκτέλεση χωρίς ερώτηση",
  "browser.sensitive.asks": "ερώτηση σε άνθρωπο",
  "browser.grants.title": "Άδειες προέλευσης περιηγητή",
  "browser.grants.none": "Κανόνες προέλευσης ακόμη",
  "browser.grants.all": "κάθε προέλευση επιτρέπεται",
  "browser.grants.everyOriginAsk": "κάθε προέλευση → ερώτηση",
  "browser.grants.everyOriginDeny": "κάθε προέλευση → άρνηση",
  "browser.grants.editHint":
    "Επεξεργαστείτε τους κανόνες στις ρυθμίσεις Kilo Code, καρτέλα Web Tools, κάτω από Άδειες ιστοτόπων.",
  "browser.state.ready": "έτοιμο",
  "browser.state.unavailable": "μη διαθέσιμο",
  "browser.state.readyHint": "Προφίλ Chromium που ανήκει στην Kilo, ξεκινά από την πρώτη κλήση περιηγητή",
  "browser.state.extensionHint":
    "Συνδέστε την επέκταση περιηγητή Kilo για να ελέγχετε τον δικό σας περιηγητή",
  "browser.command.usage":
    "Χρησιμοποιήστε /browser για ρυθμίσεις, /browser share για να δώσετε σε αυτή τη συνεδρία την ενεργή καρτέλα σας, ή /browser adopt για να επαναχρησιμοποιήσετε την τελευταία ομάδα καρτελών που έκλεισε.",
  // Browser permission prompt: one class on one origin, or one sensitive step.
  "browser.permission.read.title": "Ανάγνωση σελίδων στο {{origin}}",
  "browser.permission.act.title": "Κλικ και πληκτρολόγηση στο {{origin}}",
  "browser.permission.navigate.title": "Άνοιγμα σελίδων στο {{origin}}",
  "browser.permission.read.detail":
    "Η έγκριση επιτρέπει σε αυτή τη συζήτηση να διαβάζει σελίδες στο {{origin}} μέχρι να τελειώσει.",
  "browser.permission.act.detail":
    "Η έγκριση επιτρέπει σε αυτή τη συζήτηση να κάνει κλικ, να πληκτρολογεί και να εκτελεί σενάρια σελίδας στο {{origin}} μέχρι να τελειώσει.",
  "browser.permission.navigate.detail":
    "Η έγκριση επιτρέπει σε αυτή τη συζήτηση να ανοίγει σελίδες στο {{origin}} μέχρι να τελειώσει.",
  "browser.permission.frame": "Αυτή η προέλευση είναι πλαίσιο μέσα στη σελίδα, όχι η ίδια η σελίδα.",
  "browser.permission.sensitive.title": "Ευαίσθητο βήμα περιηγητή στο {{origin}}",
  "browser.permission.sensitive.reason": "Λόγος: {{reason}}",
  "browser.permission.sensitive.once":
    "Μόνο ένας άνθρωπος μπορεί να εγκρίνει αυτό το βήμα. Η έγκριση καλύπτει μόνο αυτό το βήμα.",
  // `/browser share` and `/browser adopt`.
  "browser.share.title": "Κοινοποίηση ενεργής καρτέλας περιηγητή",
  "browser.share.description": "Μεταφορά της ενεργής καρτέλας του περιηγητή σας στην ομάδα καρτελών αυτής της συνεδρίας",
  "browser.share.done": "Η ενεργή καρτέλα σας βρίσκεται τώρα στην ομάδα καρτελών αυτής της συνεδρίας.",
  "browser.adopt.title": "Επαναχρησιμοποίηση ομάδας καρτελών που έκλεισε",
  "browser.adopt.description": "Δώστε σε αυτή τη συνεδρία την πιο πρόσφατη ομάδα καρτελών Kilo που έκλεισε",
  "browser.adopt.done": "Αυτή η συνεδρία χρησιμοποιεί τώρα την τελευταία ομάδα καρτελών που έκλεισε.",
  "browser.adopt.none": "Δεν υπάρχει ομάδα καρτελών που έκλεισε για επαναχρησιμοποίηση.",
  "browser.adopt.kept": "Αυτή η συνεδρία έχει ήδη τις δικές της καρτέλες και τις διατηρεί.",
  "browser.adopt.unconfirmed":
    "Ζητήθηκε από τον περιηγητή να επαναχρησιμοποιήσει την τελευταία ομάδα καρτελών που έκλεισε. Ενημερώστε την επέκταση περιηγητή Kilo για να δείτε αν το έκανε.",
  "browser.control.notExtension":
    "Η κοινοποίηση και η επαναχρησιμοποίηση καρτελών απαιτούν την επέκταση περιηγητή Kilo. Επιλέξτε την στο /browser.",
  "browser.control.organizationOff": "Ο οργανισμός σας απενεργοποίησε τον έλεγχο περιηγητή στην Kilo.",
  // Notices for a browser call the user has to act on.
  "browser.notice.unavailableTitle": "Ο περιηγητής δεν είναι διαθέσιμος",
  "browser.notice.outdatedTitle": "Η επέκταση περιηγητής είναι παλιάς έκδοσης",
  "browser.notice.stopped":
    "Σταματήσατε τον περιηγητή για αυτή τη συνεδρία. Εκτελέστε /browser adopt για να του επιστρέψετε τις καρτέλες του.",
  "browser.notice.extension":
    "Η επέκταση περιηγητή Kilo είναι συνδεδεμένη στον {{browser}}. Θέλετε να χρησιμοποιηθεί ο δικός σας περιηγητής για τα εργαλεία περιηγητή αντί για τον ενσωματωμένο;",
  "browser.notice.switch": "Χρήση του δικού μου περιηγητή",
  "settings.browser.status.extension.waiting": "Αναμονή για την επέκταση περιηγητή",
  "settings.browser.origins.saved.title": "Επιτρέπονται σε συζητήσεις",
  "settings.browser.origins.saved.description":
    "Ιστότοποι που επιτρέψατε από συζήτηση με «Πάντα άδεια», για αυτόν τον χώρο εργασίας. Ισχύουν επιπλέον των παραπάνω κανόνων.",
  "settings.browser.origins.saved.empty": "Κανένας ιστότοπος δεν έχει επιτραπεί από συζήτηση ακόμη.",
  "settings.browser.origins.saved.failed": "Οι αποθηκευμένες άδειες δεν είναι διαθέσιμες",
  "settings.browser.origins.saved.revoke": "Ανάκληση",
  "ui.permission.reason": "Λόγος: {{reason}}",

  // Auto-approve toggle for the TUI (`/auto-approve`, Ctrl+Alt+A).
  "tui.autoApprove.title": "Εναλλαγή αυτόματης έγκρισης",
  "tui.autoApprove.description":
    "Αυτόματη έγκριση των αιτημάτων αδειών για κάθε πελάτη και απομνημόνευση αυτής της ρύθμισης",
  "tui.autoApprove.enabled": "Η αυτόματη έγκριση είναι ενεργή. Τα αιτήματα αδειών εγκρίνονται αυτόματα.",
  "tui.autoApprove.disabled": "Η αυτόματη έγκριση είναι ανενεργή.",
  "tui.autoApprove.projectDisabled": "Η αυτόματη έγκριση είναι ανενεργή από τη διαμόρφωση αυτού του έργου.",
  "tui.autoApprove.saveFailed": "Αδυναμία αποθήκευσης της ρύθμισης αυτόματης έγκρισης.",

  // Session transcript export
  "session.export.success": "Το αντίγραφο της συνεδρίας εξήχθη ως Markdown.",
  "session.export.error": "Η εξαγωγή του αντιγράφου της συνεδρίας απέτυχε",
}
