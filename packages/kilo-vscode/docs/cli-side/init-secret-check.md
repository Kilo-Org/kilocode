# /init Pre-Commit Secret Check

**Priority:** P2
**Issue:** [#6077](https://github.com/Kilo-Org/kilocode/issues/6077)

## Remaining Work

- In the CLI's `/init` command, after writing init files, check if the repository has:
  - A `.pre-commit-config.yaml` with a secret scanning hook
  - A `.git/hooks/pre-commit` file
  - A `detect-secrets` baseline file (`.secrets.baseline`)
- If none found, output a recommendation with link to `detect-secrets` or `gitleaks`
- Optionally: offer to install `detect-secrets` as part of init flow
