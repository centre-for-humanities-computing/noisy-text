import { describe, it, expect } from 'vitest';
import { TOKENIZERS } from './registry.js';

describe('tokenizer registry', () => {
  it('contains at least two tokenizers', () => {
    const ids = Object.keys(TOKENIZERS);
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it('every entry has the required shape', () => {
    for (const [id, info] of Object.entries(TOKENIZERS)) {
      expect(info.id).toBe(id);
      expect(typeof info.label).toBe('string');
      expect(info.label.length).toBeGreaterThan(0);
      expect(typeof info.description).toBe('string');
      expect(info.description.length).toBeGreaterThan(0);
    }
  });

  it('ids are unique', () => {
    const ids = Object.keys(TOKENIZERS);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
