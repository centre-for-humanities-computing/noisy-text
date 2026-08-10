# Text Diffusion Playground — Agent Context

## What this project is

An in-browser playground for visualizing **discrete noise processes over text**,
inspired by the D3PM framework of Austin et al. (2021). The goal is to build
intuition about different ways of conceptualizing "noisy text" by letting a
researcher type input, pick a noising strategy and schedule, and scrub a slider
to see the text progressively decay.

**This project is about visualizing forward noise processes only.** It does not
train models, does not implement a reverse process, and does not compute ELBOs
or losses. The D3PM paper is an inspiration and a source of mathematical
structure, not a spec to follow slavishly.

## Audience and deployment

- Audience: ML researchers (the author and peers).
- Visual style: minimal, functional, not flashy.
- Deployment: static site (SvelteKit + `adapter-static`), zero server-side
  compute. All work happens in the browser.

## Stack

- **SvelteKit** with TypeScript, static adapter.
- **Web Workers** for heavy compute (trajectory sampling, neighbor tables).
- **Tokenizers**: `@huggingface/transformers` (transformers.js) or equivalent
  WASM tokenizers. Multiple tokenizers should be user-selectable.
- **No heavy math libraries.** Use `Float32Array` / `Int32Array` directly.
- **No graph framework for now.** If a graph view is added later,
  Cytoscape.js is preferred.
- **RNG**: `seedrandom` (Alea algorithm) for reproducible seeded randomness.

## Core mathematical model

For a vocabulary of size $K$ and a token $x_0$, a noise strategy defines a
Markov chain $x_0 \to x_1 \to \ldots \to x_T$ where each step samples
$x_{t+1}$ from a categorical distribution over the vocab conditioned on $x_t$
and a per-step noise rate $\beta_t$ from a schedule.

**Important:** Trajectories are realized as **coupled random walks**, not
independent samples from $\bar{Q}_t \cdot e_{x_0}$. This makes scrubbing the
slider feel like watching a continuous decay rather than independent
snapshots. Each timestep is sampled by stepping the chain forward from the
previous timestep.

The full $K \times K$ transition matrix $Q_t$ is **never materialized**. Each
strategy exposes only `sampleStep(token, beta, rng) -> token` and, optionally,
`getLocalDistribution(token, beta)` for inspection.

## Key abstractions

- `NoiseStrategy`: stepping the chain forward for one token at one timestep.
- `Schedule`: maps $t$ to $\beta_t$.
- `Trajectory`: the cached sequence of token arrays $x_0, x_1, \ldots, x_T$
  for a given (input, strategy, schedule, seed).
- `Tokenizer`: encode / decode / vocab size, with a uniform interface across
  backends.

Strategies and schedules are kept orthogonal — any strategy can be paired with
any schedule.

## Features the user cares about

- Multiple selectable tokenizers.
- Strategies: mask (absorbing), uniform, lexical (edit distance on decoded
  token strings, top-$k$). Semantic noise is future work.
- Schedules: linear, cosine, mutual-information-based.
- Time slider that scrubs smoothly through $[0, T]$.
- Token inspector on hover showing the local transition distribution.
- Diagnostics panel showing connectivity and stationary-distribution info.
- Token-dropping toggle (independent of substitution strategy).
- Side-by-side comparison of two strategies.

## Constraints and conventions

- Target sequence length: **up to 2048 tokens, all visible at once**.
- All math notation in any documentation or comments uses `$...$` / `$$...$$`.
- Precomputed data (e.g., top-$k$ neighbor tables) is cached in IndexedDB,
  keyed by `(tokenizer, strategy-params)`.
- Reproducibility: every trajectory is determined by a visible random seed.
- Disconnected transition graphs (common with small $k$ in lexical strategies)
  must be detected and surfaced to the user, not silently broken.
- The "ergodicity floor" pattern — mixing structured noise with a small
  uniform component — is the preferred fix when convergence to a useful
  stationary distribution matters.

## Non-goals

- Training or evaluating diffusion models.
- Reverse processes, denoising, or sample generation from a learned model.
- ELBO / NLL / perplexity computation.
- Latent-space diffusion (may be considered later but is out of scope for the
  current milestones).
- Visually-impressive design. Functionality and clarity come first.

## Reference

Austin et al., "Structured Denoising Diffusion Models in Discrete State-Spaces"
(NeurIPS 2021), arXiv:2107.03006. Use Appendix A.2 (transition matrices) and
A.4 (efficient representation) as the primary technical references. Note that
the paper's $\bar{Q}_t$ formalism is useful for _understanding_ what each
strategy does, but our implementation uses coupled stepwise sampling, not matrix-vector products against $\bar{Q}_t$.
