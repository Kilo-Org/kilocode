---
"@kilocode/cli": patch
---

Fix `kilo upgrade` for curl installs resolving the wrong latest version

The upgrade command's version resolution for curl-detected installations used GitHub's `/releases/latest` endpoint, which now returns JetBrains plugin releases (e.g. `jetbrains/v7.0.4`) instead of the latest CLI release. This caused `kilo upgrade` to fail for curl installs. Version resolution now uses the npm `latest` dist-tag, matching the install script fix.
