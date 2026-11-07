# Releasing v0

The owner tags the release. Agents do not push tags unless asked.

## Preconditions

1. `pnpm check` green on `main`
2. `pnpm --filter @anyagent/e2e test` green (or skipped with printed Temporal reason)
3. Read [`docs/roadmap/v0/REPORT.md`](docs/roadmap/v0/REPORT.md) — note live **NOT RUN** items
4. Decide whether this tag is **fakes-proven** only or waits for live harness PASS rows

## Steps

```bash
# on main, clean tree
pnpm check
# set version in CHANGELOG.md (Unreleased → v0.0.x)
git tag -a v0.0.0 -m "v0.0.0: one agent in a chat (fakes; live NOT RUN — see REPORT.md)"
git push origin v0.0.0
```

Nothing is published to npm yet (private workspace). Optional: attach REPORT.md to the GitHub release notes.

## After the tag

- Open v1 work from [`docs/roadmap/v1/`](docs/roadmap/v1/README.md)
- Schedule live spike 002 / harness matrices if the owner wants a live-certified follow-up tag
