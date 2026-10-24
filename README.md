# Credential Toolkit

A web app for swiyu issuers to prepare how an SD-JWT credential is described and shown in the
swiyu wallets, without writing JSON or computing digests by hand. Everything runs in the
browser; nothing is uploaded.

From one project it builds:

- the **OCA bundle** (swiyu "Visualisation of Verifiable Credential with OCA 1.0"), with its
  `uri#integrity` value;
- the **SD-JWT VC Type Metadata** (`vct.json`), which points the wallet to that bundle;
- the credential's part of the **Issuer Metadata** (`issuer_metadata.json`) for the swiyu
  generic issuer: its configuration, issuer name and logo.

Start from a sample credential, an existing OCA bundle, OID4VCI Credential Issuer Metadata,
or a blank project. Edit names, labels, branding, order, clustering and value translations in
every language while a preview shows roughly how the iOS and Android wallets draw the card and
its details. Load the published bundle to compare it with your changes before you publish.

The same logic ships as an [npm package with a CLI](#npm-package), to build and check bundles
in your own tools and in CI.

Each capture base gets a Data Source overlay for both `vc+sd-jwt` and `dc+sd-jwt`, with the
same paths. The swiyu wallets look the paths up by format: iOS up to 1.18 only reads
`vc+sd-jwt`, and Android only reads the format named in the issuer metadata.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit and component tests (Vitest)
npm run e2e        # browser smoke test (Playwright; run `npx playwright install chromium` once)
npm run build      # static site in dist/
```

The OCA logic lives in `src/core` and has no UI dependencies. Test fixtures in
`src/test/fixtures` come from the swiyu wallet and issuer repositories.

## npm package

The core is also published as [`@bryanrmq/oca-generator`](packages/oca-generator), to build and
check bundles from project files in your own tools and in CI. It runs in Node 20 or later.

```bash
npm install @bryanrmq/oca-generator
```

```js
import { exportProject, parseProjectFile } from '@bryanrmq/oca-generator';

const file = parseProjectFile(text); // a *.credential-project.json saved by the app
const result = file.ok && (await exportProject(file.project));
// result.issues, and when there is no error: result.outputs.json, result.outputs.integrity, result.vct
```

Its entry point is `src/core/index.ts`, which lists the public API; the
[package README](packages/oca-generator/README.md) documents it. `packages/oca-generator` compiles
`src/core` with `tsc` (`npm run build:lib`) against Node's types only, so browser globals can't slip
in. That's also why relative imports in `src/core` name their `.ts` file.

The package also has an `oca` command, for scripts and CI (`packages/oca-generator/src/cli.ts`,
compiled after the library and importing it by its package name, so it only uses the public API):

```bash
npx -p @bryanrmq/oca-generator oca check pet-permit.oca-project.json
npx -p @bryanrmq/oca-generator oca build pet-permit.oca-project.json -o oca-bundle.json --vct vct-display.json
```

To release it, set `version` in `packages/oca-generator/package.json`, merge, then push a
`lib-v<version>` tag (`git tag lib-v0.1.0 && git push origin lib-v0.1.0`).
`.github/workflows/publish-lib.yml` checks the tag against the version, runs the tests and
publishes with npm provenance, using the `NPM_TOKEN` repository secret. It can also run by hand,
with a dry-run option. App releases (`v*` tags) are separate.

## Deployment

Vercel's GitHub integration deploys `main` to production and gives every pull request a
preview URL. `vercel.json` runs the unit tests before the build, so a failing test stops the
deploy. `.github/workflows/ci.yml` also lints, type-checks and runs the unit tests on every
push and pull request.

The site runs on Vercel's Hobby plan, which is for personal, non-commercial use. If an
organisation takes the project over, move it to that organisation's account or a paid plan.

## Releases

Every push to `main` that passes the Test workflow can publish a GitHub Release.
`.github/workflows/release.yml` reads the Conventional Commit titles of the PRs merged since
the last `v*` tag: `feat` bumps the minor version, `fix`, `perf` and `refactor` bump the patch
version, and a `!` or `BREAKING CHANGE` bumps the major version (the minor version while still
on `0.x`). Merges that only contain `chore`, `docs`, `ci` and similar commits do not release on
their own; they appear in the next release's notes. The first release uses the version in
`package.json`. To release anyway, run the Release workflow by hand with "force" ticked.
Preview the next release locally with `DRY_RUN=true .github/scripts/release.sh`.

The app shows the latest release next to its name, linked to the release notes. It reads it from
the GitHub API in the browser and caches it for an hour, so a new release shows without a rebuild.

## License

[MIT](LICENSE) © 2026 Bryan Reymonenq.

The test fixtures in `src/test/fixtures` and the digest check ported in `src/test/walletCesr.ts`
come from the [swiyu](https://github.com/swiyu-admin-ch) wallet and issuer repositories,
© 2024 Swiss Confederation, MIT License.
