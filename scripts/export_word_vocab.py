#!/usr/bin/env python3
"""Export the static GloVe word vocabulary as JSON for the ``words`` tokenizer.

Streams a GloVe ``.txt`` file line by line. The token is the first
whitespace-delimited field; a token is kept only when its first character is a
Unicode letter and every character is a letter or one of ``'``, ``’`` or ``-``.
Processing stops at ``--limit`` words. The emitted JSON has the shape parsed by
``src/lib/tokenizers/word-vocab.ts``:

    {"version": 1, "source": "glove.840B.300d", "license": "PDDL-1.0",
     "words": [...], "ranks": [0, 1, ...]}

Unless ``--no-upload`` is passed, the file is uploaded to the HF dataset that
also hosts the embedding bundles. Nothing here runs in CI and no generated
vocabulary is committed.

Usage:
    python3 scripts/export_word_vocab.py --source glove.840B.300d.txt
    python3 scripts/export_word_vocab.py --source glove.840B.300d.txt \
        --no-upload --out /tmp/word-vocab-50k.json

Requires ``huggingface_hub`` only for the upload step (lazy import).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Iterator

# Characters allowed between letters in a kept word.
JOINERS = frozenset({"'", "’", "-"})
# Used only to warn when the source does not look like GloVe.
COMMON_WORDS = frozenset({"the", "of", "and", "to", "in", "a", "is", "that", "for", "it"})
SOURCE = "glove.840B.300d"
LICENSE = "PDDL-1.0"


def keep(token: str) -> bool:
    """Whether ``token`` passes the word filter."""
    if not token or not token[0].isalpha():
        return False
    return all(ch.isalpha() or ch in JOINERS for ch in token)


def read_words(path: str, limit: int) -> list[str]:
    """Stream ``path`` and return up to ``limit`` unique kept tokens in source order."""
    words: list[str] = []
    seen: set[str] = set()
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            fields = line.split()
            if not fields:
                continue
            token = fields[0]
            if keep(token) and token not in seen:
                seen.add(token)
                words.append(token)
                if len(words) >= limit:
                    break
    if len(words) < limit:
        raise SystemExit(f"error: only {len(words)} usable words in {path}; need {limit}")
    return words


def build_payload(words: list[str]) -> dict[str, object]:
    """Assemble the JSON object consumed by ``parseWordVocab``."""
    return {
        "version": 1,
        "source": SOURCE,
        "license": LICENSE,
        "words": words,
        "ranks": list(range(len(words))),
    }


def upload(path: str, repo: str, revision: str | None) -> str:
    """Upload ``path`` to the HF dataset repo and return the commit sha."""
    try:
        from huggingface_hub import HfApi
    except ImportError as exc:
        raise SystemExit(
            "error: huggingface_hub is not installed; pip install huggingface_hub "
            "or pass --no-upload"
        ) from exc

    kwargs: dict[str, str] = {}
    if revision:
        kwargs["revision"] = revision
    commit = HfApi().upload_file(
        path_or_fileobj=path,
        path_in_repo=os.path.basename(path),
        repo_id=repo,
        repo_type="dataset",
        commit_message="Upload GloVe word vocabulary",
        **kwargs,
    )
    return commit.oid


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="glove.840B.300d.txt")
    parser.add_argument("--out", default="word-vocab-50k.json")
    parser.add_argument("--limit", type=int, default=50000)
    parser.add_argument("--repo", default="chcaa/noisy-text-embeddings")
    parser.add_argument("--revision", default=None)
    parser.add_argument("--no-upload", action="store_true")
    args = parser.parse_args(argv)

    if args.limit <= 0:
        parser.error("--limit must be positive")

    words = read_words(args.source, args.limit)
    first_twenty = {word.lower() for word in words[:20]}
    found = first_twenty & COMMON_WORDS
    if len(found) < 5:
        print(
            f"warning: the first 20 words contain only {len(found)} of "
            f"{sorted(COMMON_WORDS)}; is --source really a GloVe .txt file?",
            file=sys.stderr,
        )

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(build_payload(words), handle, ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {len(words)} words to {args.out}")

    if args.no_upload:
        print("not uploaded (--no-upload)")
        return 0

    sha = upload(args.out, args.repo, args.revision)
    print(f"uploaded to {args.repo} @ {sha}")
    print(f"pin this sha: HF_DATASET_REVISION = '{sha}' in src/lib/embeddings/loader.ts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
