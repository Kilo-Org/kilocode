# Publish to OpenVSX

**Priority:** P3
**Status:** ❌ Not started
**Issue:** [#6080](https://github.com/Kilo-Org/kilocode/issues/6080)

## Problem

The extension is currently only published to the VS Code Marketplace. OpenVSX is the alternative registry used by VS Code forks (VS Codium, Eclipse Theia, Gitpod, etc.). Users on these platforms cannot install Kilo Code from their built-in extension manager.

## Remaining Work

- Create an OpenVSX publisher account for Kilo Code at [open-vsx.org](https://open-vsx.org)
- Add an OpenVSX publish step to the CI/CD pipeline:
  - Use `ovsx publish` (the `ovsx` CLI tool) with the OpenVSX token
  - Run after the VS Code Marketplace publish step succeeds
- Ensure the `.vsix` artifact is compatible with OpenVSX (it should be the same file)
- Set up the OpenVSX token as a CI secret
- Test the publish manually first to verify the extension appears correctly

## Implementation Notes

- The `vsce` package produces a `.vsix` that works for both marketplaces
- OpenVSX tokens are per-publisher and stored as CI secrets
- Check if any VS Code API calls used by the extension are not available in OpenVSX-supported editors (most are fine)
