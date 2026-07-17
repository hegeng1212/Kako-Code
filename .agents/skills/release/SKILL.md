---
name: release
description: Use when releasing Kako — committing to main, creating version tags v*, pushing tags, or checking the macOS pkg GitHub Release workflow.
---

# Release (tag → macOS pkg)

Kako does **not** use changesets. Versioning for distributable builds is the git tag `v*`.

## Pipeline (current)

1. Land code on `main` (commit + `git push origin main`).
2. Create tag: `git tag vX.Y.Z` (or `git tag -f` only if the user **explicitly** approves moving an existing release tag).
3. Push tag: `git push origin vX.Y.Z` (force-push tags only with explicit user approval).
4. GitHub Actions [`.github/workflows/release.yml`](../../../.github/workflows/release.yml) runs on `push` tags `v*`:
   - `pnpm install --frozen-lockfile`
   - `KAKO_VERSION` from tag → `bash scripts/build-macos-pkg.sh`
   - Upload `release/macos/kako-*-macos.pkg` via `softprops/action-gh-release`

## Local optional check

```bash
pnpm pack:macos
```

## Red lines

- Do not force-update a published tag without explicit user confirmation.
- No co-author / agent identity in commits or release notes text you author.
- Prefer a new patch/minor tag over silently rewriting history when users may already have installed the old tag.
