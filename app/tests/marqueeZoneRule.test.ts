import { describe, expect, it } from "vitest";
import { zonesSelectedByMarquee } from "../src/selection/hitTesting";
import { rectContour, type Zone } from "../src/model/zone";

const zone: Zone = { id: "z", name: "Zone", color: "#608ac1", parts: [rectContour(0, 0, 100, 100)], holes: [], createdAt: 1 };
const zones = { z: zone };
const members = () => ["a", "b"];

describe("marquee selects a zone only with all its objects and >= 60 % of its area", () => {
  it("selects the zone when every member is selected and 64 % is covered", () => {
    expect(zonesSelectedByMarquee({ x: -5, y: -5, width: 85, height: 85 }, zones, ["z"], members, ["a", "b"])).toEqual(["z"]);
  });
  it("keeps the zone out when a member is missing", () => {
    expect(zonesSelectedByMarquee({ x: -5, y: -5, width: 110, height: 110 }, zones, ["z"], members, ["a"])).toEqual([]);
  });
  it("keeps the zone out when less than 60 % is covered", () => {
    expect(zonesSelectedByMarquee({ x: 0, y: 0, width: 70, height: 80 }, zones, ["z"], members, ["a", "b"])).toEqual([]);
  });
  it("ignores members that are not marquee targets (ME)", () => {
    expect(zonesSelectedByMarquee({ x: 0, y: 0, width: 100, height: 100 }, zones, ["z"], () => ["a", "me"], ["a"], (id) => id !== "me")).toEqual(["z"]);
  });
  it("an empty zone follows the area rule alone", () => {
    expect(zonesSelectedByMarquee({ x: 0, y: 0, width: 100, height: 61 }, zones, ["z"], () => [], [])).toEqual(["z"]);
  });
});
