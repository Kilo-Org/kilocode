export const dict = {
  "server.processExited": "انتهت عملية CLI بالرمز {{code}} قبل بدء الخادم",
  "server.startupTimeout": "انتهت مهلة بدء تشغيل الخادم بعد {{seconds}} ثانية",
  "remote.connected": "Kilo Remote: متصل",
  "remote.connecting": "Kilo Remote: جارٍ الاتصال\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "تم إيقاف Kilo Code Autocomplete مؤقتًا. الأسباب المحتملة: نفاد الرصيد المتبقي في حساب Kilo، أو وصول مفتاح API الذي أعددته (BYOK) إلى حد حصته. أضف رصيدًا إلى Kilo أو تحقق من إعدادات مفتاح API لاستئناف الإكمال التلقائي.",
  "kilocode:autocomplete.authError.message":
    "تم إيقاف Kilo Code Autocomplete مؤقتًا بسبب مشكلة في المصادقة. الأسباب المحتملة: لم تسجّل الدخول إلى Kilo، أو أن مفتاح API الخاص بك (BYOK) غير صالح أو مفقود. يُرجى تسجيل الدخول مرة أخرى أو التحقق من إعدادات مفتاح API لمزوّد الخدمة.",
} as const
