import { describe, expect, it } from 'vitest';
import {
  assembleContext,
  cutToTokens,
  estimateTokens,
  renderKit,
  type KitForContext,
} from './context.js';

const kit: KitForContext = {
  promise: 'Be there for your people, in Joy and Care.',
  behaviours: [{ text: 'Hearts are counted, not named', specRef: '006' }],
  neverSay: ['spy', 'track'],
  notBuilt: [{ text: 'Video calls', specRef: null }],
  audiences: ['Families abroad'],
  activationEvent: 'First byte sent',
};

describe('estimateTokens and cutToTokens', () => {
  it('estimates about 4 characters per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('cuts long text and marks it', () => {
    const text = 'word '.repeat(100);
    const cut = cutToTokens(text, 10);
    expect(cut.endsWith('[cut]')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(48);
    expect(cutToTokens('short', 10)).toBe('short');
  });
});

describe('renderKit', () => {
  it('lists every kit part with spec refs', () => {
    const text = renderKit('Humini Live', kit);
    expect(text).toContain('# Product: Humini Live');
    expect(text).toContain('Promise: Be there for your people');
    expect(text).toContain('- Hearts are counted, not named (spec 006)');
    expect(text).toContain('Never say: spy, track');
    expect(text).toContain('- Video calls');
    expect(text).toContain('Activation event: First byte sent');
  });

  it('says when there is no kit', () => {
    expect(renderKit('X', null)).toContain('No product kit yet.');
  });
});

describe('assembleContext', () => {
  const pinned = [
    { id: 'p1', title: 'Spec 006', text: 'Pinned one full text.' },
    { id: 'p2', title: 'Spec 007', text: 'Pinned two full text.' },
  ];
  const others = [
    { id: 'o1', title: 'Brand note', text: 'Short summary.' },
    { id: 'o2', title: 'Old deck', text: 'Another summary.' },
  ];

  it('puts kit first, then pinned in full, then summaries, in the given order', () => {
    const out = assembleContext({ productName: 'Live', kit, pinned, others }, 5000);
    expect(out.documentIds).toEqual(['p1', 'p2', 'o1', 'o2']);
    const t = out.text;
    expect(t.indexOf('Product kit')).toBeLessThan(t.indexOf('Pinned documents'));
    expect(t.indexOf('Pinned two full text')).toBeLessThan(t.indexOf('Other documents'));
    expect(t).toContain('- Brand note: Short summary.');
    expect(out.tokenEstimate).toBe(estimateTokens(t));
  });

  it('never goes over the budget', () => {
    const big = [{ id: 'big', title: 'Big', text: 'x '.repeat(20_000) }];
    for (const budget of [50, 300, 1000, 3000]) {
      const out = assembleContext({ productName: 'Live', kit, pinned: big, others }, budget);
      expect(out.tokenEstimate).toBeLessThanOrEqual(budget + 2);
    }
  });

  it('cuts a pinned document that does not fit when enough budget is left', () => {
    const big = [{ id: 'big', title: 'Big', text: 'word '.repeat(5000) }];
    const out = assembleContext({ productName: 'Live', kit, pinned: big, others: [] }, 1000);
    expect(out.documentIds).toEqual(['big']);
    expect(out.text).toContain('[cut]');
  });

  it('skips a summary that does not fit and keeps a smaller later one', () => {
    const out = assembleContext(
      {
        productName: 'Live',
        kit: null,
        pinned: [],
        others: [
          { id: 'long', title: 'Long', text: 'y'.repeat(4000) },
          { id: 'small', title: 'Small', text: 'tiny' },
        ],
      },
      200,
    );
    expect(out.documentIds).toEqual(['small']);
  });

  it('skips empty summaries', () => {
    const out = assembleContext(
      { productName: 'Live', kit: null, pinned: [], others: [{ id: 'e', title: 'E', text: '  ' }] },
      500,
    );
    expect(out.documentIds).toEqual([]);
  });
});
