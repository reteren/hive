import type { Camera } from "../board/cameraMath";

export type CameraSnapshot = Pick<Camera, "x" | "y" | "zoom">;

function clone(snapshot: CameraSnapshot): CameraSnapshot {
  return { x: snapshot.x, y: snapshot.y, zoom: snapshot.zoom };
}

function sameSnapshot(a: CameraSnapshot | undefined, b: CameraSnapshot): boolean {
  return a !== undefined && a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

/** Teleport-only camera history. Ordinary camera movement never enters this stack. */
export class NavigationHistory {
  entries: CameraSnapshot[] = [];
  cursor = -1;

  get canGoBack(): boolean {
    return this.cursor > 0;
  }

  get canGoForward(): boolean {
    return this.cursor >= 0 && this.cursor < this.entries.length - 1;
  }

  /** Add the pre-jump and destination states, trimming any forward branch. */
  push(before: CameraSnapshot, after: CameraSnapshot): void {
    if (this.cursor < 0) {
      this.entries = [clone(before)];
      this.cursor = 0;
    } else {
      this.entries.splice(this.cursor + 1);
      if (!sameSnapshot(this.entries[this.cursor], before)) {
        this.entries.push(clone(before));
        this.cursor = this.entries.length - 1;
      }
    }

    if (!sameSnapshot(this.entries[this.cursor], after)) {
      this.entries.push(clone(after));
      this.cursor = this.entries.length - 1;
    }
  }

  back(): CameraSnapshot | undefined {
    if (!this.canGoBack) return undefined;
    this.cursor -= 1;
    return clone(this.entries[this.cursor]);
  }

  forward(): CameraSnapshot | undefined {
    if (!this.canGoForward) return undefined;
    this.cursor += 1;
    return clone(this.entries[this.cursor]);
  }

  /** Move the navigation cursor to an existing camera state after Undo/Redo. */
  pointTo(snapshot: CameraSnapshot): boolean {
    let match = -1;
    for (let index = 0; index < this.entries.length; index += 1) {
      if (sameSnapshot(this.entries[index], snapshot)) match = index;
    }
    if (match < 0) return false;
    this.cursor = match;
    return true;
  }

  clear(): void {
    this.entries = [];
    this.cursor = -1;
  }
}
