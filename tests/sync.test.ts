import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/supabase', () => ({ supabase: null }));
vi.mock('../src/lib/db', () => ({ db: {}, getMeta: vi.fn(), setMeta: vi.fn(), TABLES: [] }));

const { upsertInChunks } = await import('../src/lib/sync');

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));

describe('upsertInChunks', () => {
  it('sends rows in chunks of the given size', async () => {
    const sizes: number[] = [];
    await upsertInChunks(rows(120), async (p) => (sizes.push(p.length), null), () => {}, 50);
    expect(sizes).toEqual([50, 50, 20]);
  });

  it('isolates rows the server rejects and keeps the rest', async () => {
    const accepted = new Set<string>();
    const rejected: string[] = [];
    await upsertInChunks(
      rows(50),
      async (p) => {
        if (p.some((r) => r.id === 'r7' || r.id === 'r33')) return { code: '22P02', message: 'invalid input' };
        p.forEach((r) => accepted.add(r.id));
        return null;
      },
      (r) => rejected.push(r.id),
      50,
    );
    expect(rejected.sort()).toEqual(['r33', 'r7']);
    expect(accepted.size).toBe(48);
  });

  it('fails the whole run on errors not tied to rows', async () => {
    await expect(
      upsertInChunks(rows(3), async () => ({ code: '42501', message: 'permission denied' }), () => {}),
    ).rejects.toThrow('permission denied');
  });
});
