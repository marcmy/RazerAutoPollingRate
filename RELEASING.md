# Releasing

Windows releases are created by the **Release Windows** GitHub Actions workflow.

## Normal patch release

1. Open **Actions** in GitHub.
2. Select **Release Windows**.
3. Choose **Run workflow** on the `main` branch.
4. Leave **Version bump** set to `patch` and run it.

That is the entire release process. The workflow automatically:

- calculates the next version and creates a `release/v...` branch;
- updates `package.json` and `package-lock.json`;
- opens or reuses a release pull request;
- runs the test suite, dependency audit, and Windows Squirrel build on the exact release commit;
- waits for all repository-required checks;
- merges the version pull request into protected `main`;
- builds the release artifacts from the exact merged commit;
- generates `SHA256SUMS.txt`;
- creates the version tag and generated release notes;
- publishes the GitHub release and uploads every installer artifact;
- dispatches the Scoop bucket update workflow.

With the repository currently at `1.2.13`, the next patch run creates `v1.2.14`.

Choose `minor` or `major` only when intentionally changing that part of the version.

If a run fails after creating the release branch or pull request, rerun the workflow. It will reuse the existing release state instead of creating a conflicting branch or skipping a version.
