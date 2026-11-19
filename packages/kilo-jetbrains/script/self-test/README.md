# Native JetBrains UI smoke test

From `packages/kilo-jetbrains`, run against a `buildPlugin` ZIP and an extracted IntelliJ IDEA 2026.1 distribution with its bundled JBR. Requires Python 3, Bun, a graphical desktop (or Xvfb on Linux), and the checkout's Bun dependencies. Use a short output-parent path: macOS limits Unix socket path lengths.

```sh
python3 script/self-test/run.py --ide '/Applications/IntelliJ IDEA.app' \
  --plugin build/distributions/<plugin>.zip --mode both --output-parent /tmp
```

`--ide` also accepts the Gradle-cached extracted IDE, e.g. the directory containing `lib/` and `Resources/product-info.json` on macOS. `--mode local` or `--mode split` runs one lane. `--probe` replaces `--plugin` to check the real project window and automation driver without asserting any Kilo behavior. No Gradle task is changed or invoked.

Each lane creates a git fixture, a v2 CLI profile, an empty home, and separate IDE config/system/plugin/log directories. The runner installs the supplied ZIP on both sides of a split IDE. A second, disposable plugin drives the visible Kilo Swing components on the EDT. It is compiled with the IDE's own `javac` and is never part of the Kilo artifact. The IDE starts the real checkout CLI; only the model is scripted, using a loopback endpoint and a dummy API key. The launcher does not copy IDE settings, credentials or licensed user profiles. A runtime requiring activation in the isolated profile may block before the test plugin starts.

The scenario:

1. Open Chat, invoke **New Session**, and send `Update the smoke fixture`.
2. Wait for **Allow once** and verify `fixture.txt` still contains `before`. Approve; require both the edited `after` on disk and the model's completion marker in the rendered transcript.
3. Disconnect the UI. Restart the whole IDE in local mode, or reconnect a new frontend process to the same backend in split mode.
4. Open **History**, activate the saved session and verify the old transcript. Send `Check fixture continuity`; require a new reply that the model returns only if it received the original assistant message.

The runner prints an evidence directory and exits nonzero if either lane fails. Each `result.json` contains the IDE build, plugin checksum, frontend and split backend PIDs, completed phases, model operations, and failure reason. `*.step` identifies the last UI wait. PNGs show only the fixture's chat surface at permission, edit, history, reconnect or failure. Use `--keep-sandbox` to retain raw IDE logs, caches and fake profiles for private troubleshooting; otherwise only evidence files remain. Processes launched by the runner are stopped on success, failure and interrupt.
