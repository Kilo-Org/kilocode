---
"kilo-code": patch
---

Fix double scrollbar in model dropdown and make search box sticky

The model selection dropdown previously showed two scrollbars - one on the outer container and one on the inner items list. Additionally, the search box would scroll out of view when browsing through the model list. This fix restructures the dropdown to use a single scrollbar on the items container only, while keeping the search input sticky at the top for better usability.
