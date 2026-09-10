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
  ไทย |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="96" alt="Kilo Code" src="packages/kilo-vscode/assets/kilo.svg" /></a>
</p>

<p align="center">เอเจนต์เขียนโค้ด AI แบบโอเพนซอร์ส — Kilo บน OpenCode v2</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> บรานช์นี้เป็นรุ่นพรีวิวสำหรับการพัฒนา ไม่ใช่ผลิตภัณฑ์ Kilo ที่เผยแพร่แล้วหรือการอัปเกรดทับ v1 โดยยังคงหน้าตาเดิมของ Kilo ขณะย้ายรันไทม์ไปยัง v2 พรีวิวใช้พื้นที่เก็บข้อมูล `kilo2` แยกต่างหาก และต้องสั่งนำเข้าข้อมูลอย่างชัดเจน ข้อมูล v1 เดิมจะไม่ถูกย้ายโดยอัตโนมัติ

---

### การติดตั้ง

ใช้ Bun 1.4 ขึ้นไป ติดตั้งส่วนพึ่งพาในสำเนาซอร์สนี้ แล้วเลือก CLI หรือ VS Code การติดตั้งใหม่และทุกแพลตฟอร์มยังไม่ผ่านการตรวจสอบเพื่อเผยแพร่ครบถ้วน แพ็กเกจ npm และรุ่นบน Marketplace ที่เผยแพร่แล้วไม่ได้ติดตั้งบรานช์นี้

```sh
bun install
```

#### CLI

เปิด Kilo CLI แบบโต้ตอบ โดยระบุโฟลเดอร์โปรเจกต์ได้ เช่น `bun run dev /path/to/project`

```sh
bun run dev
```

#### VS Code

บิลด์และเปิดส่วนขยาย Kilo เดิมในโปรไฟล์พัฒนา VS Code ที่แยกไว้ ติดตั้ง VS Code และเพิ่ม `code` ใน PATH หรือกำหนด `VSCODE_BIN` ส่วนขยายเริ่มเซิร์ฟเวอร์ภายในเครื่องโดยอัตโนมัติ การพอร์ตส่วนขยายยังไม่เสร็จสมบูรณ์

```sh
bun run extension
```

### เอเจนต์

**Code** ลงมือแก้ไข **Plan** สำรวจ ทบทวนข้อสมมติ บันทึกแผน และเสนอการส่งต่อไปสู่การลงมือทำ **Ask** ตอบโดยไม่แก้ไขไฟล์ **Debug** ตรวจสอบปัญหา ยังคงกำหนดเอเจนต์เองได้ เครื่องมือและสิทธิ์ที่ใช้ได้ขึ้นอยู่กับการตั้งค่า

### ทำอะไรได้บ้าง

มีการพัฒนาบางส่วนของบทสนทนา เครื่องมือและสิทธิ์ การเชื่อมต่อโมเดลและบัญชี Gateway การตั้งค่า หน่วยความจำ การทำดัชนี แซนด์บ็อกซ์ และเทอร์มินัลแล้ว ความเท่าเทียมกับ VS Code เดิมทั้งหมด, JetBrains, การเติมโค้ด/FIM, เสียง และงานคลาวด์บางส่วนยังไม่เสร็จ การแชร์ การตรวจสอบบริการที่ติดตั้งใช้งาน การลงนาม และการแจกจ่ายข้ามแพลตฟอร์มยังมีเงื่อนไขค้างอยู่ การมีซอร์สโค้ดไม่ใช่หลักฐานว่าผ่านการตรวจสอบตั้งแต่ต้นจนจบ

### เอกสาร

ดูสถานะบรานช์ได้จากแผนการย้ายและแผนทดสอบ เอกสาร Kilo ทั่วไปอธิบายผลิตภัณฑ์ที่เผยแพร่แล้ว ซึ่งอาจต่างจากพรีวิวนี้

- [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
- [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### การมีส่วนร่วม

ยินดีรับการมีส่วนร่วม โปรดอ่านคู่มือการมีส่วนร่วมและข้อตกลงของฟอร์ก v2 ก่อนแก้ไขโค้ดที่ใช้ร่วมกัน เก็บพฤติกรรม Kilo ในแพ็กเกจของตนเองเมื่อทำได้ ตรวจสอบแพ็กเกจที่ได้รับผลกระทบ และคงการระบุที่มาของโครงการต้นทางไว้

- [การมีส่วนร่วม](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### License

[MIT](LICENSE)

### FAQ

<details>
<summary>Kilo CLI มาจากไหน?</summary>

Kilo CLI เป็น fork ของ [OpenCode](https://github.com/anomalyco/opencode) ที่ได้รับการปรับปรุงให้ทำงานในแพลตฟอร์ม Kilo agentic engineering

</details>
