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
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  Tiếng Việt
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="96" alt="Kilo Code" src="packages/kilo-vscode/assets/kilo.svg" /></a>
</p>

<p align="center">Tác nhân lập trình AI mã nguồn mở — Kilo trên OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Nhánh này là bản xem trước dành cho phát triển, không phải sản phẩm Kilo đã phát hành hay bản nâng cấp ghi đè v1. Giao diện Kilo gốc được giữ lại trong khi chuyển môi trường chạy sang v2. Bản xem trước dùng vùng lưu trữ `kilo2` riêng; việc nhập dữ liệu phải được thực hiện rõ ràng. Dữ liệu v1 không tự động di chuyển.

---

### Cài đặt

Dùng Bun 1.4 trở lên. Cài các phụ thuộc trong bản mã nguồn này, rồi chọn CLI hoặc VS Code. Việc cài mới và tất cả nền tảng chưa hoàn tất kiểm định phát hành. Các gói npm và bản Marketplace đã phát hành không cài nhánh này.

```sh
bun install
```

#### CLI

Mở CLI tương tác của Kilo. Có thể chỉ định thư mục dự án, ví dụ `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Biên dịch và mở tiện ích Kilo gốc trong hồ sơ phát triển VS Code riêng biệt. Cài VS Code và thêm `code` vào PATH hoặc đặt `VSCODE_BIN`. Tiện ích tự khởi động máy chủ cục bộ. Việc chuyển đổi tiện ích vẫn chưa hoàn tất.

```sh
bun run extension
```

### Tác nhân

**Code** thực hiện thay đổi. **Plan** tìm hiểu, kiểm tra giả định, lưu kế hoạch và đề xuất chuyển sang triển khai. **Ask** trả lời mà không sửa tệp. **Debug** tìm nguyên nhân sự cố. Vẫn có thể cấu hình tác nhân tùy chỉnh. Công cụ và quyền phụ thuộc vào cấu hình.

### Nó làm gì

Đã triển khai một phần hội thoại gốc, công cụ và quyền, tích hợp mô hình/tài khoản Gateway, cài đặt, bộ nhớ, lập chỉ mục, sandbox và bộ điều hợp terminal. Khả năng tương đương đầy đủ với VS Code gốc, JetBrains, tự hoàn thành/FIM, giọng nói và một số luồng đám mây còn dang dở. Chia sẻ, kiểm định dịch vụ đã triển khai, ký và phân phối đa nền tảng vẫn có yêu cầu chưa hoàn thành. Có mã nguồn không đồng nghĩa với đạt kiểm định đầu cuối.

### Tài liệu

Xem kế hoạch chuyển đổi và kế hoạch kiểm thử để biết trạng thái nhánh. Tài liệu Kilo chung mô tả sản phẩm đã phát hành và có thể khác bản xem trước này.

- [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
- [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Đóng góp

Hoan nghênh đóng góp. Đọc hướng dẫn đóng góp và quy ước fork v2 trước khi sửa mã dùng chung. Ưu tiên đặt hành vi Kilo trong các gói riêng, kiểm tra các gói bị ảnh hưởng và giữ thông tin ghi nhận dự án gốc.

- [Đóng góp](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### License

[MIT](LICENSE)

### FAQ

<details>
<summary>Kilo CLI đến từ đâu?</summary>

Kilo CLI là một fork của [OpenCode](https://github.com/anomalyco/opencode), được cải tiến để hoạt động trong nền tảng Kilo agentic engineering.

</details>
