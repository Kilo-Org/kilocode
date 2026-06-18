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
- Confirm `GITHUB_TOKEN` has `contents: write` permission for creating and updating GitHub Releases for `jetbrains/v*` tags.
- Confirm `KILO_MAINTAINER_APP_ID` and `KILO_MAINTAINER_APP_SECRET` are available to create release PRs and immediate release tags.
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
- Run the `prepare-jetbrains-release` workflow with `kind=rc` and version `x.y.z-rc.n`.
- Confirm the workflow created `jetbrains/vx.y.z-rc.n` immediately at the intended source commit.
- Review and edit `packages/kilo-jetbrains/CHANGELOG.md` in the generated release PR.
- Merge the release PR to trigger publish from `jetbrains/vx.y.z-rc.n`, for example `jetbrains/v7.0.1-rc.1`.
- Watch the `publish-jetbrains` workflow.
- Download and retain the workflow artifact if needed.
- Confirm the update appears on the JetBrains Marketplace `eap` channel.
- Confirm the GitHub Release for the `jetbrains/vx.y.z-rc.n` tag exists and contains the JetBrains plugin ZIP asset.
- Share `https://plugins.jetbrains.com/plugins/eap/list` with testers.

## Per-Stable Release

- Choose a stable version in the form `x.y.z`.
- Run the `prepare-jetbrains-release` workflow with `kind=stable` and version `x.y.z`.
- Confirm the workflow created `jetbrains/vx.y.z` immediately at the intended source commit.
- Review and edit `packages/kilo-jetbrains/CHANGELOG.md` in the generated release PR.
- Merge the release PR to trigger publish from `jetbrains/vx.y.z`.
- Watch the `publish-jetbrains` workflow.
- Confirm the update appears on the default JetBrains Marketplace channel.
- Confirm the GitHub Release for the `jetbrains/vx.y.z` tag exists and contains the JetBrains plugin ZIP asset.
