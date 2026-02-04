---
description: "Create a new release of the Roo Code CLI"
argument-hint: "[version-description]"
mode: code
---

1. Identify changes since the last CLI release:

    - Get the last CLI release tag: `gh release list --limit 10 | grep "cli-v"`
    - View changes since last release: `git log cli-v<last-version>..HEAD -- apps/cli --oneline`
    - Or for uncommitted changes: `git diff --stat -- apps/cli`

2. Review and summarize the changes to determine an appropriate changelog entry. Group changes by type:

    - **Added**: New features
    - **Changed**: Changes to existing functionality
    - **Fixed**: Bug fixes
    - **Removed**: Removed features
    - **Tests**: New or updated tests

3. Bump the version in `apps/cli/package.json`:

    - Increment the patch version (e.g., 0.0.43 → 0.0.44) for bug fixes and minor changes
    - Increment the minor version (e.g., 0.0.43 → 0.1.0) for new features
    - Increment the major version (e.g., 0.0.43 → 1.0.0) for breaking changes

4. Update `apps/cli/CHANGELOG.md` with a new entry:

    - Add a new section at the top (below the header) following this format:

    ```markdown
    ## [X.Y.Z] - YYYY-MM-DD

    ### Added

    - Description of new features

    ### Changed

    - Description of changes

    ### Fixed

    - Description of bug fixes
    ```

    - Use the current date in YYYY-MM-DD format
    - Include links to relevant source files where helpful
    - Describe changes from the user's perspective

5. Create a release branch and commit the changes:

    ```bash
    # Ensure you're on main and up to date
    git checkout main
    git pull origin main

    # Create a new branch for the release
    git checkout -b cli-release-v<version>

    # Commit the version bump and changelog update
    git add apps/cli/package.json apps/cli/CHANGELOG.md
    git commit -m "chore(cli): prepare release v<version>"

    # Push the branch to origin
    git push -u origin cli-release-v<version>
    ```

6. Create a pull request for the release:

    ```bash
    gh pr create --title "chore(cli): prepare release v<version>" \
        --body "## CLI Release v<version>

    This PR prepares the CLI release v<version>.

    ### Changes
    - Version bump in package.json
    - Changelog update

    ### Checklist
    - [ ] Version number is correct
    - [ ] Changelog entry is complete and accurate
    - [ ] All CI checks pass" \
        --base main
    ```

7. Wait for PR approval and merge:

    - Request review if required by your workflow
    - Ensure CI checks pass
    - Merge the PR using: `gh pr merge --squash --delete-branch`
    - Or merge via the GitHub UI

8. Run the release script from the monorepo root:

    ```bash
    # Ensure you're on the updated main branch after the PR merge
    git checkout main
    git pull origin main

    # Run the release script
    ./apps/cli/scripts/release.sh
    ```

    The release script will automatically:

    - Build the extension and CLI
    - Create a platform-specific tarball
    - Verify the installation works correctly (runs --help, --version, and e2e test)
    - Extract changelog content and include it in the GitHub release notes
    - Create the GitHub release with the tarball attached

9. After a successful release, verify:
    - Check the release page: https://github.com/RooCodeInc/Roo-Code/releases
    - Verify the "What's New" section contains the changelog content
    - Test installation: `curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | sh`

**Notes:**

- The release script requires GitHub CLI (`gh`) to be installed and authenticated
- If a release already exists for the tag, the script will prompt to delete and recreate it
- The script creates a tarball for the current platform only (darwin-arm64, darwin-x64, linux-arm64, or linux-x64)
- Multi-platform releases require running the script on each platform and manually uploading additional tarballs
