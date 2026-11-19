# Kilo Code for JetBrains (v2 preview)

The Kilo tool window runs as native IntelliJ UI. In remote development, the IDE backend owns the `kilo2` process, project files and server credentials; the frontend talks to it over the IntelliJ split plugin RPC. Both halves must use the same plugin version.

## Build and try it

Use the repository's Bun version and JDK 21. Run `bun install --frozen-lockfile` at the repository root, then from this directory:

```sh
./gradlew test buildPlugin
./gradlew --no-configuration-cache runIde
# Or start both halves of a remote development sandbox:
./gradlew --no-configuration-cache runIdeSplitMode
```

To test the distribution, use **Settings → Plugins → Install Plugin from Disk** in a disposable IDE profile and select the ZIP in `build/distributions/`. Open a project and the **Kilo Code** tool window. An installed plugin downloads the pinned CLI for the backend host; the Gradle IDE sandbox runs the CLI from the checkout instead. For the scenario that verifies editing and approval against a real IDE and a repeatable model fixture, see [Native JetBrains UI smoke test](script/self-test/README.md).

## Updating the CLI

`package.json` pins an exact version from the `@kilocode/cli` npm `kilo-v2` channel. After changing it, run `bun run pin:cli` and review the SHA-512 checksums for all supported platform packages. The Gradle build generates the Kotlin transport from the checkout's assembled v2 protocol. Test against the pinned distribution as well as the checkout before changing the pin: a route present in source may be absent from a published CLI.

### Session retention

Machine-wide cleanup is unavailable on the `0.0.0-v2-194` pin. Checkpoints remain configurable. The IDE reads `kilocode.retention.status` when available, but neither runs cleanup nor enables its policy on an unverified CLI. A manual run requires a saved, enabled policy and confirmation; it never turns automatic cleanup on temporarily.

Release dependency: [server retention PR #16159](https://github.com/Kilo-Org/kilocode/pull/16159) defines `status`, `run({ force })`, and `cancel`. Before enabling cleanup on a pin, the server must honor only machine-wide consent and atomically exclude running **and newly active** session trees, including across processes. Checking activity before `Session.remove` is insufficient: that operation interrupts executions and cascades through children. Verify concurrent resume, admission and child creation against deletion on isolated data, then record `cli.retention.verified-version=<exact tested CLI version>` in the packaged `kilo-v2-cli.properties`. Regenerating the pin clears this attestation. JetBrains checks it against the live Kilo handshake; RPC presence or a higher version alone does not enable deletion.
