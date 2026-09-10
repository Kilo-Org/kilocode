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
  Türkçe |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="96" alt="Kilo Code" src="packages/kilo-vscode/assets/kilo.svg" /></a>
</p>

<p align="center">Açık kaynaklı yapay zekâ kodlama ajanı — OpenCode v2 üzerinde Kilo.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Bu dal bir geliştirme önizlemesidir; yayımlanmış Kilo ürünü veya v1 üzerine kurulan bir yükseltme değildir. Çalışma zamanı v2'ye taşınırken özgün Kilo arayüzü korunur. Ayrı `kilo2` depolaması kullanılır; içe aktarma açıkça başlatılır. Mevcut v1 verileri otomatik taşınmaz.

---

### Kurulum

Bun 1.4 veya üstünü kullanın. Bu çalışma kopyasında bağımlılıkları kurup CLI ya da VS Code akışını seçin. Temiz kurulum ve tüm platformlar henüz sürüm doğrulamasını tamamlamadı. Yayımlanmış npm paketleri ve Marketplace sürümleri bu dalı kurmaz.

```sh
bun install
```

#### CLI

Etkileşimli Kilo CLI'yi açın. Örneğin `bun run dev /path/to/project` ile proje dizini belirtebilirsiniz.

```sh
bun run dev
```

#### VS Code

Özgün Kilo uzantısını derleyip yalıtılmış VS Code geliştirme profilinde açın. VS Code'u kurup `code` komutunu PATH'e ekleyin veya `VSCODE_BIN` ayarlayın. Uzantı yerel sunucuyu otomatik başlatır. Taşıma henüz tamamlanmadı.

```sh
bun run extension
```

### Ajanlar

**Code** değişiklikleri uygular. **Plan** araştırır, varsayımları sorgular, planı kaydeder ve uygulamaya geçiş sunar. **Ask** dosya değiştirmeden yanıtlar. **Debug** sorunları araştırır. Özel ajanlar yapılandırılabilir. Kullanılabilir araç ve izinler yapılandırmaya bağlıdır.

### Ne yapar

Yerel konuşmalar, araçlar ve izinler, Gateway model ve hesap entegrasyonu, ayarlar, bellek, indeksleme, korumalı alan ve terminallerin bazı bölümleri uygulandı. Tam VS Code eşdeğerliği, JetBrains, otomatik tamamlama/FIM, konuşma ve bazı bulut akışları tamamlanmadı. Paylaşım, dağıtılmış servis doğrulaması, imzalama ve çok platformlu dağıtımın açık gereksinimleri var. Kaynak kodun bulunması uçtan uca kabul anlamına gelmez.

### Dokümantasyon

Bu dalın durumu için geçiş ve test planlarına bakın. Genel Kilo belgeleri yayımlanmış ürünü açıklar ve bu önizlemeden farklı olabilir.

- [Geçiş ilerlemesi (#13750)](https://github.com/Kilo-Org/kilocode/issues/13750)
- [Geçiş takibi](https://github.com/Kilo-Org/kilocode/tree/kilo-v2/migration-tracking)
  - [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
  - [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Katkıda bulunma

Katkılarınızı bekliyoruz. Ortak kodu değiştirmeden önce katkı kılavuzunu ve v2 fork kurallarını okuyun. Mümkün olduğunca Kilo davranışını kendi paketlerinde tutun, etkilenen paketleri doğrulayın ve üst projenin atıflarını koruyun.

- [Katkıda bulunma](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### Lisans

[MIT](LICENSE)

### FAQ

<details>
<summary>Kilo CLI nereden geldi?</summary>

Kilo CLI, Kilo agentic engineering platformunda çalışacak şekilde geliştirilmiş bir [OpenCode](https://github.com/anomalyco/opencode) fork'udur.

</details>
