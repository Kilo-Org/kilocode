<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | Türkçe | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">VS Code, JetBrains veya CLI'de AI ile geliştirme yapmak için açık kaynak kodlama ajanı.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code"><img src="https://raster.shields.io/badge/VS_Code_Marketplace-007ACC?style=flat&logo=visualstudiocode&logoColor=white" alt="VS Code Marketplace" height="20"></a>
  <a href="https://www.npmjs.com/package/@kilocode/cli"><img alt="npm" src="https://raster.shields.io/npm/v/@kilocode/cli?style=flat" height="20" /></a>
  <a href="https://x.com/kilocode"><img src="https://raster.shields.io/badge/kilocode-000000?style=flat&logo=x&logoColor=white" alt="X (Twitter)" height="20"></a>
  <a href="https://blog.kilo.ai"><img src="https://raster.shields.io/badge/Blog-555?style=flat&logo=substack&logoColor=white" alt="Blog" height="20"></a>
  <a href="https://kilo.ai/discord"><img src="https://raster.shields.io/badge/Join%20Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord" height="20"></a>
  <a href="https://www.reddit.com/r/kilocode/"><img src="https://raster.shields.io/badge/Join%20r%2Fkilocode-D84315?style=flat&logo=reddit&logoColor=white" alt="Reddit" height="20"></a>
</p>

![Kilo-in-VS-Code-and-CLI](https://github.com/user-attachments/assets/0536ca59-ed81-4512-9e05-d186187a1b52)

---

Kilo Code, çalıştığınız her yerde size eşlik eden bir AI kodlama ajanıdır: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) ve [CLI](https://kilo.ai/cli). Açık kaynaktır ve açık fiyatlandırma sunar. 500'den fazla model arasından seçim yapabilir, görev sırasında model değiştirebilir ve hiçbir ek ücret olmadan model sağlayıcısının fiyatını ödersiniz. Başlamak için API anahtarı gerekmez.

### Kurulum

Kilo'yu nerede çalıştırmak istediğinizi seçin.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

[Kilo Code uzantısını](vscode:extension/kilocode.kilo-code) doğrudan kurun veya [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code) üzerinden edinin. Bir hesap oluşturduğunuzda GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 ve Gemini 3.1 Pro Preview dahil 500'den fazla modele sağlayıcı fiyatıyla erişebilirsiniz.

</details>

<details open>
<summary><strong>CLI</strong></summary>

<br>

```bash
# npm
npm install -g @kilocode/cli

# curl
curl -fsSL https://kilo.ai/cli/install | bash

# pnpm
pnpm add -g @kilocode/cli

# bun
bun add -g @kilocode/cli

# Homebrew (macOS / Linux)
brew install Kilo-Org/tap/kilo

# Arch Linux (AUR)
paru -S kilo-bin
```

Ardından başlamak için herhangi bir proje dizininde `kilo` çalıştırın.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

[Kilo Code eklentisini](https://plugins.jetbrains.com/plugin/28350-kilo-code) JetBrains Marketplace'ten kurun veya herhangi bir JetBrains IDE içinde `Settings → Plugins` bölümünde "Kilo Code" arayın.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Kilo'yu yerel makine gerekmeden web üzerinden [app.kilo.ai/cloud](https://app.kilo.ai/cloud) adresinde çalıştırın.

</details>

<details>
<summary><strong>Kod İncelemeleri</strong></summary>

<br>

Pull request'leriniz için otomatik AI kod incelemelerini [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews) adresinde ayarlayın.

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Her zaman açık AI ajanınızı [app.kilo.ai/claw](https://app.kilo.ai/claw) adresinde başlatın.

</details>

<details>
<summary>CLI'yi GitHub Releases üzerinden kurun (ikili dosyalar)</summary>

En son ikili dosyayı [Releases sayfasından](https://github.com/Kilo-Org/kilocode/releases) indirin.

| Platform | Asset |
|---|---|
| Windows (çoğu PC) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Notlar: `x64-baseline`, AVX olmayan eski CPU'lar için uyumluluk derlemesidir. `musl`, Alpine veya glibc olmayan minimal Docker imajları için statik bağlı derlemedir. `kilo-vscode-*.vsix` CLI değil VS Code uzantı paketidir. `Source code` arşivleri kaynaktan derlemek içindir.

</details>

### Agents

Kilo, göreve göre aralarında geçiş yapabileceğiniz özelleşmiş agents ile gelir. Kendi özel agents'larınızı da oluşturabilirsiniz.

- **Code** - Varsayılan. Doğal dilden kod uygular ve düzenler.
- **Plan** - Kod yazılmadan önce mimari tasarlar ve uygulama planları yazar.
- **Ask** - Dosyalara dokunmadan kod tabanınız hakkında soruları yanıtlar.
- **Debug** - Sorunları giderir ve izler.
- **Review** - Değişikliklerinizi inceler ve performans, güvenlik, stil ve test kapsamı sorunlarını ortaya çıkarır.

[Agents ve özel agents](https://kilo.ai/docs/code-with-ai/agents/using-agents) hakkında daha fazla bilgi edinin.

### Ne yapar

- Birden çok dosyada doğal dilden **kod üretimi**.
- Ghost-text önerileri ve kabul etmek için Tab ile **satır içi otomatik tamamlama**.
- Ajanın kendi çalışmasını inceleyip düzeltmesi için **öz denetim**.
- Komut çalıştırmak ve web'i otomatikleştirmek için **terminal ve tarayıcı kontrolü**.
- Ajanın yapabileceklerini genişleten MCP sunucularını bulmak ve bağlamak için **MCP marketplace**.
- Gecikme, maliyet ve akıl yürütmeyi işe uygun seçmek için görev sırasında geçiş destekli **500'den fazla model**.

### Otonom Mod (CI/CD)

CI/CD pipeline'ları için prompts olmadan tamamen otonom çalıştırmak üzere `kilo run` komutunu `--auto` ile çalıştırın:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` tüm izin istemlerini devre dışı bırakır ve ajanın herhangi bir işlemi onay olmadan yürütmesine izin verir. Yalnızca güvenilir ortamlarda kullanın.

### Dokümantasyon

Yapılandırma ve diğer her şey için [dokümantasyona](https://kilo.ai/docs) bakın.

### Katkıda bulunma

Geliştiricilerden, yazarlardan ve herkesten katkı bekliyoruz. Ortam kurulumu, kodlama standartları ve pull request açma hakkında bilgi için [Contributing Guide](/CONTRIBUTING.md) ile başlayın. VS Code uzantısı ve CLI yayın süreci için [RELEASING.md](../RELEASING.md), JetBrains eklentisi için [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) dosyasına bakın.

Katılmadan önce lütfen [Code of Conduct](/CODE_OF_CONDUCT.md) belgemizi okuyun.

### Lisans

MIT. Atıf ve lisans bildirimlerini koruduğunuz sürece bu kodu ticari olarak da kullanabilir, değiştirebilir ve dağıtabilirsiniz. Bkz. [License](/LICENSE).

### FAQ

<details>
<summary>Kilo CLI nereden geldi?</summary>

Kilo CLI, Kilo agentic engineering platformunda çalışacak şekilde geliştirilmiş bir [OpenCode](https://github.com/Kilo-Org/kilocode) fork'udur.

</details>

---

**Topluluğa katılın** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
