---
"@kilocode/kilo-jetbrains": minor
---

Stop treating a manually stopped session as a failure, and add a Retry action to failed turns. Pressing Stop now shows a short "Stopped" note instead of an error badge and attention dot. A turn that fails from a provider error keeps the error badge and card, and can be retried in place: the failed turn is rolled back and the same request re-runs with the same model.
