/**
 * trending.test.js — F-06 trending community topics.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db/queries.js', () => ({
  query: vi.fn(), queryOne: vi.fn(), queryRows: vi.fn(),
}));

const { topTerms, STOPWORDS, TRENDING_LIMIT } = await import('../routes/trending.js');

describe('topTerms', () => {
  it('F-06: ranks by frequency', () => {
    const terms = topTerms(['water water lift', 'water outage']);
    expect(terms[0]).toEqual({ term: 'water', count: 3 });
  });

  it('F-06: returns at most five terms', () => {
    expect(topTerms(['alpha bravo charlie delta echo foxtrot golf']).length).toBe(TRENDING_LIMIT);
  });

  // A list of "the, is, for" describes English, not the community.
  it('F-06: drops stopwords', () => {
    const terms = topTerms(['The water is for the block']).map((t) => t.term);
    expect(terms).toContain('water');
    expect(terms).not.toContain('the');
    expect(terms).not.toContain('for');
  });

  it('F-06: drops words shorter than three letters', () => {
    expect(topTerms(['AC on 2nd']).map((t) => t.term)).not.toContain('ac');
  });

  it('F-06: is case-insensitive so Water and water are one topic', () => {
    expect(topTerms(['Water', 'water', 'WATER'])[0]).toEqual({ term: 'water', count: 3 });
  });

  it('F-06: splits possessives rather than inventing a separate topic', () => {
    expect(topTerms(["gate's gate"])[0].count).toBe(2);
  });

  it('F-06: breaks ties alphabetically so the list does not reshuffle', () => {
    expect(topTerms(['zebra apple']).map((t) => t.term)).toEqual(['apple', 'zebra']);
  });

  it('F-06: survives empty and null titles', () => {
    expect(topTerms(['', null, undefined, 'water'])).toEqual([{ term: 'water', count: 1 }]);
  });

  it('F-06: keeps the stopword list lowercase, matching how terms are compared', () => {
    for (const w of STOPWORDS) expect(w).toBe(w.toLowerCase());
  });
});
