---
title: "File Encoding"
description: "How Kilo handles text file encodings when reading and editing files"
---

# File Encoding

Kilo automatically detects the text encoding of each file it reads and preserves that encoding when writing changes back. You can work with source files in any supported encoding without worrying about Kilo corrupting them or showing the model garbled text.

## Supported Encodings

- UTF-8, with or without BOM
- UTF-16 LE and UTF-16 BE, **with a BOM**
- UTF-32 LE and UTF-32 BE, **with a BOM**
- Shift_JIS, EUC-JP, GB2312, Big5, EUC-KR
- Windows-1251, KOI8-R
- The ISO-8859 family
- Other common legacy Latin and CJK encodings detected by [jschardet](https://github.com/aadsm/jschardet) and decoded by [iconv-lite](https://github.com/ashtuchkin/iconv-lite)

New files Kilo creates are always UTF-8 without a BOM. Encoding detection only runs when Kilo reads or overwrites an existing file.

## Not Supported

- **UTF-16 or UTF-32 without a BOM.** The byte pattern is ambiguous and cannot be distinguished reliably from other encodings. Save the file with a BOM or convert it to UTF-8.

{% callout type="info" %}
Encoding detection is statistical. Very short files, or files whose byte patterns happen to look like a different encoding, may occasionally be misidentified. If that happens, converting the file to UTF-8 is the most reliable workaround.
{% /callout %}

## Reporting Issues

If Kilo displays a file as garbled text, or writes it back in a different encoding than it was saved in, please open an issue at [github.com/Kilo-Org/kilocode/issues](https://github.com/Kilo-Org/kilocode/issues) and include all of the following:

- **A file that reproduces the issue.** Attach the actual file to the issue — do not paste its contents into the issue body, since the web form will re-encode the text.
- **The exact name of the encoding** the file is saved in, for example `Shift_JIS`, `windows-1251`, or `UTF-16 LE with BOM`.
- **A SHA-256 hash of the attached file** so we can confirm it wasn't corrupted when uploaded.

  On macOS or Linux:

  ```bash
  shasum -a 256 path/to/file
  ```

  On Windows:

  ```powershell
  Get-FileHash path\to\file -Algorithm SHA256
  ```

- **The model and provider** you were using when the issue occurred, for example `claude-sonnet-4.5` via Kilo Gateway.
- **The exact Kilo version** you are running. For the CLI, run `kilo --version`. For the VS Code extension, open the Extensions view and check the version next to "Kilo Code".
