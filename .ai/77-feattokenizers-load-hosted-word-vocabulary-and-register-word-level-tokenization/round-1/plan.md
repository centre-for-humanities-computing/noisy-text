- Round: 1
- Addresses: none (initial plan)
- Slices: 9
- Estimated size: ~1,035 changed lines

## Goal and acceptance criteria

Register a hosted 50,000-word GloVe vocabulary as the `words` tokenizer, and make
every downstream consumer use the per-input effective vocabulary size
$K_{\text{eff}} = K + |\text{OOV}|$. Static word ids are $0 \ldots K-1$; OOV
tokens receive append-only ids $K, K+1, \ldots$; the mask sentinel is
$K_{\text{eff}}$. The vocabulary JSON is hosted on
`chcaa/noisy-text-embeddings`; a Python script reproduces it, and the browser
caches the parsed word list in IndexedDB.

- AC1: Selecting `words` with ordinary prose renders whole-word tokens and the
  prose view round-trips the input. Existing GPT-2 and BERT behavior is
  unchanged.
- AC2: OOV words are passed through unchanged at $t=0$, keep their characters
  in prose and chips, and are labelled with their own text (not `''`, `#id`,
  or `[MASK]`) in the hover/neighbor graph. OOV ids never collide with the mask
  sentinel.
- AC3: Uniform and absorbing strategies both scrub over word tokens. For
  absorbing, every mask id equals $K_{\text{eff}}$ for the displayed
  trajectory, `[MASK]` renders in the chip view, and masks are dropped from
  decoded prose without shifting spans.
- AC4: A fresh browser with no IndexedDB loads the vocabulary from the hosted
  URL and reports fetch progress; a reload reuses the IndexedDB copy instead of
  refetching. The status line reports the hosted vocabulary size and the
  per-input OOV count.
- AC5: Editing the text changes $K_{\text{eff}}$. While an older trajectory is
  still displayed, its mask sentinel, decoded prose, spans, and graph
  strategy config all use that trajectory's own $K_{\text{eff}}$. The
  trajectory cache never returns a result computed for a different
  $K_{\text{eff}}$.
- AC6: `npm run check`, `npm run lint`, `npx prettier --check .`,
  `npm run test`, and `npm run e2e` all pass.

## Slices

### S1 — Add a reproducible GloVe word-vocabulary export script

- Kind: behavioral
- Budget: ≤120 changed lines
- Files: `scripts/export_word_vocab.py` (create) — argparse flags
  `--source` (default `glove.840B.300d.txt`), `--out` (default
  `word-vocab-50k.json`), `--limit` (default 50000), `--repo` (default
  `chcaa/noisy-text-embeddings`), `--revision` (optional), `--no-upload`.
  Stream the source line by line; the token is the first whitespace-delimited
  field. Keep a token only when its first character is a Unicode letter and
  every character is a letter or one of `'`, `’`, `-`. Stop at `--limit` and
  fail if fewer words are found. Warn if the first 20 words do not contain at
  least five of `the, of, and, to, in, a, is, that, for, it`. Emit
  `{"version": 1, "source": "glove.840B.300d", "license": "PDDL-1.0",
  "words": [...], "ranks": [0, 1, ...]}` with `ensure_ascii=False` and
  compact separators. Upload the output with
  `HfApi().upload_file(..., repo_type="dataset")` unless `--no-upload`, then
  print the resulting commit sha and the exact pin instruction for
  `HF_DATASET_REVISION` in `src/lib/embeddings/loader.ts`.
- Tests: none (I/O script). Verify locally with
  `python3 -m py_compile scripts/export_word_vocab.py` and
  `python3 scripts/export_word_vocab.py --help`.
- Covers: AC4
- Commit: `feat(#77): add GloVe word-vocabulary export script`
- Reviewer note: Confirm the filter matches the issue regex, ranks are a
  deterministic permutation, and no generated vocabulary is committed.

### S2 — Load the hosted vocabulary with progress and cache it in IndexedDB

