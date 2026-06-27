export const dict = {
  "server.processExited": "Proces CLI zakończył się z kodem {{code}} przed uruchomieniem serwera",
  "server.startupTimeout": "Przekroczono limit czasu uruchamiania serwera po {{seconds}} sekundach",
  "remote.connected": "Kilo Remote: Połączono",
  "remote.connecting": "Kilo Remote: Łączenie\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete zostało wstrzymane. Możliwe przyczyny: na koncie Kilo nie pozostały żadne środki lub skonfigurowany klucz API (BYOK) osiągnął limit wykorzystania. Dodaj środki Kilo lub sprawdź konfigurację klucza API, aby wznowić automatyczne uzupełnianie.",
  "kilocode:autocomplete.authError.message":
    "Kilo Code Autocomplete zostało wstrzymane z powodu problemu z uwierzytelnianiem. Możliwe przyczyny: nie zalogowano się do Kilo lub klucz API (BYOK) jest nieprawidłowy albo go brakuje. Zaloguj się ponownie lub sprawdź ustawienia klucza API dostawcy.",
} as const
