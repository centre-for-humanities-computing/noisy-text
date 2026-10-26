#!/usr/bin/env python3
"""Export a GloVe 840B 300d word-vector bundle aligned to the 50k vocabulary.

Produces, under ``--out``, the same four artefacts as
``scripts/export_embeddings.py`` but named ``glove-840b-300d``:

- ``glove-840b-300d.int8.bin``        int8 codes, row-major, K x 300
- ``glove-840b-300d.scales.f32.bin``  per-row scales, length K
- ``glove-840b-300d.transform.f32.bin`` mean / PCA / eigenvalues / whitening
- ``glove-840b-300d.meta.json``       header, including ``vocabSha``

Rows are emitted strictly in the hosted vocabulary's rank order, so word id
``i`` indexes exactly the same word as ``word-vocab-50k.json``. ``vocabSha`` is
the SHA-256 of the ordered words joined by newlines and UTF-8 encoded -- the
canonical text verified by ``src/lib/embeddings/vocab-sha.ts``.

Usage:
    python scripts/export_word_vectors.py \\
        --glove-file glove.840B.300d.txt \\
        --vocab word-vocab-50k.json \\
        --out dist/embeddings

Requires: numpy, torch, huggingface_hub (imported lazily so ``--help`` works
without the heavy stack). Nothing here runs in CI and no binaries are
committed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import numpy as np

VOCAB_SIZE = 50_000
DIM = 300
SOURCE = "glove-840b-300d"
MODEL = "glove.840B.300d"


def load_vocab(path: str) -> list[str]:
    """Return the vocabulary ordered by rank; validate size and permutation."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    words = data.get("words")
    ranks = data.get("ranks")
    if not isinstance(words, list) or not all(isinstance(w, str) for w in words):
        raise ValueError(f"{path}: 'words' must be a list of strings")
    if not isinstance(ranks, list) or not all(isinstance(r, int) for r in ranks):
        raise ValueError(f"{path}: 'ranks' must be a list of integers")
    if len(words) != VOCAB_SIZE or len(ranks) != VOCAB_SIZE:
        raise ValueError(
            f"{path}: expected {VOCAB_SIZE} words and ranks, got "
            f"{len(words)} words and {len(ranks)} ranks"
        )
    if sorted(ranks) != list(range(VOCAB_SIZE)):
        raise ValueError(f"{path}: 'ranks' is not a permutation of 0..{VOCAB_SIZE - 1}")

    ordered: list[str] = [""] * VOCAB_SIZE
    for word, rank in zip(words, ranks):
        ordered[rank] = word
    return ordered


def load_glove_rows(path: str, ordered: list[str]) -> "np.ndarray":
    """Stream a GloVe text file and return a K x 300 float32 matrix in rank order."""
    import numpy as np

    wanted = {word: i for i, word in enumerate(ordered)}
    if len(wanted) != VOCAB_SIZE:
        raise ValueError(f"vocabulary has duplicate words ({len(wanted)} unique of {VOCAB_SIZE})")

    rows = np.zeros((VOCAB_SIZE, DIM), dtype=np.float32)
    # The real glove.840B.300d.txt repeats some tokens; the first occurrence
    # wins so a word id always maps to one deterministic row.
    first_line: dict[int, int] = {}
    duplicates: list[str] = []
    with open(path, encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            fields = line.rstrip("\n").split(" ")
            if not fields or not fields[0]:
                continue
            idx = wanted.get(fields[0])
            if idx is None:
                continue
            values = fields[1:]
            if len(values) != DIM:
                raise ValueError(
                    f"{path}:{line_no}: vector for {fields[0]!r} has "
                    f"{len(values)} values, expected {DIM}"
                )
            try:
                vector = np.asarray(values, dtype=np.float32)
            except ValueError as error:
                raise ValueError(f"{path}:{line_no}: non-numeric GloVe vector") from error
            if idx in first_line:
                duplicates.append(
                    f"{path}:{line_no}: duplicate vector for {fields[0]!r} "
                    f"(first at line {first_line[idx]})"
                )
                continue
            first_line[idx] = line_no
            rows[idx] = vector

    if duplicates:
        preview = "\n".join(duplicates[:10])
        suffix = f"\n(+{len(duplicates) - 10} more)" if len(duplicates) > 10 else ""
        print(
            f"warning: skipped {len(duplicates)} duplicate GloVe line(s):\n{preview}{suffix}",
            file=sys.stderr,
        )

    missing = [word for i, word in enumerate(ordered) if i not in first_line]
    if missing:
        preview = ", ".join(repr(w) for w in missing[:10])
        suffix = f" (+{len(missing) - 10} more)" if len(missing) > 10 else ""
        raise ValueError(f"{len(missing)} vocabulary words have no GloVe vector: {preview}{suffix}")
    print(f"matched {len(first_line):,} of {VOCAB_SIZE:,} vocabulary words")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--glove-file", required=True, help="local glove.840B.300d.txt")
    parser.add_argument("--vocab", required=True, help="local word-vocab-50k.json")
    parser.add_argument("--out", required=True, help="output directory")
    parser.add_argument("--repo", default=None, help="HF dataset repo id to upload to")
    parser.add_argument("--revision", default=None, help="target revision/branch for the upload")
    args = parser.parse_args()

    # Lazy: keeps `--help` usable without numpy/torch installed.
    import numpy as np
    from huggingface_hub import HfApi, create_repo
    from export_embeddings import N_PCS, compute_transform, quantize_per_row

    os.makedirs(args.out, exist_ok=True)

    ordered = load_vocab(args.vocab)
    print(f"loading GloVe vectors from {args.glove_file}")
    rows = load_glove_rows(args.glove_file, ordered)

    print("computing transform (PCA + whitening)")
    transform = compute_transform(rows)

    print("quantizing per-row symmetric int8")
    codes, scales = quantize_per_row(rows)

    base = os.path.join(args.out, SOURCE)
    codes.tofile(base + ".int8.bin")
    scales.tofile(base + ".scales.f32.bin")
    np.concatenate(
        [
            transform["mean"],
            transform["pcs"].ravel(),
            transform["eigenvalues"],
            transform["whitening"].ravel(),
        ]
    ).tofile(base + ".transform.f32.bin")

    vocab_sha = hashlib.sha256("\n".join(ordered).encode("utf-8")).hexdigest()
    meta = {
        "source": SOURCE,
        "model": MODEL,
        "vocabSize": VOCAB_SIZE,
        "dim": DIM,
        "dtype": "int8",
        "quant": "per-row-symmetric",
        "nPcs": N_PCS,
        "vocabSha": vocab_sha,
    }
    with open(base + ".meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
        f.write("\n")

    for name in ("int8.bin", "scales.f32.bin", "transform.f32.bin", "meta.json"):
        path = base + "." + name
        print(f"wrote {path} ({os.path.getsize(path):,} bytes)")
    print(f"vocabSha: {vocab_sha}")

    if args.repo:
        token = os.environ.get("HF_TOKEN")
        create_repo(args.repo, repo_type="dataset", exist_ok=True, token=token)
        commit = HfApi().upload_folder(
            repo_id=args.repo,
            repo_type="dataset",
            folder_path=args.out,
            revision=args.revision,
            token=token,
            commit_message=f"Upload {SOURCE} embedding bundle",
        )
        print(f"uploaded to {args.repo} @ {commit.oid}")
        print("pin this sha: HF_DATASET_REVISION in src/lib/embeddings/loader.ts")


if __name__ == "__main__":
    main()
