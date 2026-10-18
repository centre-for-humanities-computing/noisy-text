#!/usr/bin/env python3
"""Export quantized LM token-embedding bundles for the noisy-text app.

Produces, for one source, four files under ``--out``:

- ``<source>.int8.bin``        int8 codes, row-major, K x d
- ``<source>.scales.f32.bin``  float32, length K: scale_i = max_j |W_ij| / 127
- ``<source>.transform.f32.bin`` float32 blob: mean (d), pcs (d*n, row-major),
                               eigenvalues (n), whitening (d*d, row-major)
- ``<source>.meta.json``       { source, model, vocabSize, dim, dtype,
                                quant, nPcs }

The app fetches these from a configured base URL
(VITE_EMBEDDING_BASE_URL) and caches them in IndexedDB; nothing here is
run by CI and no binaries are committed.

Usage:
    python scripts/export_embeddings.py --source gpt2 --out dist/embeddings
    python scripts/export_embeddings.py --source gpt2 --out dist/embeddings \
        --repo chcaa/noisy-text-embeddings

Requires: torch, safetensors, numpy, huggingface_hub (loads via the HF
hub cache; no transformers dependency).
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Dict, NamedTuple

import numpy as np
import torch
from huggingface_hub import HfApi, create_repo, hf_hub_download
from safetensors.torch import load_file


DATASET_CARD = """\
---
license: apache-2.0
pretty_name: noisy-text embedding bundles
tags:
- embeddings
- int8
- quantization
---
# noisy-text embedding bundles

