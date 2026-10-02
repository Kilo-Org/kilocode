---
"kilo-code": patch
---

Fix conversation reordering caused by a backwards system clock. Session, message and part IDs are minted from `Date.now()` and sorted lexicographically, but the generator reset its sequence counter whenever the timestamp merely changed, so a clock rewind — routine on VM and WSL2 host resume, laptop suspend/resume, and NTP step corrections — minted IDs that sort before IDs already handed out. The wall-clock path now never drops below the highest timestamp already issued. Calls that supply an explicit timestamp still use it verbatim and no longer disturb that sequence, drawing their counter from a range disjoint from the wall-clock path's so the two cannot mint the same ordering key within one millisecond. The watermark is process-local, so a rewind that spans a restart remains uncovered, and a single explicit timestamp supports 2048 ordering keys before that sequence repeats.
