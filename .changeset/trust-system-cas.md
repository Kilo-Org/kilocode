---
"kilo-code": patch
---

Trust the OS certificate store and honor corporate CA bundles for the bundled Kilo backend. The extension now defaults `NODE_USE_SYSTEM_CA=1` on the spawned CLI process so users behind MITM proxies (Zscaler, Netskope, Palo Alto, etc.) no longer hit TLS errors on sign-in. A new `kilo-code.new.extraCaCerts` setting accepts a PEM file path for additional CAs, and `http.proxyStrictSSL=false` is honored as an opt-out from verification.
