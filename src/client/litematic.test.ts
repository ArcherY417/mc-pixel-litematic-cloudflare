import { describe, expect, it } from "vitest";
import { gunzipSync } from "fflate";
import { createLitematicBytes, packBlockStates, pixelToRegion, schematicDimensions, type ConvertedArt } from "./litematic";
import type { Settings } from "../types";
import { BLOCKS } from "../blocks";
import { createMapPalette, MAP_ART_BLOCK_IDS } from "./mapPalette";

const settings: Settings = {
  name: "test",
  author: "test",
  mc_version: "1.21",
  art_mode: "pixel",
  target_width: 2,
  target_height: 2,
  lock_aspect: false,
  fit_mode: "contain",
  quality: "standard",
  transparent_mode: "air",
  palette_mode: "all",
  palette_modes: ["all"],
  custom_blocks: [],
  replacements: {},
  build_plane: "wall",
  direction: "south",
  map_columns: 1,
  map_rows: 1,
  map_variant: "flat",
  map_preview: "map",
  show_grid: true
};

const art: ConvertedArt = {
  width: 2,
  height: 2,
  depth: 1,
  blockGrid: [
    ["minecraft:white_wool", "minecraft:black_wool"],
    ["minecraft:red_wool", "minecraft:blue_wool"]
  ],
  heightGrid: [
    [0, 0],
    [0, 0]
  ],
  previewPng: "",
  materials: new Map(),
  airCount: 0
};

describe("browser litematic writer helpers", () => {
  it("packs block states using litematic bit order", () => {
    expect(packBlockStates([1, 2], 2)).toEqual([9n]);
  });

  it("maps wall coordinates by direction", () => {
    expect(schematicDimensions(art, settings)).toEqual([2, 2, 1]);
    expect(pixelToRegion(0, 0, art, settings)).toEqual([1, 1, 0]);
    expect(pixelToRegion(1, 1, art, settings)).toEqual([0, 0, 0]);
  });

  it("swaps horizontal dimensions for east and west", () => {
    const floor = { ...settings, build_plane: "floor" as const, direction: "east" as const };
    const wide = { ...art, width: 3, height: 2 };
    expect(schematicDimensions(wide, floor)).toEqual([2, 1, 3]);
  });

  it("writes a gzipped litematic-shaped NBT payload", () => {
    const bytes = createLitematicBytes({ ...art, materials: new Map([["minecraft:white_wool", 4]]) }, settings);
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);
    const nbt = new TextDecoder().decode(gunzipSync(bytes));
    expect(nbt).toContain("MinecraftDataVersion");
    expect(nbt).toContain("BlockStatePalette");
    expect(nbt).toContain("minecraft:white_wool");
  });

  it("uses flat and staircase map-art shade sets", () => {
    const flat = createMapPalette(BLOCKS, "flat");
    const stairs = createMapPalette(BLOCKS, "stairs");
    expect(new Set(flat.map((candidate) => candidate.shade))).toEqual(new Set([1]));
    expect(new Set(stairs.map((candidate) => candidate.shade))).toEqual(new Set([0, 1, 2]));
    expect(flat).toHaveLength(51);
    expect(stairs).toHaveLength(153);
    expect(stairs.find((candidate) => candidate.isWater && candidate.shade === 0)?.waterDepth).toBe(10);
    expect(stairs.find((candidate) => candidate.isWater && candidate.shade === 1)?.waterDepth).toBe(5);
    expect(stairs.find((candidate) => candidate.isWater && candidate.shade === 2)?.waterDepth).toBe(1);
  });

  it("keeps every map-art base color backed by a selectable block", () => {
    const blockIds = new Set(BLOCKS.map((block) => block.id));
    expect([...MAP_ART_BLOCK_IDS].filter((blockId) => !blockIds.has(blockId))).toEqual([]);
  });

  it("writes block state properties for water placements", () => {
    const waterArt: ConvertedArt = {
      ...art,
      width: 1,
      height: 1,
      depth: 2,
      blockGrid: [["minecraft:water[level=0]"]],
      heightGrid: [[1]],
      placements: [
        { x: 0, y: 0, level: 0, blockId: "minecraft:stone" },
        { x: 0, y: 0, level: 1, blockId: "minecraft:water[level=0]" }
      ],
      materials: new Map([["minecraft:water[level=0]", 1]])
    };
    const bytes = createLitematicBytes(waterArt, { ...settings, art_mode: "map", build_plane: "floor" });
    const nbt = new TextDecoder().decode(gunzipSync(bytes));
    expect(nbt).toContain("minecraft:water");
    expect(nbt).toContain("Properties");
    expect(nbt).toContain("level");
  });
});
