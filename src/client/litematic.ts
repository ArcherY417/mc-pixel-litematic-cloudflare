import { compound, intArrayTag, intTag, listTag, longArrayTag, longTag, stringTag, writeGzippedNbt } from "./nbt";
import type { Settings } from "../types";

export const AIR_ID = "minecraft:air";

export type ConvertedArt = {
  blockGrid: string[][];
  heightGrid: number[][];
  previewPng: string;
  materials: Map<string, number>;
  airCount: number;
  width: number;
  height: number;
  depth: number;
};

export function schematicDimensions(art: ConvertedArt, settings: Settings): [number, number, number] {
  if (settings.build_plane === "wall") {
    if (settings.direction === "north" || settings.direction === "south") return [art.width, art.height, 1];
    return [1, art.height, art.width];
  }
  if (settings.direction === "east" || settings.direction === "west") return [art.height, art.depth, art.width];
  return [art.width, art.depth, art.height];
}

export function pixelToRegion(x: number, y: number, art: ConvertedArt, settings: Settings): [number, number, number] {
  const w = art.width;
  const h = art.height;
  const level = art.heightGrid[y][x];
  if (settings.build_plane === "wall") {
    const ry = h - 1 - y;
    if (settings.direction === "north") return [x, ry, 0];
    if (settings.direction === "south") return [w - 1 - x, ry, 0];
    if (settings.direction === "east") return [0, ry, x];
    return [0, ry, w - 1 - x];
  }

  const ry = settings.build_plane === "floor" ? level : art.depth - 1 - level;
  if (settings.direction === "north") return [x, ry, y];
  if (settings.direction === "south") return [w - 1 - x, ry, h - 1 - y];
  if (settings.direction === "east") return [y, ry, w - 1 - x];
  return [h - 1 - y, ry, x];
}

export function createLitematicBytes(art: ConvertedArt, settings: Settings): Uint8Array {
  const [sx, sy, sz] = schematicDimensions(art, settings);
  const palette = [AIR_ID];
  const paletteIndex = new Map([[AIR_ID, 0]]);
  const volume = sx * sy * sz;
  const blockIndices = new Array(volume).fill(0);

  for (let y = 0; y < art.blockGrid.length; y += 1) {
    for (let x = 0; x < art.blockGrid[y].length; x += 1) {
      const blockId = art.blockGrid[y][x];
      if (blockId === AIR_ID) continue;
      if (!paletteIndex.has(blockId)) {
        paletteIndex.set(blockId, palette.length);
        palette.push(blockId);
      }
      const [rx, ry, rz] = pixelToRegion(x, y, art, settings);
      blockIndices[ry * sx * sz + rz * sx + rx] = paletteIndex.get(blockId)!;
    }
  }

  const bits = Math.max(2, Math.ceil(Math.log2(Math.max(1, palette.length))));
  const blockStates = packBlockStates(blockIndices, bits);
  const now = BigInt(Date.now());
  const name = settings.name || "pixel-art";

  const root = compound("", [
    intTag("Version", 6),
    intTag("SubVersion", 1),
    intTag("MinecraftDataVersion", settings.mc_version === "1.21" ? 3953 : 3465),
    compound("Metadata", [
      compound("EnclosingSize", [intTag("x", sx), intTag("y", sy), intTag("z", sz)]),
      stringTag("Author", settings.author || "MC Pixel Litematic Studio"),
      stringTag(
        "Description",
        `Generated in browser. Mode=${settings.art_mode}, plane=${settings.build_plane}, direction=${settings.direction}.`
      ),
      stringTag("Name", name),
      stringTag("Software", "MC Pixel Litematic Studio JS"),
      intTag("RegionCount", 1),
      longTag("TimeCreated", now),
      longTag("TimeModified", now),
      intTag("TotalBlocks", [...art.materials.values()].reduce((sum, count) => sum + count, 0)),
      intTag("TotalVolume", volume),
      intArrayTag("PreviewImageData", [])
    ]),
    compound("Regions", [
      compound(name, [
        compound("Position", [intTag("x", 0), intTag("y", 0), intTag("z", 0)]),
        compound("Size", [intTag("x", sx), intTag("y", sy), intTag("z", sz)]),
        listTag(
          "BlockStatePalette",
          10,
          palette.map((blockId) => compound("", [stringTag("Name", blockId)]))
        ),
        listTag("Entities", 10, []),
        listTag("TileEntities", 10, []),
        listTag("PendingBlockTicks", 10, []),
        listTag("PendingFluidTicks", 10, []),
        longArrayTag("BlockStates", blockStates)
      ])
    ])
  ]);

  return writeGzippedNbt(root);
}

export function packBlockStates(indices: number[], bits: number): bigint[] {
  const totalBits = indices.length * bits;
  const longs = new Array(Math.ceil(totalBits / 64)).fill(0n);
  const mask = (1n << BigInt(bits)) - 1n;
  indices.forEach((index, i) => {
    let value = BigInt(index) & mask;
    let bitOffset = i * bits;
    let longIndex = Math.floor(bitOffset / 64);
    let localOffset = bitOffset % 64;
    longs[longIndex] |= value << BigInt(localOffset);
    const spill = localOffset + bits - 64;
    if (spill > 0) {
      value >>= BigInt(bits - spill);
      longs[longIndex + 1] |= value;
    }
  });
  return longs;
}
