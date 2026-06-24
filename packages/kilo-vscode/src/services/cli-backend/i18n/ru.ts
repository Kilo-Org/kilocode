export const dict = {
  "server.processExited": "Процесс CLI завершился с кодом {{code}} до запуска сервера",
  "server.startupTimeout": "Время ожидания запуска сервера истекло через {{seconds}} секунд",
  "remote.connected": "Kilo Remote: Подключено",
  "remote.connecting": "Kilo Remote: Подключение\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Работа Kilo Code Autocomplete приостановлена. Возможные причины: на вашем аккаунте Kilo закончились кредиты или настроенный API-ключ (BYOK) достиг лимита квоты. Пополните баланс Kilo или проверьте настройки API-ключа, чтобы возобновить автодополнение.",
  "kilocode:autocomplete.authError.message":
    "Работа Kilo Code Autocomplete приостановлена из-за проблемы с аутентификацией. Возможные причины: вы не вошли в Kilo либо ваш API-ключ (BYOK) недействителен или отсутствует. Войдите снова или проверьте настройки API-ключа вашего провайдера.",
} as const
