# Contributing to @sandlada/document-context

## 1. Prerequisites

The repository requires Node.js and pnpm matching the workspace engine requirements:

- **Node.js**: `>= 22.12.0`
- **pnpm**: `>= 12.14.0`

Package manager enforcement is active (`only-allow pnpm`).

## 2. Setup

Install all workspace dependencies from the repository root:

```bash
pnpm install
```

## 3. Development & Testing

Tests are written first (TDD) using Vitest across three project suites: `unit` (Node, co-located), `integration` (happy-dom), and `e2e` (happy-dom).

### Run all tests

```bash
pnpm test
```

Executes all three projects (`unit` → `integration` → `e2e`) once.

### Watch mode

```bash
pnpm run test:watch
```

Watches source and test files, re-running affected suites on change.

### Real browser testing (Playwright)

```bash
pnpm run test:browser
```

Runs end-to-end browser specs in Chromium via Playwright (verifies closed shadow DOM, microtask reparenting, and cross-iframe scenarios).

### Targeted testing

Target specific projects, files, or test name patterns directly from `packages/document-context`:

```bash
# Run a specific suite (unit | integration | e2e)
pnpm exec vitest run --project unit

# Run a single test file
pnpm exec vitest run --project unit src/application/api/inject.unit-test.ts

# Filter tests by name pattern
pnpm exec vitest run -t "late-binding"
```

## 4. Type Checking

TypeScript checks are partitioned into three dedicated configurations:

```bash
# Check library source code types
pnpm run typecheck

# Check tsdown build configuration types
pnpm run typecheck:build

# Check test suites and test helpers types
pnpm run typecheck:test
```

## 5. Building

Compile the package using `tsdown` (Rolldown + isolated declarations):

```bash
pnpm run build
```

Outputs ESM bundles and `.d.ts` declaration files to `packages/document-context/build`.

> Never edit files in `build/` directly.

## 6. Pre-Merge Verification

Before committing changes or opening a pull request, run the complete verification sequence in order:

```bash
pnpm run typecheck
pnpm run typecheck:build
pnpm run typecheck:test
pnpm test
pnpm run build
```

All steps must succeed with zero errors.

## 7. Package-Level Direct Execution

When working directly inside `packages/document-context`, run equivalent package-scoped commands:

```bash
cd packages/document-context

# Type checking
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec tsc --project tsconfig.build.json --noEmit
pnpm exec tsc --project tsconfig.test.json --noEmit

# Test execution
pnpm exec vitest run

# Build
pnpm exec tsdown
```

## 8. Documentation Site

Run or build the local documentation site (`packages/site`):

```bash
# Start Starlight documentation dev server
pnpm run site:dev

# Build static documentation site
pnpm run site:build

# Preview built documentation site
pnpm run site:preview
```

## 9. Release Process

Releases adhere to [Calendar Versioning](https://calver.org/) (`x.y.z-YYYYMMDD.a`) and [Semantic Versioning](https://semver.org/).

### Step 1: Bump version and update changelog

Synchronize the release version across manifests and record changes:

- `package.json` (`version`)
- `packages/document-context/package.json` (`version`)
- `packages/document-context/CHANGELOG.md` (move entries under `[Unreleased]` into the new version section)

### Step 2: Run verification and clean build

Execute the pre-merge gate to confirm all checks pass:

```bash
pnpm run typecheck
pnpm run typecheck:build
pnpm run typecheck:test
pnpm test
pnpm run build
```

### Step 3: Verify package archive (dry run)

Inspect the tarball contents to ensure only intended artifacts (`build/`, canonical documentation) are packaged:

```bash
pnpm --filter @sandlada/document-context exec pnpm pack --dry-run
```

### Step 4: Commit and tag

Commit the release changes and create a Git tag:

```bash
git add package.json packages/document-context/package.json packages/document-context/CHANGELOG.md
git commit -m "chore(release): v0.0.0-YYYYMMDD.a"
git tag v0.0.0-YYYYMMDD.a
git push origin <branch> --tags
```

### Step 5: Publish to npm

Publish the package with public access:

```bash
# From repository root
pnpm --filter @sandlada/document-context publish --access public

# Or from the package directory
cd packages/document-context
pnpm publish --access public
```

For pre-release distribution channels, append `--tag <dist-tag>` (for example, `--tag next`).