- Kind: behavioral
- Budget: ≤240 changed lines
- Files:
  - `src/lib/embeddings/loader.ts` (modify) — export the existing private
    `fetchBytes(url, onProgress)` so the word loader reuses the streaming
    fetch; no behavior change.
  - `src/lib/embeddings/idb.ts` (modify) — bump `DB_VERSION` to 2 and add a
    `VOCAB_STORE = 'vocab'` object store in the `onupgradeneeded` block. The
    upgrade must leave `matrices` and `rows` intact.
  - `src/lib/tokenizers/word-vocab-loader.ts` (create) — export
    `WORD_VOCAB_FILE = 'word-vocab-50k.json'` and
    `interface WordVocabProgress { loaded: number; total: number | null;
    fraction: number | null }`. Export
    `loadWordTokenizer(info: TokenizerInfo, onProgress?: (p:
    WordVocabProgress) => void): Promise<Tokenizer>`. Resolve
    `import.meta.env.VITE_WORD_VOCAB_BASE_URL ?? EMBEDDING_BASE_URL`, strip a
    trailing slash, and build `<base>/word-vocab-50k.json`. Use the URL itself
    as the IndexedDB key in the `vocab` store. On a hit, report
    `{ loaded: 0, total: null, fraction: 1 }` and return
    `createWordTokenizer(info, words)`. On a miss, call `fetchBytes`, decode
    with `TextDecoder`, run `parseWordVocab`, report byte progress as
    `loaded / total` (or `null` when the length is unknown), `void idbPut` the
    words, and return the tokenizer. Wrap fetch/parse failures with a
    `Failed to load word vocabulary from <url>:` prefix before rethrowing.
- Tests: `src/lib/tokenizers/word-vocab-loader.test.ts` (create) — stub
  `fetch` with `vi.stubGlobal` returning `new Response(...)`; assert rank
  ordering, a monotonic progress sequence ending at 1, rejection on invalid
  JSON/vocabulary, and the URL used. Restore the stub after each test. Node has
  no IndexedDB, so the miss path is the default; do not add an IDB mock.
- Covers: AC4
- Commit: `feat(#77): load and cache the hosted word vocabulary`
- Reviewer note: Confirm the v1→v2 upgrade is additive, progress tolerates a
  missing `content-length`, and parse failures reach the tokenizer store's
  error path rather than being swallowed.

### S3 — Register the words tokenizer and expose its append-only OOV table

- Kind: behavioral
- Budget: ≤120 changed lines
- Files:
  - `src/lib/tokenizers/registry.ts` (modify) — add `TOKENIZERS.words`
    (`wordPiece: false`, label `Word vocabulary (50k)`, plain name
    `Whole words`, a gloss, and tooltip text plus
    `$K = 50{,}000$` / $K_{\text{eff}} = K + |\text{OOV}|$ math). Replace the
    `MODEL_NAMES` map with
    `LOADERS: Readonly<Record<string, (info: TokenizerInfo, onProgress?:
    (p: WordVocabProgress) => void) => Promise<Tokenizer>>>`; GPT-2 and BERT
    entries call `loadHfTokenizer`, the `words` entry calls
    `loadWordTokenizer`. Change `loadTokenizer(id, onProgress?)` to look up
    the loader and keep the existing instance cache.
  - `src/lib/tokenizers/types.ts` (modify) — add optional
    `readonly oovTokens?: readonly string[]` to `Tokenizer`, documented as the
    append-only per-input table whose index 0 has id `vocabSize`.
  - `src/lib/tokenizers/word.ts` (modify) — return a `get oovTokens()` that
    exposes the internal append-only array. `encode` remains the only place
    that allocates OOV ids.
  - `src/lib/tokenizers/registry.test.ts` (modify) — assert `words` metadata
    (id, label, `wordPiece === false`, non-empty gloss/tooltip), three unique
    ids, and that an unknown id still throws.
  - `src/lib/tokenizers/word.test.ts` (modify) — assert the getter returns
    first-seen order, grows by one per new OOV token, and its length matches
    `encoded.vocabSize - tokenizer.vocabSize`.
- Tests: the two test files above. Do not network-test `loadTokenizer`.
- Covers: AC2, AC4
- Commit: `feat(#77): register the hosted word tokenizer`
- Reviewer note: Convince yourself the getter is a live append-only view,
  `loadTokenizer` still caches instances, and HF metadata is untouched.

### S4 — Drive the page and stores from the effective vocabulary size

