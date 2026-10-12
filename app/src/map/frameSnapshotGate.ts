/** Limits a dirty shared snapshot to one rebuild in each animation frame. */
export class FrameSnapshotGate {
  private dirty = true;
  private builtThisFrame = false;

  invalidate(): void {
    this.dirty = true;
  }

  beginFrame(): void {
    this.builtThisFrame = false;
  }

  claimBuild(): boolean {
    if (!this.dirty || this.builtThisFrame) return false;
    this.dirty = false;
    this.builtThisFrame = true;
    return true;
  }

  buildFailed(): void {
    this.dirty = true;
  }
}
