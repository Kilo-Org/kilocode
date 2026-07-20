---
"@kilocode/cli": minor
---

Remote CLI sessions can now receive file attachments from the Kilo mobile app. The mobile client uploads each file to R2 and sends a first-class `FilePartInput` whose `filename` is a server-issued `<uuid>.<ext>` basename. The CLI fetches the attachment over HTTPS, replaces it with a `data:` URL or — for generic binary attachments — a per-session scratch file under the system temp directory, and only the new session's tools can inspect it. Fetches are bounded to 5 MB with a 15 s timeout, refuse non-HTTPS or redirecting URLs, and never forward credentials; any per-attachment failure is replaced with an explanatory text part so the rest of the prompt still runs. The CLI also advertises `capabilities.attachments: true` in the relay heartbeat so the mobile client can stop probing.
