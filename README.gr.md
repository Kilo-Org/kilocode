<!-- kilocode_change - Kilo v1 README adapted for this v2 development branch; root locale paths retained. -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  Ελληνικά |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="96" alt="Kilo Code" src="packages/kilo-vscode/assets/kilo.svg" /></a>
</p>

<p align="center">Ο πράκτορας προγραμματισμού AI ανοικτού κώδικα — Kilo πάνω στο OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Αυτός ο κλάδος είναι προεπισκόπηση ανάπτυξης, όχι το δημοσιευμένο προϊόν Kilo ούτε αναβάθμιση πάνω στη v1. Διατηρεί την αρχική διεπαφή Kilo ενώ μεταφέρει το περιβάλλον εκτέλεσης στη v2. Χρησιμοποιεί ξεχωριστό χώρο `kilo2` και ρητή εισαγωγή. Τα δεδομένα v1 δεν μεταφέρονται αυτόματα.

---

### Εγκατάσταση

Χρησιμοποιήστε Bun 1.4 ή νεότερο. Εγκαταστήστε τις εξαρτήσεις σε αυτό το αντίγραφο και επιλέξτε CLI ή VS Code. Η νέα εγκατάσταση και όλες οι πλατφόρμες δεν έχουν ολοκληρώσει τον έλεγχο έκδοσης. Τα δημοσιευμένα πακέτα npm και οι εκδόσεις Marketplace δεν εγκαθιστούν αυτόν τον κλάδο.

```sh
bun install
```

#### CLI

Ανοίξτε το διαδραστικό Kilo CLI. Μπορείτε να ορίσετε φάκελο έργου, π.χ. `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Δημιουργήστε και ανοίξτε την αρχική επέκταση Kilo σε απομονωμένο προφίλ ανάπτυξης VS Code. Εγκαταστήστε το VS Code και προσθέστε το `code` στο PATH ή ορίστε το `VSCODE_BIN`. Η επέκταση ξεκινά αυτόματα τον τοπικό διακομιστή. Η μεταφορά παραμένει ημιτελής.

```sh
bun run extension
```

### Πράκτορες

Το **Code** υλοποιεί αλλαγές. Το **Plan** ερευνά, αμφισβητεί παραδοχές, αποθηκεύει σχέδιο και προσφέρει μετάβαση στην υλοποίηση. Το **Ask** απαντά χωρίς επεξεργασία αρχείων. Το **Debug** διερευνά προβλήματα. Υποστηρίζεται ρύθμιση προσαρμοσμένων πρακτόρων. Εργαλεία και άδειες εξαρτώνται από τη διαμόρφωση.

### Τι κάνει

Έχουν υλοποιηθεί τμήματα συνομιλιών, εργαλείων και αδειών, μοντέλων και λογαριασμών Gateway, ρυθμίσεων, μνήμης, ευρετηρίασης, απομόνωσης και τερματικών. Πλήρης ισοδυναμία VS Code, JetBrains, αυτόματη συμπλήρωση/FIM, ομιλία και ορισμένες ροές cloud εκκρεμούν. Κοινή χρήση, έλεγχος ανεπτυγμένων υπηρεσιών, υπογραφή και διανομή σε όλες τις πλατφόρμες έχουν ανοικτές απαιτήσεις. Η ύπαρξη κώδικα δεν αποδεικνύει ολοκληρωμένη αποδοχή.

### Τεκμηρίωση

Δείτε το σχέδιο μετάβασης και τα σχέδια δοκιμών για την κατάσταση του κλάδου. Η γενική τεκμηρίωση Kilo αφορά το δημοσιευμένο προϊόν και μπορεί να διαφέρει από την προεπισκόπηση.

- [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
- [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Συνεισφορά

Οι συνεισφορές είναι ευπρόσδεκτες. Διαβάστε τον οδηγό συνεισφοράς και τους κανόνες του fork v2 πριν αλλάξετε κοινόχρηστο κώδικα. Κρατήστε τη συμπεριφορά Kilo σε δικά του πακέτα όπου γίνεται, ελέγξτε τα επηρεαζόμενα πακέτα και διατηρήστε την αναφορά προέλευσης.

- [Συνεισφορά](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### Άδεια

[MIT](LICENSE)

### FAQ

<details>
<summary>Από πού προήλθε το Kilo CLI;</summary>

Το Kilo CLI είναι fork του [OpenCode](https://github.com/anomalyco/opencode), βελτιωμένο για να λειτουργεί μέσα στην Kilo agentic engineering platform.

</details>
