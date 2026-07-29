---
"kilo-code": minor
---

Support multiple Agent Manager side-panel terminals per context. The panel header is now a tab strip that reuses the main tab bar's terminal tabs: click to switch, drag to reorder, X to close a single terminal, and + to open another one. Terminal numbers fill gaps left by closed terminals, and tabs pick up the live title from the shell or running program (OSC escape codes), so a dev server or build names its own tab.