- Kind: behavioral
- Budget: ≤180 changed lines
- Files:
  - `src/lib/stores/trajectory.svelte.ts` (modify) — add
    `vocabSize: number = $state(0)`, documented as the $K_{\text{eff}}$ of the
    displayed trajectory. Set it from `spec.vocabSize` on a cache hit and on
    the worker `result` before `_pendingSpec` is cleared. Do not change it when
    a miss is posted, so an older trajectory keeps its own sentinel.
  - `src/lib/stores/tokenizer.svelte.ts` (modify) — add
    `progress: number | null`, reset it on select, pass an `onProgress`
    callback to `loadTokenizer`, and set it to 1 on success and null on error.
  - `src/routes/+page.svelte` (modify) — return `vocabSize` from the
    `encoded` derived (`0` for empty input/no tokenizer). Add
    `displayVocabSize = $derived(trajectoryStore.trajectory ?
    trajectoryStore.vocabSize : encoded.vocabSize)`. Pass that sentinel into
    `_renderTokens`, `decodedText`, and `tokenSpans`. Use
    `encoded.vocabSize` for the compute spec, `activeStrategyConfig`,
    the strategy re-instantiation effect, and every `selectStrategy` call. Use
    `trajectoryStore.vocabSize` for `unionKey`, the union request config/size,
    and the hover neighbor config/size. Extend the status line to
    `${encoded.vocabSize.toLocaleString()}` plus
    `(+${encoded.vocabSize - t.vocabSize} OOV)` when positive, and show
    `Loading tokenizer… <pct>%` while `tokenizerStore.progress` is non-null.
    Replace the static `tok.vocabSize` uses at the mask/decoded/spans sites
    (around :188, :213, :223, :279-280, :345, :378, :382, :439, :581, :695)
    and the re-instantiation effect (:354-359). The compute spec keeps
    `vocabSize: encoded.vocabSize`; the old trajectory intentionally outlives
    a text edit until its replacement arrives.
- Tests: covered by S7's e2e; no new unit test (the store needs a worker and
  browser-only Svelte runes).
- Covers: AC1, AC2, AC3, AC5
- Commit: `feat(#77): use effective vocab size throughout the page`
- Reviewer note: Trace one text edit from `encoded.vocabSize` through the
  stored trajectory: no mask path may still read the static `tok.vocabSize`.

### S5 — Key the trajectory cache by effective vocabulary size

- Kind: behavioral
- Budget: ≤35 changed lines
- Files:
  - `src/lib/engine/trajectory-cache.ts` (modify) — add
    `String(spec.vocabSize)` to the joined key.
  - `src/lib/engine/trajectory-cache.test.ts` (modify) — add a case proving
    the key varies with `vocabSize` while every other spec field is fixed.
- Tests: the cache test above.
- Covers: AC5
- Commit: `fix(#77): key the trajectory cache by effective vocab size`
- Reviewer note: Confirm the key change invalidates only entries whose
  $K_{\text{eff}}$ differs; no cache data shape changes.

### S6 — Label OOV ids in hover and full graphs

- Kind: behavioral
- Budget: ≤110 changed lines
- Files:
  - `src/lib/workers/trajectory.protocol.ts` (modify) — add
    `oovTokens?: readonly string[]` to the neighbors request and the union-graph
    request, documented as the append-only table where index `i` has id
    `Tokenizer.vocabSize + i`.
  - `src/lib/workers/token-label.ts` (create) — export
    `tokenLabel(tok: Tokenizer, id: number, vocabSize: number, oovTokens?:
    readonly string[]): string`. Return `[MASK]` when `id === vocabSize`;
    return `oovTokens[id - tok.vocabSize] ?? '#' + id` when
    `id >= tok.vocabSize`; otherwise decode the single id with `idsToTokens`
    and fall back to `'#' + id`.
  - `src/lib/workers/trajectory.worker.ts` (modify) — use `tokenLabel` for the
    neighbor label callback (around :511) and the union `labelOf` (around
    :620), reading `msg.oovTokens`. Leave `buildUnionGraph`'s internal mask
    substitution intact.
  - `src/routes/+page.svelte` (modify) — include
    `oovTokens: tokenizerStore.tokenizer?.oovTokens ?? []` in the union-graph
    and hover-neighbor requests.
  - `src/lib/workers/token-label.test.ts` (create) — static id, OOV id, mask
    sentinel (wins over OOV), missing OOV entry, and an HF tokenizer with no
    table.
- Tests: `token-label.test.ts`.
- Covers: AC2, AC3
- Commit: `feat(#77): label OOV ids in inspection graphs`
- Reviewer note: Check the offset is the static `tok.vocabSize`, the sentinel
  is checked first, and HF graphs are byte-identical in behavior.

