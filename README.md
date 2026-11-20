# Token Walks

An in-browser playground for walking tokens through networks of similarity.
Tokenizers cut text into tokens, and a distance function — language-model
embeddings, spelling, shared letters, WordNet relations — places each one among
its neighbours. Scrub the timeline to follow a walk, hover a token to inspect its
local neighbourhood, or open the full graph to see the whole network at once.
Built with SvelteKit and TypeScript, runs entirely in the browser with zero
server-side compute.

## How it works

Each step moves a token to a neighbour with probability $\beta_t$, and the
schedule controls how $\beta_t$ grows over time. The maths follows the D3PM
framework of Austin et al. (2021): every strategy defines a Markov transition
matrix $Q_t = (1-\beta_t)I + \beta_t R$, sampled one step at a time from the
current text. The chain is one mechanism for moving tokens through the space,
not the point of the app.

## Development

```bash
npm install
npm run dev        # Start dev server (http://localhost:5173)
npm run build      # Produce static output in build/
npm run preview    # Preview the static build locally
npm run lint       # Run ESLint
npm run format     # Run Prettier
npm run test       # Run Vitest
```

The `embedding-knn` strategy reads `VITE_EMBEDDING_BASE_URL` (copy
`.env.example` to `.env` to override); it defaults to the pinned HF
dataset revision in `src/lib/embeddings/loader.ts`.

## Agent workflow

See `AGENTS.md` for how agents work in this repo.
