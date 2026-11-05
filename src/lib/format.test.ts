import { describe, it, expect } from 'vitest';

import { formatCount } from './format.js';

describe('formatCount', () => {
	it('groups thousands with plain spaces', () => {
		expect(formatCount(0)).toBe('0');
		expect(formatCount(500)).toBe('500');
		expect(formatCount(50_000)).toBe('50 000');
		expect(formatCount(1_234_567)).toBe('1 234 567');
	});
});