### S7 — Cover the hosted word tokenizer end to end

- Kind: behavioral
- Budget: ≤190 changed lines
- Files:
  - `e2e/fixtures/word-vocab/word-vocab-50k.json` (create) — a 40-word valid
    fixture (`the, a, an, and, of, to, in, is, it, you, that, he, was, for, on,
    are, with, as, his, they, be, at, one, have, this, from, or, had, by,
    word, but, not, what, all, were, we, when, quick, brown, jumps`) with
    `ranks` 0..39, `version: 1`, and source/license strings. `zorblax` and
    `quux` are deliberately absent.
  - `e2e/word-tokenizer.spec.ts` (create) — route
    `**/word-vocab-50k.json` to the fixture and count fulfillments. Test 1:
    select `tokenizer-words`, assert the status contains `Word vocabulary`;
    fill `the quick zorblax jumps`; click noise; assert `(+2 OOV)` (the two
    distinct OOV tokens are the space and `zorblax`); at $t=0$ assert
    `prose-text` equals the input and the prose token with `aria-label="token
    zorblax"` has `data-token-id="41"`; hover it and assert the neighbor SVG
    contains `zorblax`; switch to the Tokens view and assert a chip with
    `title="id: 41"`. Test 2: select absorbing, scrub to max, assert `[MASK]`
    in `output` and mask chips carry `title="id: 42"`; edit the text to
    `the zorblax quux`, assert `(+3 OOV)` and mask id 43 after recompute.
    Test 3: record the fulfill count, reload, select `words` again, and assert
    the count did not increase (IndexedDB hit). Collect page errors and assert
    none.
- Tests: this spec.
- Covers: AC1, AC2, AC3, AC4, AC5
- Commit: `test(#77): cover the hosted word tokenizer end to end`
- Reviewer note: Confirm the fixture stays valid for `parseWordVocab`, the
  spec never reaches the real host, and the reload assertion compares counts
  before/after rather than assuming a total of one.

### S8 — Document the hosted vocabulary and loader map

- Kind: mechanical
- Budget: ≤60 changed lines
- Files:
  - `src/lib/tokenizers/README.md` (modify) — add the `words` row/section,
    replace the `MODEL_NAMES` instruction with the loader-map instruction, and
    add the runbook: download
    `https://huggingface.co/stanfordnlp/glove/resolve/main/glove.840B.300d.zip`,
    unzip, run `python3 scripts/export_word_vocab.py --source
    glove.840B.300d.txt`, upload with the script or `hf upload`, copy the
    printed sha into `HF_DATASET_REVISION` in
    `src/lib/embeddings/loader.ts:30` (or set `VITE_WORD_VOCAB_BASE_URL`).
    Note that bumping the shared revision invalidates the embedding matrix
    cache as well.
  - `src/lib/embeddings/README.md` (modify) — note that the same dataset hosts
    `word-vocab-50k.json` and that a revision bump invalidates both caches.
  - `AGENT_CONTEXT.md` (modify, around :71) — list the hosted word tokenizer
    and its $K_{\text{eff}}$ behavior.
  - `src/lib/engine/README.md` (modify) — add `vocabSize` to the documented
    trajectory cache key.
- Tests: none.
- Covers: AC4, AC6
- Commit: `docs(#77): document the hosted word vocabulary`
- Reviewer note: Skim only; confirm the runbook pins the sha in the same file
  the loader reads and that no stale `MODEL_NAMES` instruction remains.

### S9 — Bump the package version

- Kind: mechanical
- Budget: ≤5 changed lines
- Files: `package.json` (modify) — `1.8.0` → `1.9.0` (`feat` bump).
- Tests: none; `npm run check` still passes.
- Covers: AC6
- Commit: `chore(#77): bump version to 1.9.0`
- Reviewer note: Version only.

## Coverage

- AC1: S4 (word tokens in `encoded`/`displayTokens`), S7 test 1 (select
  `words`, prose round-trip); existing `e2e/smoke.spec.ts` guards GPT-2/BERT.
- AC2: S3 (append-only OOV table), S4 (OOV-aware display/mask), S6
  (`tokenLabel`), S7 test 1 (prose/chip/graph labels, id 41).
