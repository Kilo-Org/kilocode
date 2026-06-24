export const dict = {
  "server.processExited": "CLI işlemi sunucu başlamadan önce {{code}} koduyla çıktı",
  "server.startupTimeout": "{{seconds}} saniye sonra sunucu başlatma zaman aşımı",
  "remote.connected": "Kilo Remote: Bağlandı",
  "remote.connecting": "Kilo Remote: Bağlanıyor\u2026",
  "kilocode:autocomplete.creditsExhausted.message":
    "Kilo Code Autocomplete duraklatıldı. Olası nedenler: Kilo hesabınızda kredi kalmamış olabilir veya yapılandırılmış API anahtarınız (BYOK) kota sınırına ulaşmış olabilir. Otomatik tamamlamayı devam ettirmek için Kilo kredisi ekleyin veya API anahtarı yapılandırmanızı kontrol edin.",
  "kilocode:autocomplete.authError.message":
    "Kilo Code Autocomplete, bir kimlik doğrulama sorunu nedeniyle duraklatıldı. Olası nedenler: Kilo'da oturum açmamış olabilirsiniz veya API anahtarınız (BYOK) geçersiz ya da eksik olabilir. Lütfen yeniden oturum açın veya sağlayıcınızın API anahtarı ayarlarını kontrol edin.",
} as const
