export const dict = {
  "server.processExited": "Процес CLI завершився з кодом {{code}} до запуску сервера",
  "server.startupTimeout": "Час очікування запуску сервера вичерпано після {{seconds}} секунд",
  "remote.connected": "Kilo Remote: Підключено",
  "remote.connecting": "Kilo Remote: Підключення\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Роботу Kilo Code Autocomplete призупинено. Можливі причини: на вашому обліковому записі Kilo не залишилося кредитів або налаштований API-ключ (BYOK) досяг ліміту квоти. Поповніть баланс Kilo або перевірте налаштування API-ключа, щоб відновити автодоповнення.",
  "kilocode:autocomplete.authError.message":
    "Роботу Kilo Code Autocomplete призупинено через проблему з автентифікацією. Можливі причини: ви не ввійшли в Kilo або ваш API-ключ (BYOK) недійсний чи відсутній. Увійдіть знову або перевірте налаштування API-ключа вашого провайдера.",
} as const
