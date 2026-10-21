/**
 * Diff primitives for comparing trajectory rows against $x_0$.
 *
 * These are pure functions — no imports from stores, workers, or components.
 */

import type { Trajectory } from './types.js';

// ── Token-level diffs ────────────────────────────────────────────────

/**
 * Count the number of positions where $x_t$ differs from $x_0$.
 *
 * @param x0 - The original token sequence $x_0$, length $L$.
 * @param xt - The noised tokens at timestep $t$, length $L$.
 * @returns Number of changed positions.
 */
export function countChanged(x0: Int32Array, xt: Int32Array): number {
	if (x0.length !== xt.length) {
		throw new Error(`Length mismatch: x0 has ${x0.length} tokens, xt has ${xt.length}`);
	}

	let count = 0;
	for (let i = 0; i < x0.length; i++) {
		if (x0[i] !== xt[i]) count++;
	}
	return count;
}

/**
 * Build a boolean mask indicating which positions differ from $x_0$.
 *
 * @param x0 - The original token sequence $x_0$, length $L$.
 * @param xt - The noised tokens at timestep $t$, length $L$.
 * @param out - Optional reusable output buffer. If provided, it must have
 *   length $\ge L$ and will be overwritten.
 * @returns A `Uint8Array` of length $L$ where `1` means changed.
 */
export function changedMask(x0: Int32Array, xt: Int32Array, out?: Uint8Array): Uint8Array {
	if (x0.length !== xt.length) {
		throw new Error(`Length mismatch: x0 has ${x0.length} tokens, xt has ${xt.length}`);
	}

	const L = x0.length;
	const mask = out ?? new Uint8Array(L);
	for (let i = 0; i < L; i++) {
		mask[i] = x0[i] !== xt[i] ? 1 : 0;
	}
	return mask;
}

/**
 * Compute per-position recency of change at timestep $t$.
 *
 * For each position $i$, scans backward from $t$ to find the most recent
 * step where the token changed. Recency is $1 - \text{stepsAgo} / W$,
 * clamped to $[0, 1]$, where $W$ is the taper window. A position that
 * changed at the current step has recency $1$; a position unchanged
 * within the window has recency $0$.
 *
 * At $t = 0$ there is no previous step, so all positions have recency $0$.
 *
 * @param traj - The trajectory.
 * @param t - Current timestep $t \in [0, T]$.
 * @param window - Number of steps over which recency fades (must be $\ge 1$).
 * @param out - Optional reusable output buffer. If provided, it must have
 *   length $\ge L$ and will be overwritten.
 * @returns A `Float32Array` of length $L$ with recency in $[0, 1]$.
 */
export function recencyAt(
	traj: Trajectory,
	t: number,
	window: number,
	out?: Float32Array,
): Float32Array {
	const L = traj.length;
	const recency = out ?? new Float32Array(L);

	if (t === 0) {
		recency.fill(0);
		return recency;
	}

	const start = Math.max(1, t - window + 1);
	for (let i = 0; i < L; i++) {
		let found = false;
		for (let s = t; s >= start; s--) {
			if (traj.tokensAt(s)[i] !== traj.tokensAt(s - 1)[i]) {
				const stepsAgo = t - s;
				recency[i] = Math.max(0, 1 - stepsAgo / window);
				found = true;
				break;
			}
		}
		if (!found) {
			recency[i] = 0;
		}
	}
	return recency;
}

// ── Character-level ranges from token recency ────────────────────────

/**
 * A changed character range with a recency value in $[0, 1]$.
 */
export interface CharRange {
	/** Start index (inclusive) in the current decoded string. */
	start: number;
	/** End index (exclusive) in the current decoded string. */
	end: number;
	/** Recency $r \in [0, 1]$; $1$ = changed this step, $0$ = faded out. */
	recency: number;
}

/**
 * Map per-token recency to character ranges in the decoded prose string.
 *
 * Each token ID is decoded individually to determine its character length
 * in the final string. Mask sentinel positions are skipped (they are
 * invisible in prose mode). Adjacent tokens with the same recency are
 * merged into a single span.
 *
 * This approach uses token boundaries to constrain character spans,
 * avoiding the false positives that arise from pure character-level
 * diffs when token replacements shift character positions.
 *
 * @param ids - Token IDs for the current step (includes mask sentinels).
 * @param tokenRecency - Per-position recency from `recencyAt`, length $L$.
 * @param decodeToken - Function that decodes a single token ID to its
 *   rendered text (e.g. `tok.decode(new Int32Array([id]))`).
 * @param maskSentinel - The sentinel ID used for mask tokens; these
 *   positions are skipped.
 * @returns Sorted, non-overlapping `CharRange` objects with recency in $[0, 1]$.
 */
export function tokenCharRanges(
	ids: Int32Array,
	tokenRecency: Float32Array,
	decodeToken: (id: number) => string,
	maskSentinel: number,
): CharRange[] {
	const ranges: CharRange[] = [];
	let charPos = 0;

	for (let i = 0; i < ids.length; i++) {
		const r = tokenRecency[i]!;
		const id = ids[i]!;

		if (id === maskSentinel) continue;

		const text = decodeToken(id);
		const len = text.length;

		if (r > 0 && len > 0) {
			// Merge with previous range if same recency and adjacent.
			const prev = ranges[ranges.length - 1];
			if (prev && prev.recency === r && prev.end === charPos) {
				prev.end = charPos + len;
			} else {
				ranges.push({ start: charPos, end: charPos + len, recency: r });
			}
		}

		charPos += len;
	}

	return ranges;
}

