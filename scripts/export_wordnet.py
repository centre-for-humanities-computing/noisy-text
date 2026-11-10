#!/usr/bin/env python3
"""Export OEWN 2025 relations as a typed-array bundle keyed by 50k ids.

Resolves static words through OEWN ``<Form>`` exceptions and ``wn`` Morphy,
unions synsets per resolved lemma set, inverts stored relations and restricts
targets to static ids. The binary layout and runbook live in
``src/lib/wordnet/README.md``. Requires ``wn``; ``huggingface_hub`` only for
upload.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import struct
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict

SOURCE = "oewn-2025"
LICENSE = "CC BY 4.0"
ATTRIBUTION = (
    "Princeton WordNet and the Open English WordNet (OEWN) team, "
    "https://en-word.net/downloads"
)
CATEGORIES = ("hypernym", "hyponym", "synonym", "meronym", "holonym")
CATEGORY_INDEX = {category: i for i, category in enumerate(CATEGORIES)}
MAGIC, VERSION = b"OEWN", 1
# Stored WN-LMF relation type -> (forward category, inverse category).
RELATIONS = {
    "hypernym": ("hypernym", "hyponym"),
    "instance_hypernym": ("hypernym", "hyponym"),
    "hyponym": ("hyponym", "hypernym"),
    "instance_hyponym": ("hyponym", "hypernym"),
    "meronym": ("meronym", "holonym"),
    "holonym": ("holonym", "meronym"),
}


def relation_categories(rel_type: str) -> tuple[str, str] | None:
    """Map a WN-LMF relation type to its forward and inverse categories."""
    rel = rel_type.lower()
    if rel in RELATIONS:
        return RELATIONS[rel]
    if rel.startswith("mero_"):
        return "meronym", "holonym"
    if rel.startswith("holo_"):
        return "holonym", "meronym"
    return None


def single_word(form: str) -> bool:
    """Whether ``form`` is one word (no whitespace)."""
    return bool(form) and not any(ch.isspace() for ch in form)


def read_lmf(path: str):
    """Parse the WN-LMF dump into forms, lemmas, synsets and their relations."""
    opener = gzip.open if path.endswith(".gz") else open
    forms: dict[str, set[str]] = defaultdict(set)
    lemma_synsets: dict[str, set[str]] = defaultdict(set)
    synset_lemmas: dict[str, set[str]] = defaultdict(set)
    synset_edges: dict[str, set[tuple[str, str]]] = defaultdict(set)
    with opener(path, "rb") as handle:
        for _, elem in ET.iterparse(handle, events=("end",)):
            kind = elem.tag.rsplit("}", 1)[-1]
            if kind == "LexicalEntry":
                lemma = elem.find("{*}Lemma")
                written = ((lemma.get("writtenForm") if lemma is not None else "") or "").lower()
                if single_word(written):
                    forms[written].add(written)
                    for form in elem.findall("{*}Form"):
                        value = (form.get("writtenForm") or "").lower()
                        if single_word(value):
                            forms[value].add(written)
                    for sense in elem.findall("{*}Sense"):
                        synset = sense.get("synset")
                        if synset:
                            lemma_synsets[written].add(synset)
                            synset_lemmas[synset].add(written)
            elif kind == "Synset":
                synset = elem.get("id")
                if synset:
                    for rel in elem.findall("{*}SynsetRelation"):
                        mapped = relation_categories(rel.get("relType") or "")
                        target = rel.get("target")
                        if mapped and target:
                            synset_edges[synset].add((target, mapped[0]))
                            synset_edges[target].add((synset, mapped[1]))
            if kind in ("LexicalEntry", "Synset"):
                elem.clear()
    return forms, lemma_synsets, synset_lemmas, synset_edges


def build(vocab: list[str], lmf):
    """Build the row map, CSR sections and manifest fields."""
    forms, lemma_synsets, synset_lemmas, synset_edges = lmf
    from wn.morphy import Morphy

    morphy, lemmas = Morphy(), set(forms)
    resolved: list[set[str]] = []
    for word in vocab:
        got = forms.get(word.lower())
        if not got:
            candidates = morphy(word.lower())
            got = set().union(*candidates.values()) if candidates else set()
        resolved.append({lemma for lemma in got if lemma in lemmas})

    lemma_id: dict[str, int] = {}
    for token_id, row_lemmas in enumerate(resolved):
        for lemma in row_lemmas:
            lemma_id.setdefault(lemma, token_id)

    groups: dict[frozenset[str], list[int]] = defaultdict(list)
    for token_id, row_lemmas in enumerate(resolved):
        if row_lemmas:
            groups[frozenset(row_lemmas)].append(token_id)

    row_map, offsets = [-1] * len(vocab), [0]
    targets: list[int] = []
    categories: list[int] = []
    covered: set[str] = set()
    for row_lemmas, token_ids in sorted(groups.items(), key=lambda item: min(item[1])):
        edges: set[tuple[int, int]] = set()
        for lemma in row_lemmas:
            for synset in lemma_synsets.get(lemma, ()):
                for target_lemma in synset_lemmas.get(synset, ()):
                    if target_lemma != lemma and target_lemma in lemma_id:
                        edges.add((lemma_id[target_lemma], CATEGORY_INDEX["synonym"]))
                for target_synset, category in synset_edges.get(synset, ()):
                    for target_lemma in synset_lemmas.get(target_synset, ()):
                        if target_lemma in row_lemmas or target_lemma not in lemma_id:
                            continue
                        target_id = lemma_id[target_lemma]
                        if not 0 <= target_id < len(vocab):
                            raise SystemExit(f"error: target {target_id} outside the static ids")
                        edges.add((target_id, CATEGORY_INDEX[category]))
        if not edges:
            continue
        for token_id in token_ids:
            row_map[token_id] = len(offsets) - 1
        for target_id, category in sorted(edges, key=lambda edge: (edge[1], edge[0])):
            targets.append(target_id)
            categories.append(category)
        offsets.append(len(targets))
        covered.update(row_lemmas)

    manifest = {
        "source": SOURCE,
        "license": LICENSE,
        "attribution": ATTRIBUTION,
        "vocabSha": hashlib.sha256("\n".join(vocab).encode("utf-8")).hexdigest(),
        "vocabSize": len(vocab),
        "rows": len(offsets) - 1,
        "edgeCount": len(targets),
        "coveredLemmas": len(covered),
        "categoryOrder": list(CATEGORIES),
    }
    return row_map, offsets, targets, categories, manifest


def upload(paths: list[str], repo: str, revision: str | None) -> str:
    """Upload the files to the HF dataset repo and return the last commit sha."""
    try:
        from huggingface_hub import HfApi, create_repo
    except ImportError as exc:
        raise SystemExit("error: huggingface_hub is not installed; pass --no-upload") from exc
    token = os.environ.get("HF_TOKEN")
    create_repo(repo, repo_type="dataset", exist_ok=True, token=token)
    for path in paths:
        commit = HfApi().upload_file(
            path_or_fileobj=path,
            path_in_repo=os.path.basename(path),
            repo_id=repo,
            repo_type="dataset",
            revision=revision,
            token=token,
            commit_message=f"Upload {SOURCE} WordNet bundle",
        )
    return commit.oid


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", default="english-wordnet-2025.xml.gz")
    parser.add_argument("--vocab", default="dist/word-vocab-50k.json")
    parser.add_argument("--out", default="dist/wordnet")
    parser.add_argument("--repo", default="chcaa/noisy-text-embeddings")
    parser.add_argument("--revision", default=None)
    parser.add_argument("--no-upload", action="store_true")
    args = parser.parse_args(argv)
    from export_word_vectors import load_vocab

    vocab = load_vocab(args.vocab)
    print(f"parsing {args.source}")
    row_map, offsets, targets, categories, manifest = build(vocab, read_lmf(args.source))
    import numpy as np

    os.makedirs(args.out, exist_ok=True)
    bin_path = os.path.join(args.out, f"{SOURCE}.bin")
    meta_path = os.path.join(args.out, f"{SOURCE}.meta.json")
    with open(bin_path, "wb") as handle:
        handle.write(struct.pack("<4sIII", MAGIC, VERSION, manifest["rows"], len(targets)))
        for values, dtype in (
            (row_map, "<i4"),
            (offsets, "<i4"),
            (targets, "<i4"),
            (categories, "u1"),
        ):
            np.asarray(values, dtype=dtype).tofile(handle)
    with open(meta_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")

    print(
        f"wrote {manifest['rows']:,} rows, {manifest['edgeCount']:,} edges, "
        f"{manifest['coveredLemmas']:,} covered lemmas"
    )
    for path in (bin_path, meta_path):
        print(f"wrote {path} ({os.path.getsize(path):,} bytes)")
    print(f"vocabSha: {manifest['vocabSha']}")
    if args.no_upload:
        print("not uploaded (--no-upload)")
        return 0

    sha = upload([bin_path, meta_path], args.repo, args.revision)
    print(f"uploaded to {args.repo} @ {sha}")
    print(f"pin this sha: WORDNET_DATASET_REVISION = '{sha}' in src/lib/wordnet/loader.ts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
