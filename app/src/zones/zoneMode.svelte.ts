import type { Point } from "../board/cameraMath";
import type { ZoneToolMode } from "./zoneMode";
import { toggleZoneToolMode } from "./zoneMode";

export interface ZoneMoveRequest {
  zoneId: string;
  startWorld: Point;
}

export const zoneMode = $state({
  active: "brush" as ZoneToolMode,
  followMoveActive: false,
  moveRequest: null as ZoneMoveRequest | null,
  finishRequest: 0,
  suppressContextMenuUntil: 0,
});

export function toggleZoneMoveMode(): ZoneToolMode {
  zoneMode.active = toggleZoneToolMode(zoneMode.active);
  zoneMode.finishRequest += 1;
  return zoneMode.active;
}

export function setZoneToolMode(mode: ZoneToolMode): void {
  if (zoneMode.active === mode) return;
  zoneMode.active = mode;
  zoneMode.finishRequest += 1;
}

export function requestZoneMove(request: ZoneMoveRequest): void {
  zoneMode.moveRequest = {
    ...request,
    startWorld: { ...request.startWorld },
  };
}

export function takeZoneMoveRequest(): ZoneMoveRequest | null {
  const request = zoneMode.moveRequest;
  zoneMode.moveRequest = null;
  return request;
}
