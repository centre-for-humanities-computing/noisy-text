# DESIGN.md — Visual & Interaction Design

Status: proposal / grounding document for further development.
Supersedes the "minimal, functional, not flashy" framing in `AGENT_CONTEXT.md`
where the two conflict. See §9 for the reconciliation.

## 1. Intent

`noisy-text` is an in-browser playground for exploring **discrete forward noise
processes over text** (D3PM-inspired; forward process only — see
`AGENT_CONTEXT.md` for the maths and non-goals, which still hold). This document
redefines the _experience_ around that engine.

The prior UX was a stack of controls with the noisy text buried at the bottom.
This design inverts that: **the decaying text is the centre of attention**, and
everything else is arranged to support unhurried exploration of it.

### Audience (revised)

Research colleagues spanning **literature, aesthetics, NLP, and computer
science**. Design implication: a literature scholar and an NLP researcher must
_both_ feel invited. That means:

- The default experience reads like watching prose decay — no ML vocabulary
  required to get value.
- Technical depth (transition distributions, schedule plots, seeds, $\beta_t$)
  is present but **progressively disclosed**, never forced.

## 2. Experience principles

1. **The text is the subject.** The rendered, decaying text is the largest,
   most central element on screen at all times during exploration.
2. **Two audiences, one screen.** Everything a non-technical user needs is
   visible by default; everything technical is one deliberate click away.
3. **Explain in place.** No one should have to read a manual. Plain-language
   captions everywhere; maths available on demand via tooltips.
4. **Reversible & safe.** Every hide/collapse has an obvious way back. Nothing
   destructive. Scrubbing is always undoable by scrubbing back.
5. **Calm motion.** Animation exists to convey _change over time_ (the taper),
   not to decorate. Respect `prefers-reduced-motion`.

## 3. The two modes

The app has two top-level modes for the same document. They are not separate
pages — the transition is an in-place layout change.

### 3.1 Edit mode (entry)

- A generous, centred text field, preloaded with example text so the app
  "just works" on first load.
- A short one-line explanation above it: _"Paste some text, then watch it
  dissolve through a noise process."_
- A primary button: **"Noise it →"**.
- **Tokenizer and Strategy pickers are visible here** (see §6.1). They are
  the two choices that fundamentally shape the noise process, and users should
  be aware of them before they begin. Each has a short plain-language caption.
- Other controls (schedule, seed, T) are **not** shown in Edit mode.

### 3.2 Explore mode (the core)

Triggered explicitly by the **"Noise it"** button.

- The input field collapses to a slim, single-line summary bar at the top:
  the first ~60 chars of the source text plus an **"Edit"** affordance that
  returns to Edit mode.
- The **rendered decaying text takes the centre**, large and readable.
- The **timeline** sits directly beneath the text (see §5).
- A compact **status line** (token count, current $t$, changed-this-step
  count) sits near the timeline, de-emphasised.
- **Tokenizer and Strategy** remain visible in a quiet control strip (see §6).
- **Schedule, Seed, and T** live in the same quiet strip.
- Technical panels (schedule plot, diagnostics, per-token distribution) are
  **hidden behind an "Advanced" toggle** (see §7).

```
┌───────────────────────────────────────────────┐
│  "Hello, world!…"                      [ Edit ] │  ← collapsed input
├───────────────────────────────────────────────┤
│                                                 │
│                                                 │
│        THE  RENDERED  DECAYING  TEXT            │  ← primary focus
│        (prose, with fading change spans)        │
│                                                 │
│                                                 │
├───────────────────────────────────────────────┤
│  ◀  ├────────●────────────────┤  ▶    t = 7/50 │  ← timeline
│  120 tokens · 4 changed this step               │  ← quiet status
├───────────────────────────────────────────────┤
│  Tokenizer ▾   Strategy ▾   Schedule ▾  T=50   │  ← quiet controls
│                              Seed: 42  [⚙ Adv]  │
└───────────────────────────────────────────────┘
```

## 4. The noisy view

### 4.1 Primary: rendered prose

The primary view renders the decoded text as flowing prose (the current
`InlineTokens` path), so it reads like literature rather than a data structure.

**Change highlighting on prose.** Instead of mapping token boundaries to
character spans (which is fragile across tokenizers), we take a simpler
approach: decode the full text at each timestep and **diff the decoded strings**
between consecutive steps. Changed character ranges are highlighted with a
background colour that **fades over the last ~3–5 steps** as the user scrubs
(step-based taper):