/** One token's decoded text, with its position in the token sequence. */
export interface TokenPiece {
	/** Position index in the token sequence. */
	index: number;
	/** The token id at this position. */
	tokenId: number;
	/** The text this token renders in isolation (e.g. `tok.decode([id])`). */
	text: string;
}

/** A character span $[start, end)$ in the decoded prose string. */
export interface PieceSpan {
	/** Start index (inclusive) in the decoded string. */
	start: number;
	/** End index (exclusive) in the decoded string. */
	end: number;
}

/**
 * Align each piece's isolated text to its span in the decoded prose string.
 *
 * Decoding tokens one at a time omits the separators a whole-sequence
 * decode inserts (WordPiece puts a space before every non-`##` piece), so
 * per-token lengths never sum to the full decoded length. Instead of
 * summing lengths, a greedy cursor scans the decoded text: each piece is
 * matched at the cursor, which then advances past the matched text.
 *
 * Matching rules, in order (the cursor never moves backwards):
 *
 * 1. Exact match at the cursor — covers `##` continuations and GPT-2-style
 *    pieces whose leading space is part of the piece text.
 * 2. Whitespace-skip match — skip whitespace after the cursor, then match.
 *    Covers WordPiece separators inserted by the whole-sequence decode.
 * 3. `indexOf` fallback — search forward from the cursor for intervening
 *    cleanup artifacts the skip rule cannot handle. If not found, the
 *    piece gets an empty span at the cursor and the cursor stays put.
 *
 * Empty pieces never match anything and never move the cursor.
 *
 * @param text - The whole-sequence decoded string.
 * @param pieces - The pieces in token order; `text` should decode from
 *   exactly these pieces (mask sentinels already filtered out).
 * @returns One `PieceSpan` per piece, aligned to `text`. Pieces that
 *   cannot be located get an empty span at the current cursor.
 */
export function alignTokenPieces(text: string, pieces: readonly TokenPiece[]): PieceSpan[] {
	const spans: PieceSpan[] = [];
	let cursor = 0;

	for (const piece of pieces) {
		const { text: pieceText } = piece;
		let start: number;
		let end: number;

		if (pieceText.length > 0 && text.startsWith(pieceText, cursor)) {
			start = cursor;
			end = cursor + pieceText.length;
		} else {
			let skip = cursor;
			while (skip < text.length && /\s/.test(text[skip]!)) skip++;
			if (skip > cursor && pieceText.length > 0 && text.startsWith(pieceText, skip)) {
				start = skip;
				end = skip + pieceText.length;
			} else {
				const found = pieceText.length > 0 ? text.indexOf(pieceText, cursor) : -1;
				if (found >= 0) {
					start = found;
					end = found + pieceText.length;
				} else {
					start = cursor;
					end = cursor;
				}
			}
		}

		spans.push({ start, end });
		if (end > cursor) cursor = end;
	}

	return spans;
}

/** A per-token character span in the decoded prose string. */
export interface TokenCharSpan {
	/** Start index (inclusive) in the decoded string. */
	start: number;
	/** End index (exclusive) in the decoded string. */
	end: number;
	/** The token id at this position. */
	tokenId: number;
	/** Position index in the token sequence. */
	index: number;
	/** Recency $r \in [0, 1]$ for the taper highlight. */
	recency: number;
}

/**
 * Map every token to its character span in the decoded prose string.
 *
 * Unlike `tokenCharRanges` (which emits only changed spans for taper
 * rendering), this emits one span per visible token so the prose view can
 * make each token individually hoverable. Mask sentinel positions are
 * skipped (invisible in prose mode).
 *
 * @param ids - Token IDs for the current step (includes mask sentinels).
 * @param tokenRecency - Per-position recency from `recencyAt`, length $L$.
 * @param decodeToken - Function that decodes a single token ID to its
 *   rendered text (e.g. `tok.decode(new Int32Array([id]))`).
 * @param maskSentinel - The sentinel ID used for mask tokens; these
 *   positions are skipped.
 * @returns One `TokenCharSpan` per visible token, in order.
 */
export function allTokenCharSpans(
	ids: Int32Array,
	tokenRecency: Float32Array,
	decodeToken: (id: number) => string,
	maskSentinel: number,
): TokenCharSpan[] {
	const spans: TokenCharSpan[] = [];
	let charPos = 0;

	for (let i = 0; i < ids.length; i++) {
		const id = ids[i]!;
		if (id === maskSentinel) continue;

		const text = decodeToken(id);
		const len = text.length;
		if (len > 0) {
			spans.push({
				start: charPos,
				end: charPos + len,
				tokenId: id,
				index: i,
				recency: tokenRecency[i] ?? 0,
			});
		}
		charPos += len;
	}

	return spans;
}
