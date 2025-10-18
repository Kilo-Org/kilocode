---
"kilo-code": patch
---

fix(virtual-quota): display active model in UI for the frontend

When the backend switches the model, it now sends out a "model has changed" signal by emitting event.
The main application logic catches this signal and immediately tells the user interface to refresh itself.
The user interface then updates the display to show the name of the new, currently active model.
This will also keep the backend and the frontend active model in sync
