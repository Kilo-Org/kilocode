---
"kilo-code": patch
---

Fix conversation reordering caused by a backwards system clock. Session, message and part IDs are minted from `Date.now()` and sorted lexicographically, but the generator reset its sequence counter whenever the timestamp merely changed, so a clock rewind — routine on VM and WSL2 host resume, laptop suspend/resume, and NTP step corrections — minted IDs that sort before IDs already handed out. IDs are now monotonic: the wall-clock path never drops below the highest timestamp already issued, and calls that supply an explicit timestamp no longer disturb that sequence or duplicate an ID within the same millisecond.
