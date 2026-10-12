import { GridIndex, type Rect } from "../board/spatialIndex";
import { zoneBounds, type Zone } from "../model/zone";

export class ZoneBoundsIndex {
  private readonly index = new GridIndex(96, 256);
  private readonly zonesById = new Map<string, Zone>();
  private readonly order = new Map<string, number>();

  rebuild(zones: readonly Zone[], orderedIds: readonly string[]): void {
    this.index.clear();
    this.zonesById.clear();
    this.order.clear();
    const byId = new Map(zones.map((zone) => [zone.id, zone]));
    for (let position = 0; position < orderedIds.length; position += 1) {
      const id = orderedIds[position]!;
      const zone = byId.get(id);
      if (!zone) continue;
      this.zonesById.set(id, zone);
      this.order.set(id, position);
      this.index.set(id, zoneBounds(zone));
    }
  }

  /** Update one zone without rebuilding the index during a zone drag. */
  update(zone: Zone, orderIndex: number): void {
    this.zonesById.set(zone.id, zone);
    this.order.set(zone.id, orderIndex);
    this.index.set(zone.id, zoneBounds(zone));
  }

  remove(id: string): void {
    this.zonesById.delete(id);
    this.order.delete(id);
    this.index.delete(id);
  }

  boundsOf(id: string): Rect | undefined {
    return this.index.rectOf(id);
  }

  query(bounds: Rect): Zone[] {
    return this.index.query(bounds)
      .map((id) => this.zonesById.get(id))
      .filter((zone): zone is Zone => zone !== undefined)
      .sort((first, second) => (this.order.get(first.id) ?? 0) - (this.order.get(second.id) ?? 0));
  }
}
