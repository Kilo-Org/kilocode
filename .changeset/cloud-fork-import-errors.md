---
"@kilocode/cli": patch
---

Surface the underlying reason when `kilo --cloud-fork` fails to import a cloud session (HTTP status, server message, or fetch error) in both the user-visible message and the DEBUG log stream.
