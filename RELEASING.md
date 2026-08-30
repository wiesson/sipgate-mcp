# Releasing sipgate-mcp

GitHub Releases are the source of truth for npm releases. Publishing a GitHub
Release triggers `.github/workflows/publish.yml`, which verifies the tag, runs
the complete test suite, inspects the package, and publishes it to npm.

## One-time npm bootstrap

The unscoped `sipgate-mcp` name was available on 2026-08-30. npm only exposes a
package's Trusted Publisher settings after the package exists, so the first
version must be bootstrapped by an npm account that owns the package.

1. Enable two-factor authentication on the maintainer's npm account.
2. Authenticate locally with `npm login`.
3. From a clean checkout of the tagged commit, run `npm ci`, `npm test`,
   `npm pack --dry-run`, and `npm publish --access public`.
4. Open the `sipgate-mcp` package settings on npmjs.com and add a GitHub Actions
   Trusted Publisher with these exact values:

   - Organization or user: `wiesson`
   - Repository: `sipgate-mcp`
   - Workflow filename: `publish.yml`
   - Environment: leave empty
   - Allowed action: `npm publish`

5. After verifying one OIDC-based release, configure the package to require
   two-factor authentication and disallow token-based publishing.

The publish workflow intentionally contains no `NPM_TOKEN`. Trusted Publishing
uses a short-lived GitHub OIDC credential and npm automatically records package
provenance. See npm's official [Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers/)
for the registry-side setup.

## Publishing a version

1. Update `version` in `package.json` and `package-lock.json` together, for
   example with `npm version patch --no-git-tag-version`.
2. Commit the version change and merge it to `main`.
3. Wait for the `CI` workflow to pass.
4. Create and publish a GitHub Release whose tag is exactly `v<version>`, for
   example:

   ```bash
   gh release create v0.1.1 --target main --generate-notes --verify-tag
   ```

   Create the tag first if `--verify-tag` reports that it does not exist.
5. Confirm that the `Publish npm package` workflow succeeded and verify the
   registry entry with `npm view sipgate-mcp`.

A GitHub prerelease is published under npm's `next` dist-tag. A normal GitHub
Release is published under `latest`. The workflow uses GitHub's documented
[`release: published` event](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#release).

The workflow refuses to publish when the GitHub tag and the package version do
not match. npm versions are immutable; fixing a failed or incorrect release
requires a new version.
