import { MAP_GROW, encodeSnapshot, type SnapshotData } from '@elymum/shared';
import { describe, expect, it } from 'vitest';
import { Camera } from '../src/game/camera';
import { ClientWorld } from '../src/game/state';

const snap = (bounds?: SnapshotData['bounds']): SnapshotData => ({ tick: 1, view: { x: 6000, y: 6000, h: 1200 }, ...(bounds ? { bounds } : {}), players: [], upserts: [], removals: [] });

describe('ClientWorld · adaptive map bounds', () => {
  it('takes the first bounds after a reset at once, then eases the border to new ones', () => {
    const w = new ClientWorld();
    w.applyBinary(encodeSnapshot(snap({ x0: 4500, y0: 4500, x1: 7500, y1: 7500 })), 1000);
    expect([w.x0, w.y0, w.width, w.height]).toEqual([4500, 4500, 3000, 3000]);
    expect({ ...w.edgeAt(1000) }).toEqual({ x0: 4500, y0: 4500, x1: 7500, y1: 7500 });
    // the map grows by 600: the border opens over MAP_GROW.animMs
    w.applyBinary(encodeSnapshot(snap({ x0: 4200, y0: 4200, x1: 7800, y1: 7800 })), 2000);
    expect(w.width).toBe(3600);
    const mid = { ...w.edgeAt(2000 + MAP_GROW.animMs / 2) };
    expect(mid.x0).toBeLessThan(4500);
    expect(mid.x0).toBeGreaterThan(4200);
    expect(mid.x1).toBeGreaterThan(7500);
    expect(mid.x1).toBeLessThan(7800);
    expect({ ...w.edgeAt(2000 + MAP_GROW.animMs) }).toEqual({ x0: 4200, y0: 4200, x1: 7800, y1: 7800 });
    // snapshots without bounds change nothing
    w.applyBinary(encodeSnapshot(snap()), 9000);
    expect(w.width).toBe(3600);
    // a fresh view (new room): the next bounds snap again
    w.reset();
    w.apply(snap({ x0: 0, y0: 0, x1: 6800, y1: 6800 }), 9100);
    expect({ ...w.edgeAt(9100) }).toEqual({ x0: 0, y0: 0, x1: 6800, y1: 6800 });
  });

  it('a step that lands mid-animation starts from where the border is drawn', () => {
    const w = new ClientWorld();
    w.setBounds(4500, 4500, 7500, 7500, 0, true);
    w.setBounds(4200, 4200, 7800, 7800, 100);
    const at = { ...w.edgeAt(100 + MAP_GROW.animMs / 3) };
    w.setBounds(3900, 3900, 8100, 8100, 100 + MAP_GROW.animMs / 3);
    // no jump back to the old target or forward to the new one
    expect({ ...w.edgeAt(100 + MAP_GROW.animMs / 3) }).toEqual(at);
    expect({ ...w.edgeAt(100 + MAP_GROW.animMs * 2) }).toEqual({ x0: 3900, y0: 3900, x1: 8100, y1: 8100 });
    // nonsense is ignored
    w.setBounds(10, 10, 5, 5, 5000);
    expect(w.width).toBe(4200);
  });

  it('the camera centre stays on the floor', () => {
    const cam = new Camera();
    cam.resize(800, 600);
    cam.limit = { x0: 4500, y0: 4500, x1: 7500, y1: 7500 };
    cam.follow(100, 9000, 1000, 1 / 60, true);
    expect([cam.x, cam.y]).toEqual([4500, 7500]);
    cam.follow(6000, 6100, 1000, 1 / 60, true);
    expect([cam.x, cam.y]).toEqual([6000, 6100]);
  });
});
