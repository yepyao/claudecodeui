import { describe, it, expect } from 'vitest';
import { paginateMessages } from '../projects.js';

function makeMessages(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    text: `Message ${i}`,
    timestamp: new Date(2025, 0, 1, 0, 0, i).toISOString(),
  }));
}

describe('paginateMessages', () => {
  describe('initial load (no offsetBegin/offsetEnd)', () => {
    it('returns last N messages when total > limit', () => {
      const msgs = makeMessages(100);
      const result = paginateMessages(msgs, { limit: 20 });

      expect(result.messages).toHaveLength(20);
      expect(result.messages[0].id).toBe('msg-80');
      expect(result.messages[19].id).toBe('msg-99');
      expect(result.offsetBegin).toBe(80);
      expect(result.offsetEnd).toBe(99);
      expect(result.total).toBe(100);
    });

    it('returns all messages when total <= limit', () => {
      const msgs = makeMessages(5);
      const result = paginateMessages(msgs, { limit: 20 });

      expect(result.messages).toHaveLength(5);
      expect(result.offsetBegin).toBe(0);
      expect(result.offsetEnd).toBe(4);
      expect(result.total).toBe(5);
    });

    it('returns empty for empty array', () => {
      const result = paginateMessages([], { limit: 20 });

      expect(result.messages).toHaveLength(0);
      expect(result.offsetBegin).toBe(-1);
      expect(result.offsetEnd).toBe(-1);
      expect(result.total).toBe(0);
    });

    it('uses default limit of 50', () => {
      const msgs = makeMessages(80);
      const result = paginateMessages(msgs);

      expect(result.messages).toHaveLength(50);
      expect(result.offsetBegin).toBe(30);
      expect(result.offsetEnd).toBe(79);
    });

    it('handles exactly limit messages', () => {
      const msgs = makeMessages(20);
      const result = paginateMessages(msgs, { limit: 20 });

      expect(result.messages).toHaveLength(20);
      expect(result.offsetBegin).toBe(0);
      expect(result.offsetEnd).toBe(19);
    });
  });

  describe('load history (offsetEnd specified)', () => {
    it('returns limit messages ending at offsetEnd (inclusive)', () => {
      const msgs = makeMessages(100);
      const result = paginateMessages(msgs, { limit: 20, offsetEnd: 79 });

      expect(result.messages).toHaveLength(20);
      expect(result.messages[0].id).toBe('msg-60');
      expect(result.messages[19].id).toBe('msg-79');
      expect(result.offsetBegin).toBe(60);
      expect(result.offsetEnd).toBe(79);
    });

    it('returns fewer messages when near the start', () => {
      const msgs = makeMessages(100);
      const result = paginateMessages(msgs, { limit: 20, offsetEnd: 9 });

      expect(result.messages).toHaveLength(10);
      expect(result.messages[0].id).toBe('msg-0');
      expect(result.messages[9].id).toBe('msg-9');
      expect(result.offsetBegin).toBe(0);
      expect(result.offsetEnd).toBe(9);
    });

    it('returns single message at offsetEnd=0', () => {
      const msgs = makeMessages(100);
      const result = paginateMessages(msgs, { limit: 20, offsetEnd: 0 });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].id).toBe('msg-0');
      expect(result.offsetBegin).toBe(0);
      expect(result.offsetEnd).toBe(0);
    });

    it('clamps offsetEnd to total-1 if too large', () => {
      const msgs = makeMessages(10);
      const result = paginateMessages(msgs, { limit: 20, offsetEnd: 999 });

      expect(result.messages).toHaveLength(10);
      expect(result.offsetBegin).toBe(0);
      expect(result.offsetEnd).toBe(9);
    });
  });

  describe('external update (offsetBegin specified)', () => {
    it('returns all messages from offsetBegin onward', () => {
      const msgs = makeMessages(105);
      const result = paginateMessages(msgs, { offsetBegin: 100 });

      expect(result.messages).toHaveLength(5);
      expect(result.messages[0].id).toBe('msg-100');
      expect(result.messages[4].id).toBe('msg-104');
      expect(result.offsetBegin).toBe(100);
      expect(result.offsetEnd).toBe(104);
      expect(result.total).toBe(105);
    });

    it('returns empty when offsetBegin >= total (no new messages)', () => {
      const msgs = makeMessages(100);
      const result = paginateMessages(msgs, { offsetBegin: 100 });

      expect(result.messages).toHaveLength(0);
      expect(result.offsetBegin).toBe(-1);
      expect(result.offsetEnd).toBe(-1);
      expect(result.total).toBe(100);
    });

    it('returns empty when offsetBegin > total', () => {
      const msgs = makeMessages(100);
      const result = paginateMessages(msgs, { offsetBegin: 200 });

      expect(result.messages).toHaveLength(0);
      expect(result.total).toBe(100);
    });

    it('returns all messages when offsetBegin=0', () => {
      const msgs = makeMessages(10);
      const result = paginateMessages(msgs, { offsetBegin: 0 });

      expect(result.messages).toHaveLength(10);
      expect(result.offsetBegin).toBe(0);
      expect(result.offsetEnd).toBe(9);
    });
  });

  describe('full lifecycle simulation', () => {
    it('initial load + scroll up + new messages — no gaps or duplicates', () => {
      const msgs = makeMessages(100);

      // Step 1: Initial load — last 20
      const step1 = paginateMessages(msgs, { limit: 20 });
      expect(step1.offsetBegin).toBe(80);
      expect(step1.offsetEnd).toBe(99);
      expect(step1.messages.map(m => m.id)).toEqual(
        Array.from({ length: 20 }, (_, i) => `msg-${80 + i}`)
      );

      // Step 2: Scroll up — load history ending before offsetBegin
      const step2 = paginateMessages(msgs, { limit: 20, offsetEnd: step1.offsetBegin - 1 });
      expect(step2.offsetBegin).toBe(60);
      expect(step2.offsetEnd).toBe(79);

      // Verify no overlap with step 1
      const step1Ids = new Set(step1.messages.map(m => m.id));
      for (const m of step2.messages) {
        expect(step1Ids.has(m.id)).toBe(false);
      }

      // Step 3: 5 new messages arrive (total = 105)
      const expandedMsgs = makeMessages(105);
      const step3 = paginateMessages(expandedMsgs, { offsetBegin: step1.offsetEnd + 1 });
      expect(step3.messages).toHaveLength(5);
      expect(step3.offsetBegin).toBe(100);
      expect(step3.offsetEnd).toBe(104);

      // Verify no overlap with previous steps
      const allPrevIds = new Set([
        ...step1.messages.map(m => m.id),
        ...step2.messages.map(m => m.id),
      ]);
      for (const m of step3.messages) {
        expect(allPrevIds.has(m.id)).toBe(false);
      }

      // Step 4: Continue scrolling up
      const step4 = paginateMessages(expandedMsgs, { limit: 20, offsetEnd: step2.offsetBegin - 1 });
      expect(step4.offsetBegin).toBe(40);
      expect(step4.offsetEnd).toBe(59);

      // Verify complete coverage: 40-59, 60-79, 80-99, 100-104
      const allIds = [
        ...step4.messages, ...step2.messages,
        ...step1.messages, ...step3.messages,
      ].map(m => m.id);
      const expected = Array.from({ length: 65 }, (_, i) => `msg-${40 + i}`);
      expect(allIds).toEqual(expected);
    });

    it('handles session with exactly 1 message', () => {
      const msgs = makeMessages(1);
      const result = paginateMessages(msgs, { limit: 20 });

      expect(result.messages).toHaveLength(1);
      expect(result.offsetBegin).toBe(0);
      expect(result.offsetEnd).toBe(0);
      expect(result.total).toBe(1);
    });

    it('external update returns empty when no new messages', () => {
      const msgs = makeMessages(100);

      const initial = paginateMessages(msgs, { limit: 20 });
      expect(initial.offsetEnd).toBe(99);

      const external = paginateMessages(msgs, { offsetBegin: 100 });
      expect(external.messages).toHaveLength(0);
      expect(external.offsetBegin).toBe(-1);
      expect(external.offsetEnd).toBe(-1);
    });
  });
});
