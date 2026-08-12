# Releasing

Windows releases are created by the **Release Windows** GitHub Actions workflow.

## Normal patch release

1. Open **Actions** in GitHub.
2. Select **Release Windows**.
3. Choose **Run workflow** on the `main` branch.
4. Leave **Version bump** set to `patch` and run it.

That is the entire release process. The workflow automatically:

- calculates the next version from `package.json` using the selected `patch`, `minor`, or `major` bump;
- updates `package.json` and `package-lock.json`;
- promotes hand-written notes from `## Unreleased` in `CHANGELOG.md`, or generates release notes from changes since the previous tag when `Unreleased` is empty;
- writes the new `## vX.Y.Z` changelog section;
- creates or reuses a `release/vX.Y.Z` branch and release pull request;
- runs the test suite, dependency audit, and Windows Squirrel build on the exact release candidate;
- waits for all repository-required checks and merges the release pull request into protected `main`;
- builds the release artifacts again from the exact merged commit;
- generates `SHA256SUMS.txt`;
- creates the version tag and GitHub release using the versioned changelog section as the release notes;
- uploads every installer artifact and publishes the release;
- dispatches the Scoop bucket update workflow.

Choose `minor` or `major` only when intentionally changing that part of the version.

If a run fails after creating the release branch or pull request, rerun the workflow. It reuses the existing release state instead of creating a conflicting branch. If only the publish job fails, rerunning the failed job retries packaging/publication without needing a separate publishing workflow.
