# Schedules

## How to add a new schedule

1. Create `src/lib/schedules/<name>.ts` exporting a `ScheduleFactory`
   that takes a config object and `T` and returns a `Schedule`.
2. Add an entry to `SCHEDULES` in `registry.ts` with a unique kebab-case
   `id`, a human-readable `label`, and a short `description`.
3. Register the factory in `SCHEDULE_FACTORIES` in `registry.ts`, keyed
   by the same `id`.
4. Add a test in `registry.test.ts` verifying the new id exists and its
   metadata is well-formed. Add schedule-specific tests for `beta` and
   `cumulative` in a `<name>.test.ts` file next to the schedule.
5. The new schedule is automatically available in the picker UI — no UI
   changes needed.

## Rules

- Schedules must not import from `../strategies`, `../workers`, or
  `../stores`. They are pure functions that compute $\beta_t$ and
  $\bar\alpha_t$.
- `beta(t)` returns $\beta_t \in (0, 1)$.
- `cumulative(t)` returns $\bar\alpha_t = \prod_{s=0}^{t} (1 - \beta_s)$.
  Use a closed form when available; otherwise accumulate the product.
- $T$ is captured at construction time via the factory.
- All math in comments uses `$...$` / `$$...$$`.

## Current schedules

| id       | description                                                       |
| -------- | ----------------------------------------------------------------- |
| `linear` | Noise rate increases linearly from start to end.                  |
| `cosine` | Cosine schedule — preserves signal early, collapses near the end. |
