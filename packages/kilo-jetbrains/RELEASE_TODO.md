# JetBrains Release Todo

## One-Time Marketplace Setup

- Confirm `ai.kilocode.jetbrains` is the final permanent Marketplace plugin ID before the first upload.
- Build a production ZIP locally or in CI for the first Marketplace version.
- Manually upload the first plugin version in JetBrains Marketplace if the plugin has not been published before.
- Confirm the plugin is owned by the correct Kilo vendor or organization.
- Confirm the `eap` custom channel exists or is accepted on the first RC upload.
- Confirm Marketplace signing requirements before publishing RC builds.

## One-Time GitHub Setup

- Create a JetBrains Marketplace permanent token from Marketplace `My Tokens`.
- Add `JETBRAINS_MARKETPLACE_TOKEN` to GitHub Actions secrets or the protected environment.
- Confirm `GITHUB_TOKEN` has `contents: write` permission for creating and updating GitHub Releases from `jetbrains/v*` tags.
- Optionally create a protected `jetbrains-marketplace` GitHub Environment with required reviewers.
- If using an environment, move the Marketplace and signing secrets there and set the workflow job environment.

## One-Time Signing Certificate Setup

- Generate or locate the JetBrains plugin signing private key and certificate chain.
- Add `JETBRAINS_CERTIFICATE_CHAIN` with the full certificate chain PEM content.
- Add `JETBRAINS_PRIVATE_KEY` with the private key PEM content.
- Add `JETBRAINS_PRIVATE_KEY_PASSWORD` with the private key password.
- Keep PEM files out of git, local logs, and workflow output.
- If GitHub secret input mangles multiline PEM values, store base64-encoded values and verify the Gradle signing task decodes them correctly.

## Per-RC Release

- Choose an RC version in the form `x.y.z-rc.n`.
- Push tag `jetbrains/vx.y.z-rc.n`, for example `jetbrains/v7.0.1-rc.1`.
- Watch the `publish-jetbrains` workflow.
- Download and retain the workflow artifact if needed.
- Confirm the update appears on the JetBrains Marketplace `eap` channel.
- Confirm the GitHub Release for the `jetbrains/vx.y.z-rc.n` tag exists and contains the JetBrains plugin ZIP asset.
- Share `https://plugins.jetbrains.com/plugins/eap/list` with testers.

## Stable Release Guard

- Stable tags like `jetbrains/vx.y.z` are intentionally rejected for now.
- Before enabling stable releases, remove the workflow stable guard.
- Verify `kilo.channel=default` publishes to the default Marketplace channel.
- Update this checklist before stable releases are enabled.
