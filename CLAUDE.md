# Working conventions

## Branches

**`main` is the only active branch.** It's what auto-deploys (see
`.github/workflows/deploy.yml`), and it's where all real feature work
happens. Do not create long-lived feature branches — work directly on
`main`, commit incrementally, and push.

Before starting any substantial work in this repo, confirm the checked-out
branch is `main` and is up to date with `origin/main`:

```
git status --short --branch
git fetch origin main && git log --oneline main..origin/main
```

If you find yourself on some other branch (e.g. an old feature branch left
over from a previous session), do **not** assume it's current or safe to
build on — check how far it has diverged from `origin/main` first
(`git log origin/main --oneline -20`), since another branch may have
independently gained substantial work in the meantime. Building for an hour
on a stale branch, only to discover at push time that `main` already has a
more advanced version of everything, is exactly the failure this note
exists to prevent.

`fix/otp-routing` (and PR #18) is a stale branch from before this
convention — leave it alone unless explicitly asked to revisit it.
