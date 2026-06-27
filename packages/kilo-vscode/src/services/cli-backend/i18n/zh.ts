export const dict = {
  "server.processExited": "在服务器启动之前，CLI 进程已退出，代码为 {{code}}",
  "server.startupTimeout": "服务器启动在 {{seconds}} 秒后超时",
  "remote.connected": "Kilo Remote: 已连接",
  "remote.connecting": "Kilo Remote: 正在连接\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete 已暂停。可能的原因：您的 Kilo 账户已无剩余点数，或您配置的 API 密钥（BYOK）已达到配额上限。请添加 Kilo 点数或检查 API 密钥配置，以恢复自动补全。",
  "kilocode:autocomplete.authError.message":
    "由于身份验证问题，Kilo Code Autocomplete 已暂停。可能的原因：您尚未登录 Kilo，或您的 API 密钥（BYOK）无效或缺失。请重新登录，或检查提供商的 API 密钥设置。",
} as const
