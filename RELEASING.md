# Releasing

Windows releases are created by the **Release Windows** GitHub Actions workflow.

## Normal patch release

1. Open **Actions** in GitHub.
2. Select **Release Windows**.
3. Choose **Run workflow** on the `main` branch.
4. Leave **Version bump** set to `patch` and run it.

That is the entire release process. The workflow automatically:

- bumps the version in `package.json` and `package-lock.json`;
- runs `npm ci`, `npm audit`, and the test suite;
- builds the Windows Squirrel installer;
- generates `SHA256SUMS.txt`;
- commits the version bump back to `main`;
- creates the version tag;
- generates release notes;
- publishes the GitHub release and uploads every installer artifact.

With the repository currently at `1.2.13`, the next patch run creates `v1.2.14`.

Choose `minor` or `major` only when intentionally changing that part of the version.

If a run fails, use **Re-run failed jobs** on that workflow run rather than starting another release.
