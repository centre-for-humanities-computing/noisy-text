import { AutoTokenizer } from '@huggingface/transformers';
import type { PreTrainedTokenizer } from '@huggingface/transformers';

import type { Tokenizer, TokenizerInfo } from './types.js';

/**
 * Wrap a HuggingFace `PreTrainedTokenizer` in our uniform {@link Tokenizer}
 * interface.
 *
 * ## Vocab size
 * Read from `tokenizer.model.vocab.length` (a `string[]` on
 * `TokenizerModel`). GPT-2 and BERT both populate this; we assert > 0.
 *
 * ## Special tokens
 * `encode` passes `add_special_tokens: false` so the user sees raw content
 * tokens. A toggle for `[CLS]`/`[SEP]` etc. may be added later.
 */
export async function loadHfTokenizer(info: TokenizerInfo, modelId: string): Promise<Tokenizer> {
	const hf: PreTrainedTokenizer = await AutoTokenizer.from_pretrained(modelId);

	// Vocab size: `hf.model.vocab` is a string[] on TokenizerModel.
	const vocabSize = hf.model.vocab.length;
	if (vocabSize <= 0) {
		throw new Error(`Could not determine vocab size for tokenizer "${modelId}"`);
	}

	return {
		info,
		vocabSize,

		encode(text: string): Int32Array {
			const encoded = hf.encode(text, { add_special_tokens: false });
			return Int32Array.from(encoded);
		},

		decode(ids: Int32Array): string {
			return hf.decode(Array.from(ids), { skip_special_tokens: false });
		},

		idsToTokens(ids: Int32Array): readonly string[] {
			return hf.model.convert_ids_to_tokens(Array.from(ids));
		},
	};
}
