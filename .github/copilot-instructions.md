# Copilot Instructions

This is a SvelteKit + TypeScript project for visualizing discrete noise
processes over text. See `AGENT_CONTEXT.md` for what it does and
`CONVENTIONS.md` for code rules. Read both before non-trivial work.

## Workflow

- For any task touching more than one file, list the files you will
  create or modify and the public API of each **before writing code**.
  Wait for confirmation.
- Reference the issue number in commits: `feat(#7): implement mask strategy`.
- One issue per session. Don't batch.
- Only modify files explicitly in scope. If a fix elsewhere seems needed,
  call it out separately — don't silently include it.

## House style

- TypeScript strict mode. No `any`. No `// @ts-ignore` without a comment
  explaining why.
- Use `Float32Array` / `Int32Array` for numeric arrays, not `number[]`.
- Prefer pure functions. Side effects live in Svelte components or workers.
- Async work >50ms goes in a Web Worker (`src/lib/workers/`).
- Tests live next to the code: `foo.ts` → `foo.test.ts`.
- Math in comments and docs uses `$...$` / `$$...$$`, never `(...)` or `[...]`.

## Don't

- Don't add dependencies without asking. Especially: no `lodash`, no
  `mathjs`, no `d3` (use `uPlot` or plain SVG), no UI kit.
- Don't add error handling, retries, or logging unless asked. Let it throw.
- Don't generate mock or placeholder data unless asked.
- Don't refactor adjacent code while implementing a feature.
- Don't add JSDoc to trivial functions. Document the non-obvious only.
- Don't materialize the full $K \times K$ transition matrix anywhere.
- Don't sample independently from $\bar{Q}_t \cdot e_{x_0}$ for the slider;
  use coupled stepwise sampling. See `GLOSSARY.md` if unsure.
- Don't import from `$lib/internal/*` outside `$lib/`.

## When math is involved

For any code that samples from a distribution or implements a transition
process, write a short comment first describing the math (using `$...$`),
then implement it. If you can't write the comment, you don't understand
the task — stop and ask.