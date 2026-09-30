import { beforeEach, describe, expect, it } from "vitest";
import type { ImageRef } from "../src/attachments/types";
import { addImageTierCards, moveTierlistCard, rowsForTierlist } from "../src/tierlist/actions.svelte";
import { clear as clearHistory, execute, history, redo, undo } from "../src/history/history.svelte";
import { createContentMoveCommand } from "../src/list/transfers.svelte";
import { board, replaceBoard } from "../src/model/board.svelte";
import type { Note } from "../src/model/note";
import { parseTiers } from "../src/model/nodeData";
import { createDefaultTierRows, tierCardPreview } from "../src/tierlist/logic";

function imageRef(hash = "a", name = "portrait.png"): ImageRef {
  return {
    file: `${hash.repeat(64)}.png`,
    mime: "image/png",
    size: 1024,
    name,
    naturalWidth: 300,
    naturalHeight: 400,
  };
}

function createTierlist(): Note {
  let rowId = 0;
  return {
    id: "tierlist",
    type: "tierlist",
    name: "Ranking",
    text: "",
    x: 10,
    y: 20,
    width: 60,
    height: null,
    tiers: createDefaultTierRows(() => `row-${rowId++}`),
  };
}

const list: Note = {
  id: "list",
  type: "list",
  name: "Ideas",
  text: "",
  x: 80,
  y: 20,
  width: 30,
  height: null,
  listItems: [],
};

describe("Tierlist image cards", () => {
  beforeEach(() => {
    replaceBoard([createTierlist()]);
    clearHistory();
  });

  it("parses valid ImageRef data and drops cards with invalid image fields", () => {
    const image = imageRef();
    const parsed = parseTiers([{
      id: "row",
      name: "S",
      color: "#ff4b5c",
      cards: [
        { id: "valid", kind: "image", image },
        { id: "bad-file", kind: "image", image: { ...image, file: "../outside.png" } },
        { id: "bad-mime", kind: "image", image: { ...image, mime: "image/svg+xml" } },
        { id: "bad-size", kind: "image", image: { ...image, size: -1 } },
        { id: "mismatched-type", kind: "image", image: { ...image, mime: "image/jpeg" } },
        { id: "bad-dimensions", kind: "image", image: { ...image, naturalHeight: 0 } },
      ],
    }]);

    expect(parsed?.[0].cards).toEqual([{ id: "valid", kind: "image", image }]);
    expect(parseTiers(JSON.parse(JSON.stringify(parsed)))?.[0].cards).toEqual(parsed?.[0].cards);
  });

  it("adds imported images in one Undo step, moves them between rows, and undoes both actions", () => {
    const [sourceRow, targetRow] = rowsForTierlist("tierlist");
    const images = [imageRef("a", "one.png"), imageRef("b", "two.png")];

    const cardIds = addImageTierCards("tierlist", sourceRow.id, images);
    expect(cardIds).toHaveLength(2);
    expect(history.entries.map(({ label }) => label)).toEqual(["Add image cards"]);
    expect(rowsForTierlist("tierlist")[0].cards).toEqual(images.map((image, index) => ({
      id: cardIds[index], kind: "image", image,
    })));

    moveTierlistCard("tierlist", sourceRow.id, cardIds[0], targetRow.id, 0);
    expect(history.entries).toHaveLength(2);
    expect(rowsForTierlist("tierlist")[0].cards).toHaveLength(1);
    expect(rowsForTierlist("tierlist")[1].cards[0]).toMatchObject({ kind: "image", image: images[0] });

    undo();
    expect(rowsForTierlist("tierlist")[0].cards).toHaveLength(2);
    expect(rowsForTierlist("tierlist")[1].cards).toEqual([]);
    undo();
    expect(rowsForTierlist("tierlist")[0].cards).toEqual([]);
    redo();
    expect(rowsForTierlist("tierlist")[0].cards).toHaveLength(2);
  });

  it("returns an image preview with the image name for card labels", () => {
    const image = imageRef("c", "Portrait.png");
    expect(tierCardPreview({ id: "image-card", kind: "image", image }, {})).toEqual({
      kind: "image",
      image,
      name: "Portrait.png",
    });
  });

  it("moves an image card to a List under its original name and supports Undo", () => {
    replaceBoard([createTierlist(), list]);
    clearHistory();
    const rowId = rowsForTierlist("tierlist")[0].id;
    const image = imageRef("d", "diagram.png");
    const [cardId] = addImageTierCards("tierlist", rowId, [image]);
    clearHistory();

    const command = createContentMoveCommand(
      { kind: "tierlist", noteId: "tierlist", rowId, cardId },
      { kind: "list", noteId: "list", index: 0 },
    );
    expect(command).not.toBeNull();
    if (!command) return;
    execute(command);

    expect(rowsForTierlist("tierlist")[0].cards).toEqual([]);
    expect(board.notes.list.listItems).toEqual([{ id: expect.any(String), targetId: null, label: "diagram.png" }]);
    expect(history.entries).toHaveLength(1);

    undo();
    expect(rowsForTierlist("tierlist")[0].cards).toEqual([{ id: cardId, kind: "image", image }]);
    expect(board.notes.list.listItems).toEqual([]);
  });
});
