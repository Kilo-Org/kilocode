---
"@kilocode/cli": minor
---

The agent now detects and preserves the original text encoding of files when reading and editing them, so non-UTF-8 files are displayed correctly to the model and written back in their original encoding. New files are still created as UTF-8 without BOM — detection only applies when overwriting or editing an existing file.

Supported: UTF-8 (with or without BOM), UTF-16 with BOM, and common legacy Latin and CJK encodings (Shift_JIS, EUC-JP, GB2312, Big5, EUC-KR, Windows-1251, KOI8-R, ISO-8859, and others).

Not supported: UTF-16 without BOM, UTF-32.