- Step just changed → strongest highlight.
- Each step further back → progressively fainter.
- Older than the taper window → no highlight.

This lets a reader see _which parts of the text moved most recently_, giving a
sense of the "wavefront" of noise. Per-token precision is the job of the token
chips view (§4.2); the prose view prioritises readability.

Implementation: decode each trajectory row to a string, then use a
character-level diff (e.g. Myers or simple LCS) between consecutive rows to
find changed spans. Cache decoded strings per row to avoid re-decoding on every
slider tick.

### 4.2 Secondary: token chips (technical toggle)

`TokenChips` becomes the **technical** view, toggled on for users who want to
see token boundaries and per-token change flags. Same taper logic applies, but
on discrete boxes it's straightforward (fade the box background).

Rendered prose is the default; chips are opt-in. The toggle is a small button
or checkbox in the control strip, labelled "Show tokens" or similar.

### 4.3 Taper model (shared)

Both views consume a per-position "recency" value in $[0, 1]$ derived from _how
many steps ago_ each position last changed, within a fade window $W$ (default
$W = 4$). Recency $= \max(0, 1 - \text{stepsAgo}/W)$. This is computed from
the trajectory, not from wall-clock time, so it's deterministic and identical
whether you scrub or step.

## 5. Timeline

The timeline stays a draggable slider (dragging is retained) and gains
supplementary stepping controls:

- **◀ / ▶ step buttons** flanking the slider (prev/next timestep).
- **Arrow-key stepping** when the slider is focused (←/→ = ∓1 step).
- Current position shown as **`t = 7 / 50`**.

Accessibility: the slider is a native range input or an ARIA slider with proper
`aria-valuenow/min/max` and keyboard support.

## 6. Controls

### 6.1 Tokenizer and Strategy (always visible, pedagogically annotated)

Tokenizer and Strategy are the two most important choices — they define _what_
the noise process is. They are:

- **Visible in both Edit and Explore modes.**
- Each accompanied by a **short plain-language caption** (one sentence) that
  explains what the choice means. Example: for the "Absorbing (mask)" strategy,
  the caption reads _"Tokens are gradually replaced by a [MASK] token, like
  erasing words one by one."_
- Each has a **? tooltip** that expands into a longer explanation with the
  maths in `$...$` notation for technical users.

Strategy-specific parameter panels (`LexicalParams`, `CharOverlapParams`)
appear inline below the strategy picker only when their strategy is selected,
styled as a subordinate detail.

### 6.2 Schedule, Seed, T (quiet, always visible in Explore)

These secondary controls live in the same strip as Tokenizer/Strategy but are
visually de-emphasised (smaller type, muted colour). They are:

- **Schedule picker** with a short caption: _"How fast the noise increases over
  time."_
- **T** (number of timesteps) as a small numeric input next to the schedule.
- **Seed** as a small numeric input with a "Re-roll" button.

### 6.3 Display toggle (chips vs. prose)

A small toggle in the control strip, labelled "Show tokens" or a chips/prose
icon. Defaults to prose.

## 7. Progressive disclosure of technical elements

A single **"Advanced"** (⚙) toggle reveals the technical layer:

- **Schedule plot** — repurposed as a pedagogical diagram. Instead of a
  standalone SVG, it becomes a small annotated chart showing $\beta_t$ over
  time with a plain-language caption: _"At each step, this fraction of tokens
  is eligible for corruption. The schedule controls how aggressively the noise
  ramps up."_ The cumulative curve is removed (or shown as a secondary dashed
  line) to keep the focus on the per-step rate.
- **Per-token transition distribution** on hover/click (the "token inspector"
  from `AGENT_CONTEXT.md`).
- **Diagnostics** (connectivity / stationary distribution).
- Raw token IDs, $\beta_t$ value at current $t$, seed internals.

Advanced state persists across mode switches within a session so a technical
user isn't re-toggling constantly.

## 8. Pedagogy & onboarding

Chosen approaches (all in scope):

- **Sensible defaults + preloaded example text** so first load is immediately
  meaningful. Default: GPT-2 tokenizer, Absorbing strategy, Linear schedule,
  example text already in the field.
- **Inline captions** near each control in plain language (see §6).
- **Info tooltips (?)** offering the deeper explanation, including the maths in
  `$...$` notation (e.g. the $\beta_t$ schedule, the categorical step). Plain
  language first line, maths second.
- **"How this works" panel** — a dismissible About panel giving the D3PM
  forward-process intuition in a few short paragraphs, aimed at the
  non-technical reader. Reachable from a persistent small "?" in the header.