- AC3: S4 ($K_{\text{eff}}$ sentinel), S6 (mask label), S7 test 2 (absorbing
  masks at id 42/43, `[MASK]`, no collision with OOV ids 40/41).
- AC4: S1 (asset), S2 (hosted fetch + IDB + progress), S3 (registration), S4
  (status OOV count), S7 test 3 (reload does not refetch), S8 (runbook/pin).
- AC5: S4 (stored spec `vocabSize`, display sentinel), S5 (cache key), S7
  test 2 (edit changes OOV count and mask id).
- AC6: every slice's `slice-check`; S7 (`npm run e2e`); S8/S9 docs/version;
  round verification below.

## Smoke steps

1. With the Playwright route mapping `**/word-vocab-50k.json` to the fixture,
   open `/` and select the `tokenizer-words` card → the card is
   `aria-checked="true"` and `app-status` contains `Word vocabulary` and
   `Vocab: 40`.
2. Fill `the quick zorblax jumps` and press `noise-button` → `app-status`
   contains `(+2 OOV)`; in the Prose view `prose-text` reads the input exactly
   and the `prose-token` for `zorblax` carries `data-token-id="41"`.
3. Hover that `zorblax` prose token → the tooltip shows an SVG with
   `aria-label="Token trajectory through its neighborhood"` whose text
   contains `zorblax`.
4. Switch to the Tokens view, select `strategy-absorbing`, press
   `noise-button`, and drag `time-slider` to its maximum → `output` contains
   `[MASK]` and every mask chip has `title="id: 42"`; no OOV chip uses id 42.
5. Edit to `the zorblax quux`, wait for recompute, then reload and select
   `words` again → `app-status` shows `(+3 OOV)`; the vocab fixture is not
   requested again after the reload.

Required test ids (all already exist): `tokenizer-words`, `input-text`,
`noise-button`, `strategy-uniform`, `strategy-absorbing`, `time-slider`,
`app-status`, `output`, `prose-text`, `prose-token`. Chip ids are read from
each chip's `title="id: <n>"`; the Prose/Tokens switch is the radio labelled
`Tokens` in the `Display style` group. No new `data-testid` is needed.

## Verification

Per slice, from the repo root:

```bash
node scripts/slice-check.mjs --budget <slice budget>
```

This runs `npm run check` → `npm run lint` → `npm run format` → `npm run test`,
stages the slice, and fails if the changed-line count exceeds the budget. For
S1 additionally run `python3 -m py_compile scripts/export_word_vocab.py`.

Per round, before pushing:

```bash
npm run test
npx prettier --check .
npm run build
npm run e2e
```

`npm run e2e` auto-builds and serves on :4173. If Chromium is missing, run
`npx playwright install chromium` once.

## Edge cases, risks, and out-of-scope

- The real asset requires a ~2 GB GloVe download and an authenticated
  `hf upload`; CI and Playwright use the fixture, so a missing upload does not
  fail tests, but AC4 in production requires the upload and pinned sha. If
  credentials are unavailable during implementation, stop and ask before
  leaving `HF_DATASET_REVISION` at its placeholder.
- Spaces and punctuation are themselves OOV tokens in the core tokenizer, so
  `(+n OOV)` counts distinct OOV tokens, not OOV words. The e2e expectations
  use 2 for `the quick zorblax jumps` and 3 for `the zorblax quux`.
- Uploading the vocabulary to the same dataset changes its revision. Bumping
  `HF_DATASET_REVISION` invalidates the embedding matrix cache; this is
  expected but should be called out in the PR.
- IndexedDB upgrade v1→v2 must create only the missing `vocab` store. A failed
  cache write is already a no-op and must not break loading.
- The worker loads the tokenizer independently. It may fetch the vocabulary
  before the page's IDB write lands; the e2e reload assertion compares request
  counts before/after reload rather than assuming exactly one total request.
- Switching tokenizers while an old trajectory is displayed is out of scope;
  the displayed trajectory's own $K_{\text{eff}}$ wins until it is replaced.
- Out of scope: GloVe vectors/embeddings (#78), prose-span changes for OOV
  text (#79), making `words` the default, tuning lexical/char-overlap at
  $K=50{,}000$, and feeding ranks into a unigram floor.
- No new dependencies; no `Math.random()` in engine code; the RNG draw order
  is untouched.

Open blocking questions: none. Confirm the plan and the availability of HF
upload credentials before `/implement`.
