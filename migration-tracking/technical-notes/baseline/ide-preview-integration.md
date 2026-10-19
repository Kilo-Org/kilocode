# IDE preview integration — 2026-09-08

**Scope corrected on 2026-09-08:** this document records the upstream-app wrapper
prototype, which Johnny rejected as a substitute for porting the existing Kilo
extension. Its infrastructure checks remain valid, but do not close the existing
sidebar, editor, or settings port rows. Current coverage is 31/43; the real port
must preserve the existing extension UI and workflows.

## Implemented

`packages/kilo-vscode` is a separately named extension composing the existing public v2 app in sidebar/editor webviews. It verifies an explicit loopback v2 endpoint and stores its credential in VS Code SecretStorage. The webview uses a separate ephemeral proxy credential. Health verification refuses v1/malformed/unauthorized responses and redirects, with a deadline covering the body.

Commands cover Connect, Open Chat, Open Chat in Editor, New Chat, Open Conversation, Open Settings, Reconnect, and Disconnect. New Chat uses the workspace or a selected folder. Open Conversation lists the 100 latest top-level sessions. Each editor retains its route; the sidebar saves its route in workspace state. Reconnect and window restoration rebind the encoded server key to the new proxy. Settings routes do not replace the last conversation route. Disconnect closes the proxy and deletes the selected credential.

The Kilo-owned embedding supplies the public app's flex-column/full-viewport root layout, preventing the narrow project selector from overlapping the session list. Settings reuse the existing browser-safe Kilo settings RPC and native profile/project revision checks, without a new public Server/Protocol route.

The proxy contains static assets and forwards authenticated HTTP/SSE only to the verified loopback server. Terminal upgrades require the preview origin, native connect route, and a ticket. Both credentials are removed from upgrade headers; upstream validates the one-use ticket. Absolute request targets are refused before upstream work. No authorization fallback exists.

## Acceptance

- Built extension and app: pass. Package host/browser typechecks: pass.
- Connection, HTTP and real terminal suites: **20 pass, 78 assertions**.
- Actual Node proxy runtime: **6 checks pass**, including SSE completion/disconnect behavior.
- Packaging: **3 pass, 33 assertions**; actual `vsce` from local cache, real LICENSE, no workspace runtime dependencies in the VSIX.
- Browser real-host acceptance: pass for prompt streaming, shell permission/continuation, stale session-route rebinding, profile Save/reopen/Reset, project isolation, stale-edit refusal, explicit boolean drafts, and narrow viewport.
- **Installed VSIX native acceptance: pass, 6.82 seconds, 10 wrapper assertions plus driver/host assertions.** The actual workbench connects through the normal command and password inputs, streams a sidebar conversation, continues in an editor after keyboard approval, opens a separate conversation, reconnects, reloads the entire window and restores conversations, saves a setting verified on disk, creates exactly one new session, and disconnects.
- Independent command/proxy review: no blocking findings. Its minor credential and empty-workspace observations were addressed.

Artifact: `packages/kilo-vscode/dist/kilo-code-v2-preview-0.0.1.vsix`, **9,819,328 bytes / 912 entries** at acceptance. The same artifact was installed into a disposable profile; no development-extension loading was used for that run. Source and commands are documented in `packages/kilo-vscode/README.md`.

## Isolation and native-runner resolution

The macOS browser/native wrappers deny external outbound access for the entire host/editor process tree. Johnny approved the test-only Chromium sandbox opt-out while retaining that policy. Native tests now add `--use-mock-keychain`: this controlled change resolved the earlier CDP/webview observation stall and avoids the user's real keychain. It does not establish which internal native keychain operation caused the old stall.

VS Code's sticky extension-disabled notification overlapped the editor permission button in the development-host run. The acceptance exercises its normal keyboard activation; browser acceptance independently covers mouse approval. Test-owned editor processes are explicitly cleaned up, and the final process inspection found no remaining fixture profiles. Tests do not change live Kilo stores or VS Code profiles.

Historical correction retained: an earlier browser fixture omitted the session agent and placed only Chromium under the OS policy, allowing host fallback-model requests. Those earlier requests cannot be claimed local-only. The corrected shared fixture selects the agent/model and the current wrappers enclose the entire process tree. No external deployment acceptance is credited.

## Reproduction and limits

Use the package README's build/package and `test:native-app` commands. `KILO_TEST_VSIX` selects the real local artifact for isolated installation; `KILO_TEST_VSCODE_EXECUTABLE` selects the installed editor. No browser, editor, or tooling is downloaded. Logs and screenshots are under root thread storage (`vscode-installed-app.log`, `vscode-installed-app/native-app.png`, `vscode-focused.log`, `vscode-node.log`, `vscode-browser.log`, `vscode-build.log`).

The current verified editor platform is macOS. Marketplace publication, signing/distribution policy, Linux/Windows native acceptance, Agent Manager, and other v1 IDE capability rows remain outside these accepted conversation/settings rows. The extension requires an existing explicitly selected local server and does not elect or replace daemons.

### Workspace lockfile follow-up

The installed VSIX is self-contained and verified. The initial network-denied lockfile generation attempt failed and left the lock unchanged. A later read-only audit recovered the exact `@types/vscode@1.125.0` tuple and SHA-512 integrity from the local sibling `kilocode/.kilo/worktrees/extreme-brick/bun.lock`; the extracted package's version also matches. Root added the `packages/kilo-vscode` workspace descriptor, workspace package link, and that existing tuple to this lockfile without changing other records. These are sourced entries, not invented integrity values.

**Fresh source installation remains unverified.** The delegate's prediction that these additions would make frozen installation succeed offline was tested and did not hold. `bun install --frozen-lockfile --dry-run --ignore-scripts`, enclosed by a policy denying all network, still requested other unavailable registry metadata; both available Bun runtimes failed. No actual install or unrestricted retry was run. Logs: `vscode-frozen-lockfile.log` and `vscode-frozen-system-bun.log` in root thread storage. The tested VSIX is unchanged and does not need workspace dependencies installed.
