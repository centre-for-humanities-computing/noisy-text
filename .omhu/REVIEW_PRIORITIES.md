# Review priorities

Read first. Each line is checkable; violating one is a blocker. This is not the
stance restated — it is the short list that decides what must not merge.

1. No dependencies: `node:` imports only, and no entry in a package manifest.
2. `.secrets/` is never read, printed, or committed.
3. Soil (`.omhu/`, `AGENTS.md`) changes only as a visible diff in the branch.
4. One verify gate: `npm run check`, `npm run lint`, `npx prettier --check .`, `npm run test`.
5. No litter: the durable record is the issue, the PR, the commits and the soil.
