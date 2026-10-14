import { EntityKind, type EntityRecord, type PlayerInfo, type Removal, type SnapshotData } from '@slana/shared';
import type { DynamicEntity, StaticEntity } from '../game/entities';
import type { World } from '../game/world';

interface Known {
  /** Last version sent. */
  v: number;
  /** Generation in which it was last visible. */
  g: number;
}

/**
 * Per-connection view state: which entities (and at which version) and which
 * player infos the client already has. Used to send minimal delta snapshots.
 */
export class ViewState {
  readonly known = new Map<number, Known>();
  readonly knownPlayers = new Map<number, string>();
  private gen = 0;

  reset(): void {
    this.known.clear();
    this.knownPlayers.clear();
    this.gen = 0;
  }

  forgetPlayer(pid: number): void {
    this.knownPlayers.delete(pid);
  }

  /** Builds the delta for a view rectangle. Returns null when nothing changed. */
  build(world: World, rect: { x0: number; y0: number; x1: number; y1: number }, view: SnapshotData['view']): SnapshotData | null {
    const gen = ++this.gen;
    const upserts: EntityRecord[] = [];
    const players: PlayerInfo[] = [];

    world.forEachVisible(rect.x0, rect.y0, rect.x1, rect.y1, (e: StaticEntity | DynamicEntity) => {
      const k = this.known.get(e.id);
      if (!k) {
        this.known.set(e.id, { v: e.version, g: gen });
        upserts.push(toRecord(e));
      } else {
        k.g = gen;
        if (k.v !== e.version) {
          k.v = e.version;
          upserts.push(toRecord(e));
        }
      }
      if (e.kind === EntityKind.Cell) {
        const p = e.player;
        const sig = `${p.skin}|${p.flags}|${p.name}`;
        if (this.knownPlayers.get(p.id) !== sig) {
          this.knownPlayers.set(p.id, sig);
          players.push({ id: p.id, skin: p.skin, flags: p.flags, name: p.name });
        }
      }
    });

    const removals: Removal[] = [];
    for (const [id, k] of this.known) {
      if (k.g !== gen) {
        removals.push({ id, eaterId: world.removed.get(id) ?? 0 });
        this.known.delete(id);
      }
    }

    return { tick: world.tickCount, view, players, upserts, removals };
  }
}

function toRecord(e: StaticEntity | DynamicEntity): EntityRecord {
  switch (e.kind) {
    case EntityKind.Cell:
      return { id: e.id, kind: e.kind, x: e.x, y: e.y, r: e.r, playerId: e.player.id, flags: e.flags };
    case EntityKind.Food:
      return { id: e.id, kind: e.kind, x: e.x, y: e.y, r: e.r, variant: e.variant };
    case EntityKind.Eject:
      return { id: e.id, kind: e.kind, x: e.x, y: e.y, r: e.r, variant: e.skin };
    case EntityKind.Virus:
      return { id: e.id, kind: e.kind, x: e.x, y: e.y, r: e.r };
    case EntityKind.PowerUp:
      return { id: e.id, kind: e.kind, x: e.x, y: e.y, r: e.r, variant: e.type };
  }
}