Quantized token-embedding bundles for the `embedding-knn` noise strategy
of the noisy-text playground (#28). Flat layout, four files per source:

- `<source>.int8.bin`        int8 codes, row-major, K x d
- `<source>.scales.f32.bin`  per-row scales, length K
- `<source>.transform.f32.bin`  mean / PCA / eigenvalue / whitening blob
- `<source>.meta.json`       header

Sources: `bert-base-uncased`, `gpt2`, `gpt2-lmhead`.
Regenerate with `scripts/export_embeddings.py` in the noisy-text repo.
"""


class SourceSpec(NamedTuple):
    model: str            # HF repo id
    file: str             # checkpoint file inside the repo
    tensor: str           # embedding tensor name
    dim: int
    vocab_size: int
    note: str


SOURCES: Dict[str, SourceSpec] = {
    "bert-base-uncased": SourceSpec(
        model="google-bert/bert-base-uncased",
        file="model.safetensors",
        tensor="bert.embeddings.word_embeddings.weight",
        dim=768,
        vocab_size=30522,
        note="input word embeddings",
    ),
    "gpt2": SourceSpec(
        model="openai-community/gpt2",
        file="model.safetensors",
        tensor="wte.weight",
        dim=768,
        vocab_size=50257,
        note="input embeddings (wte)",
    ),
    "gpt2-lmhead": SourceSpec(
        model="openai-community/gpt2",
        file="model.safetensors",
        tensor="lm_head.weight",
        dim=768,
        vocab_size=50257,
        note="output embeddings (lm_head); tied to wte for base GPT-2, "
        "so this variant is typically identical to 'gpt2'",
    ),
}

N_PCS = 32


def load_matrix(spec: SourceSpec) -> np.ndarray:
    """Load the embedding matrix as float32 (K x d), downloading via HF hub."""
    path = hf_hub_download(spec.model, spec.file)
    state = load_file(path)
    if spec.tensor not in state:
        # Sharded checkpoints store per-layer files; fall back to the
        # first shard that contains the tensor.
        raise KeyError(
            f"tensor '{spec.tensor}' not in {spec.file}; sharded checkpoints "
            "need index-aware loading (not implemented here)"
        )
    w = state[spec.tensor].float().numpy()
    if w.shape != (spec.vocab_size, spec.dim):
        raise ValueError(f"unexpected shape {w.shape} for {spec.tensor}")
    return w.astype(np.float32, copy=False)


def compute_transform(w: np.ndarray) -> Dict[str, np.ndarray]:
    """Mean, top-n PCA basis + eigenvalues, and a whitening matrix.

    PCA is over the row space (tokens as observations). The whitening
    matrix is the full-dimension ZCA transform W = V diag(1/sqrt(eps+lam)) V^T
    computed from the covariance of the mean-centered rows.
    """
    mean = w.mean(axis=0)
    centered = w - mean
    cov = centered.T @ centered / max(1, centered.shape[0] - 1)
    eigvals, eigvecs = np.linalg.eigh(cov)  # ascending
    order = np.argsort(eigvals)[::-1]
    eigvals = eigvals[order]
    eigvecs = eigvecs[:, order]  # columns are PCs

    pcs = eigvecs[:, :N_PCS].astype(np.float32)          # d x n
    top_eigvals = eigvals[:N_PCS].astype(np.float32)     # n

    eps = 1e-5
    whitening = (eigvecs * (1.0 / np.sqrt(eps + eigvals))) @ eigvecs.T
    whitening = whitening.astype(np.float32)

    return {
        "mean": mean.astype(np.float32),
        "pcs": pcs,
        "eigenvalues": top_eigvals,
        "whitening": whitening,
    }


def quantize_per_row(w: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-row symmetric int8: code = round(W_ij / scale_i), scale = max|W_i|/127."""
    max_abs = np.abs(w).max(axis=1)
    scales = (max_abs / 127.0).astype(np.float32)
    scales[scales == 0] = 1.0  # all-zero rows quantize to zero codes
    codes = np.rint(w / scales[:, None]).astype(np.int8)
    return codes, scales


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, choices=sorted(SOURCES))
    parser.add_argument("--out", required=True, help="output directory")
    parser.add_argument("--repo", default=None, help="HF dataset repo id to upload to")
    parser.add_argument("--revision", default=None, help="target revision/branch for the upload")
    args = parser.parse_args()

    spec = SOURCES[args.source]
    os.makedirs(args.out, exist_ok=True)

    print(f"loading {spec.tensor} from {spec.model} ({spec.note})")
    w = load_matrix(spec)

    print("computing transform (PCA + whitening)")
    transform = compute_transform(w)

    print("quantizing per-row symmetric int8")
    codes, scales = quantize_per_row(w)

    base = os.path.join(args.out, args.source)
    codes.tofile(base + ".int8.bin")
    scales.tofile(base + ".scales.f32.bin")
    np.concatenate(
        [transform["mean"], transform["pcs"].ravel(), transform["eigenvalues"], transform["whitening"].ravel()]
    ).tofile(base + ".transform.f32.bin")

    meta = {
        "source": args.source,
        "model": spec.model,
        "vocabSize": int(spec.vocab_size),
        "dim": int(spec.dim),
        "dtype": "int8",
        "quant": "per-row-symmetric",
        "nPcs": N_PCS,
    }
    with open(base + ".meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
        f.write("\n")

    for name in ("int8.bin", "scales.f32.bin", "transform.f32.bin", "meta.json"):
        path = base + "." + name
        print(f"wrote {path} ({os.path.getsize(path):,} bytes)")

    if args.repo:
        with open(os.path.join(args.out, "README.md"), "w", encoding="utf-8") as f:
            f.write(DATASET_CARD)
        token = os.environ.get("HF_TOKEN")
        create_repo(args.repo, repo_type="dataset", exist_ok=True, token=token)
        commit = HfApi().upload_folder(
            repo_id=args.repo,
            repo_type="dataset",
            folder_path=args.out,
            revision=args.revision,
            token=token,
            commit_message=f"Upload {args.source} embedding bundle",
        )
        print(f"uploaded to {args.repo} @ {commit.oid}")
        print("pin this sha: HF_DATASET_REVISION in src/lib/embeddings/loader.ts")


if __name__ == "__main__":
    torch.set_grad_enabled(False)
    main()
