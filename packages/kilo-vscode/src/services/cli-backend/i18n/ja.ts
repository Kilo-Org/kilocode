export const dict = {
  "server.processExited": "サーバーが起動する前に、CLI プロセスがコード {{code}} で終了しました",
  "server.startupTimeout": "サーバーの起動が {{seconds}} 秒後にタイムアウトしました",
  "remote.connected": "Kilo Remote: 接続済み",
  "remote.connecting": "Kilo Remote: 接続中\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete は一時停止されています。考えられる原因: Kilo アカウントのクレジット残高がないか、設定済みの API キー（BYOK）がクォータ上限に達しています。オートコンプリートを再開するには、Kilo クレジットを追加するか、API キーの設定を確認してください。",
  "kilocode:autocomplete.authError.message":
    "認証の問題により、Kilo Code Autocomplete は一時停止されています。考えられる原因: Kilo にサインインしていないか、API キー（BYOK）が無効または設定されていません。もう一度サインインするか、プロバイダーの API キー設定を確認してください。",
} as const
