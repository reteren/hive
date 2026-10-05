import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { board, replaceBoard } from "../src/model/board.svelte";
import { replaceZones } from "../src/model/zones.svelte";
import type { Note } from "../src/model/note";
import { selection } from "../src/selection/selection.svelte";
import { menuShortcutLabel } from "../src/commands/menuShortcut";
import { runZoneMenuAction, selectNoteForMenuAction } from "../src/commands/objectMenu";
import { resetAllCommandKeyOverrides, setCommandKeyOverrides } from "../src/commands/registry.svelte";
import { noteMenuItems, noteMenuItemsForContext } from "../src/notes/noteMenu";
import "../src/attachments/imageErase.svelte";
import { closeGifContextMenu, openGifContextMenu, setGifStopped } from "../src/attachments/gifPlayback.svelte";
import { takeZoneMoveRequest, zoneMode } from "../src/zones/zoneMode.svelte";
import { tool } from "../src/tools/tool.svelte";
import "../src/notes/noteCommands";
import "../src/tasks/taskActions.svelte";
import "../src/modules/commands";
import "../src/archive/init";
import "../src/beacons/focusCommands";
import "../src/clipboard/commands";

function note(id: string, type: Note["type"] = "note"): Note {
  return {
    id,
    type,
    name: id,
    text: "",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    createdAt: 0,
    ...(type === "image" ? { image: { file: "asset.png", name: "image.png", mime: "image/png", size: 1, naturalWidth: 640, naturalHeight: 480 } } : {}),
  } as Note;
}

beforeEach(() => {
  resetAllCommandKeyOverrides();
  replaceBoard([
    note("plain"),
    { ...note("text-file", "format"), media: { kind: "text", file: "a.json", name: "data.json", mime: "application/json", size: 1 } },
    note("pdf", "pdf"),
    note("audio", "audio"),
    note("photo", "image"),
    { ...note("gif", "image"), image: { file: "gif.gif", name: "loop.gif", mime: "image/gif", size: 1, naturalWidth: 320, naturalHeight: 240 } },
    note("beacon", "beacon"),
  ]);
  replaceZones([]);
  selection.ids = [];
  selection.zoneIds = [];
  selection.primaryId = null;
  closeGifContextMenu();
  zoneMode.active = "brush";
  zoneMode.moveRequest = null;
  zoneMode.resizeZoneId = null;
  tool.active = "select";
});

afterEach(() => {
  resetAllCommandKeyOverrides();
  closeGifContextMenu();
  zoneMode.moveRequest = null;
  zoneMode.resizeZoneId = null;
  tool.active = "select";
});

describe("board object context menus", () => {
  it("keeps ordinary note entries and limits images to their supported actions", () => {
    const plainIds = noteMenuItemsForContext("plain").map((item) => item.id);
    expect(plainIds).toContain("task.toggleFlag");
    expect(plainIds).not.toContain("notes.addPlus");
    expect(plainIds).not.toContain("notes.addMinus");
    expect(plainIds).not.toContain("module.importance");
    expect(plainIds).not.toContain("module.purpose");
    expect(plainIds).not.toContain("module.mood");
    expect(plainIds.slice(-3)).toEqual(["object.scale", "object.grab", "object.delete"]);

    expect(noteMenuItems("text-file").map((item) => item.id)).toContain("task.toggleFlag");
    expect(noteMenuItems("pdf").map((item) => item.id)).not.toContain("task.toggleFlag");
    expect(noteMenuItems("audio").map((item) => item.id)).not.toContain("task.toggleFlag");

    const imageItems = noteMenuItemsForContext("photo");
    expect(imageItems.map((item) => item.id)).toEqual([
      "notes.copyLink", "image.opacity", "image.erase", "archive.note", "object.scale", "object.grab", "object.delete",
    ]);
    expect(imageItems[0]?.label("photo")).toBe("Copy link to image");
    expect(imageItems[2]?.label("photo")).toBe("Erase");
    expect(imageItems.some((item) => item.id === "task.toggleFlag")).toBe(false);
    expect(imageItems.some((item) => ["notes.addPlus", "notes.addMinus", "module.importance", "module.purpose", "module.mood"].includes(item.id))).toBe(false);
  });

  it("keeps legacy task nodes unmarkable even when their kind cannot become a new task", () => {
    const legacyTask = { ...note("legacy-task", "image"), task: { done: false, doneAt: null } };
    replaceBoard([legacyTask]);
    const item = noteMenuItemsForContext("legacy-task").find(({ id }) => id === "task.toggleFlag");

    expect(item?.label("legacy-task")).toBe("Unmark as task");
    item?.run("legacy-task");
    expect(board.notes["legacy-task"]?.task).toBeNull();
  });

  it("shows the GIF toggle beside copy/archive and universal actions, and keeps beacon actions", () => {
    const target = { kind: "board" as const, noteId: "gif" };
    openGifContextMenu(target);
    const gifItems = noteMenuItemsForContext("gif", target);
    expect(gifItems.map((item) => item.id)).toEqual([
      "notes.copyLink", "attachments.toggleGif", "image.opacity", "archive.note", "object.scale", "object.grab", "object.delete",
    ]);
    expect(gifItems[0]?.label("gif")).toBe("Copy link to gif");
    expect(gifItems.find((item) => item.id === "attachments.toggleGif")?.label("gif")).toBe("Stop gif");
    setGifStopped(target, true);
    expect(gifItems.find((item) => item.id === "attachments.toggleGif")?.label("gif")).toBe("Play gif");

    const beaconItems = noteMenuItems("beacon");
    expect(beaconItems.map((item) => item.id)).toContain("beacons.toggleMark");
    expect(beaconItems.map((item) => item.id)).toContain("object.scale");
    expect(beaconItems.map((item) => item.id)).toContain("object.grab");
    expect(beaconItems.map((item) => item.id)).toContain("object.delete");
  });

  it("uses current key bindings for grey menu hints", () => {
    expect(menuShortcutLabel("select.scale")).toBe("S");
    expect(menuShortcutLabel("select.move")).toBe("G");
    expect(menuShortcutLabel("edit.delete")).toBe("Del / Backspace");

    setCommandKeyOverrides({ "select.scale": ["Ctrl+KeyK"] });
    expect(menuShortcutLabel("select.scale")).toBe("Ctrl+K");
  });

  it("selects a menu target alone unless it already belongs to the current group", () => {
    selection.ids = ["plain", "beacon"];
    selection.primaryId = "beacon";
    expect(selectNoteForMenuAction("plain")).toBe(true);
    expect(selection.ids).toEqual(["plain", "beacon"]);

    expect(selectNoteForMenuAction("photo")).toBe(true);
    expect(selection.ids).toEqual(["photo"]);
    expect(selection.primaryId).toBe("photo");
  });

  it("puts zone Grab into zone move mode and starts a move request", () => {
    const zone = {
      id: "zone-1",
      name: "Zone",
      color: "#608ac1",
      parts: [[{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }]],
      holes: [],
    };
    replaceZones([zone]);
    const startWorld = { x: 4, y: 6 };

    runZoneMenuAction(zone.id, "grab", startWorld);

    expect(tool.active).toBe("zone");
    expect(zoneMode.active).toBe("move");
    expect(selection.zoneIds).toEqual([zone.id]);
    expect(takeZoneMoveRequest()).toEqual({ zoneId: zone.id, startWorld });
  });
});
