# Release runbook

How a new version of Web to EPUB ships. An agent can run this top to bottom; the
human reviews the release notes before the GitHub release is created.

A release = version bump + `chore(release)` commit + tag `vX.Y.Z` + GitHub
release + macOS `.dmg` attached + Docker Hub image.

## Preconditions

- On `main`, clean tree, up to date with `origin/main`.
- `npm test`, `npx tsc -p frontend --noEmit` and `npx tsc -p e2e --noEmit` pass —
  CI (`.github/workflows/ci.yml`) runs the same on push; don't tag a red commit.
- `gh auth status` OK, with write access to `vfa-khuongdv/web-to-epub`.
- `docker login` done — the image goes to Docker Hub `vfakhuongdv/web-to-epub`.
- The DMG step needs an Apple-silicon Mac; the app is arm64-only and ad-hoc
  signed.

## 1. Pick the version

Semver from everything since the last tag:

```sh
git log $(git describe --tags --abbrev=0)..HEAD --oneline
```

New user-visible site or feature → minor; fixes only → patch; breaking change to
the library format or install story → major.

## 2. Bump and commit

```sh
npm version X.Y.Z --no-git-tag-version
```

That rewrites `package.json` + `package-lock.json` — the whole diff. Commit them
as `chore(release): X.Y.Z` with an English changelog body (one short paragraph
of user-visible changes), the same shape as every existing `chore(release)`
commit. Other commits can be Vietnamese; anything release-facing is English.

## 3. Tag and push

```sh
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

Recent tags are lightweight, so `--follow-tags` would silently skip it — push
the tag explicitly.

## 4. GitHub release

Write the notes in English, same shape as previous releases: one intro
paragraph, then `##` sections (feature area or site name) with plain bullets.
The human approves the text before you publish it.

```sh
gh release create vX.Y.Z --title "vX.Y.Z — Web to EPUB" --notes-file /tmp/notes.md
```

It is created published with no assets yet; the DMG is attached next.

## 5. Attach the macOS app

```sh
make release-mac
```

Builds `release/Web to EPUB-X.Y.Z-arm64.dmg` and `release/Web to EPUB-X.Y.Z-arm64-mac.zip`
(`npm run app:mac`: Electron shell, bundled Chromium, ad-hoc signing) and uploads both
to the release with `gh release upload ... --clobber`. The `.zip` is what the in-app
auto-updater downloads — never skip it. Takes several minutes; ~220 MB each.

GitHub stores the assets as `Web.to.EPUB-X.Y.Z-arm64.dmg` and
`Web.to.EPUB-X.Y.Z-arm64-mac.zip` (spaces become dots) — that is normal.

## 6. Push the Docker image

```sh
make docker-push
```

Builds `linux/amd64` + `linux/arm64` and pushes
`vfakhuongdv/web-to-epub:X.Y.Z` and `:latest`.

## 7. Verify

```sh
gh release view vX.Y.Z --json assets -q '.assets[].name'   # .dmg and -arm64-mac.zip are there
docker buildx imagetools inspect vfakhuongdv/web-to-epub:X.Y.Z
```

## Recovery

- **Release has no DMG, or the DMG is stale** — run `make release-mac` again;
  the upload clobbers the old asset.
- **Wrong notes or title** — `gh release edit vX.Y.Z --title "..." --notes-file /tmp/notes.md`.
- **Docker push failed** — re-run `make docker-push`; it overwrites the tags.

## Keep in mind

- `make release-mac` and `make docker-push` read the version from
  `package.json`, so bump (step 2) first and don't change it afterwards.
- Never hand-edit `public/` or `dist/`; they are build output.
- Nothing goes to npm (`"private": true`).