Every label must have a plain-language gloss. Rule of thumb: _a literature
scholar should understand every visible word without a glossary; the maths is
always one hover away._

## 9. Reconciliation with `AGENT_CONTEXT.md`

`AGENT_CONTEXT.md` lists "visually-impressive design" as a non-goal and calls
for "minimal, functional." This document **intentionally revises** that stance:
the audience broadened, and visual/UX quality is now a first-class goal.

What still holds unchanged from `AGENT_CONTEXT.md`:

- Forward process only; no training, reverse process, ELBO, etc.
- Coupled stepwise sampling; never materialise $K \times K$; never sample
  independently from $\bar{Q}_t \cdot e_{x_0}$.
- Up to 2048 tokens visible at once.
- Reproducibility via a visible seed.
- Maths in `$...$` / `$$...$$` everywhere.
- All heavy compute stays in Web Workers; numeric arrays stay typed.

Action item: once accepted, update `AGENT_CONTEXT.md`'s "Audience and deployment"
and "Non-goals" sections to point here.

## 10. Implementation implications (for developers)

Grounded in the current codebase (`src/routes/+page.svelte`, `src/lib/**`).

### 10.1 New app-mode state

- Introduce an app-mode store, e.g. `src/lib/stores/view.svelte.ts`, holding:
  - `mode: 'edit' | 'explore'`
  - `display: 'prose' | 'chips'` (replaces the local `showChips` boolean in
    `+page.svelte`; `DisplayModeToggle` rewires to this)
  - `advancedOpen: boolean`
  - `taperWindow: number` (default 4)
- `+page.svelte` shrinks: it currently owns `text`, `showChips`, and much
  derived logic. Move display/mode concerns into the store; keep encoding and
  trajectory wiring where they are.

### 10.2 Prose change highlighting via token-boundary character spans

- Use `recencyAt` (token-level, already correct) to determine which tokens
  changed and with what recency.
- Map each token to its character span in the decoded prose string by decoding
  tokens individually and tracking cumulative character length. Adjacent tokens
  with the same recency are merged into a single span.
- `InlineTokens.svelte` accepts the decoded text plus an array of `CharRange`
  objects (`{start, end, recency}`), and renders the text with `<span>`
  wrappers around changed regions.
- This approach uses token boundaries to constrain character spans, avoiding
  the false positives that arise from pure character-level diffs when token
  replacements shift character positions. Mask sentinel tokens are skipped
  (they are invisible in prose mode).

### 10.3 Taper / recency computation

- Extend the diff layer (`src/lib/engine/diff.ts`, already has `changedMask`)
  with a `recencyAt(traj, t, window)` producing a `Float32Array` of recency in
  $[0,1]$ per position, computed from the last-changed step within `window`.
- Keep it pure and buffer-reusable, matching the existing `changedMask(prev,
curr, buf)` pattern and the "reusable buffer to avoid per-tick allocation"
  approach in `+page.svelte`.
- Add `recency.test.ts` next to it (tests live beside code, per
  `CONVENTIONS.md`).

### 10.4 Timeline component

- Extend `TimeSlider.svelte` (or wrap it) with ◀/▶ buttons and arrow-key
  handling; keep the existing drag behaviour. Emit the same `ontchange`.
- Show `t / T`.

### 10.5 Layout / components

- `+page.svelte` restructured to the §3.2 layout: collapsed input bar →
  centred noisy view → timeline → quiet controls → advanced region.
- New small components likely: `InputBar.svelte` (collapsed summary + Edit),
  `AdvancedPanel.svelte` (wraps `SchedulePlot`, diagnostics, inspector),
  `InfoTooltip.svelte` (?-tooltip with plain text + `$...$` maths),
  `AboutPanel.svelte`.
- `SchedulePlot` moves inside `AdvancedPanel` and is simplified to a
  pedagogical $\beta_t$-only chart with annotation.

### 10.6 Styling

- Establish a small set of CSS custom properties (spacing, muted vs. primary
  text colour, highlight colour + its faded stops) so "quiet" vs "primary"
  is consistent. Keep it plain CSS in Svelte components (no UI kit, per
  `AGENT_CONTEXT.md` "no UI kit").
- Respect `prefers-reduced-motion`: disable the taper transition and any
  auto-advance animation.

### 10.7 Non-negotiables carried over

- No new dependencies without asking (no lodash/d3/UI kit).
- Trajectory compute stays in the worker; UI reads from `trajectoryStore`.
- Typed arrays throughout; maths documented in comments before implementation.
