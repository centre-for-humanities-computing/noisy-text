# noisy-text

An in-browser playground for visualizing discrete noise processes over text, inspired by the D3PM framework of Austin et al. (2023). Pick a tokenizer, choose a noising strategy and schedule, then scrub a slider to watch input text progressively decay through a coupled Markov chain. Built with SvelteKit and TypeScript, runs entirely in the browser with zero server-side compute.

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
