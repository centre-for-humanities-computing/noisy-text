# General Instructions

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

# SvelteKit + TypeScript Project Guidelines

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
