import type { BlockInfo, Settings } from "../types";

export type MapShade = 0 | 1 | 2;

export type MapColorCandidate = {
  blockId: string;
  baseBlockId: string;
  mapRgb: [number, number, number];
  blockRgb: [number, number, number];
  shade: MapShade;
  isWater: boolean;
  waterDepth: number;
};

const SHADE_MULTIPLIERS: Record<MapShade, number> = {
  0: 180,
  1: 220,
  2: 255
};

const WATER_DEPTH: Record<MapShade, number> = {
  0: 10,
  1: 5,
  2: 1
};

const MAP_BASES = [
  ["minecraft:grass_block", [127, 178, 56]],
  ["minecraft:smooth_sandstone", [247, 233, 163]],
  ["minecraft:mushroom_stem", [199, 199, 199]],
  ["minecraft:red_concrete", [255, 0, 0]],
  ["minecraft:ice", [160, 160, 255]],
  ["minecraft:iron_block", [167, 167, 167]],
  ["minecraft:oak_planks", [143, 119, 72]],
  ["minecraft:white_wool", [255, 255, 255]],
  ["minecraft:orange_wool", [216, 127, 51]],
  ["minecraft:magenta_wool", [178, 76, 216]],
  ["minecraft:light_blue_wool", [102, 153, 216]],
  ["minecraft:yellow_wool", [229, 229, 51]],
  ["minecraft:lime_wool", [127, 204, 25]],
  ["minecraft:pink_wool", [242, 127, 165]],
  ["minecraft:gray_wool", [76, 76, 76]],
  ["minecraft:light_gray_wool", [153, 153, 153]],
  ["minecraft:cyan_wool", [76, 127, 153]],
  ["minecraft:purple_wool", [127, 63, 178]],
  ["minecraft:blue_wool", [51, 76, 178]],
  ["minecraft:brown_wool", [102, 76, 51]],
  ["minecraft:green_wool", [102, 127, 51]],
  ["minecraft:red_wool", [153, 51, 51]],
  ["minecraft:black_wool", [25, 25, 25]],
  ["minecraft:gold_block", [250, 238, 77]],
  ["minecraft:diamond_block", [92, 219, 213]],
  ["minecraft:lapis_block", [74, 128, 255]],
  ["minecraft:emerald_block", [0, 217, 58]],
  ["minecraft:podzol", [129, 86, 49]],
  ["minecraft:netherrack", [112, 2, 0]],
  ["minecraft:snow_block", [255, 252, 245]],
  ["minecraft:white_terracotta", [209, 177, 161]],
  ["minecraft:orange_terracotta", [159, 82, 36]],
  ["minecraft:magenta_terracotta", [149, 87, 108]],
  ["minecraft:light_blue_terracotta", [112, 108, 138]],
  ["minecraft:yellow_terracotta", [186, 133, 36]],
  ["minecraft:lime_terracotta", [103, 117, 53]],
  ["minecraft:pink_terracotta", [160, 77, 78]],
  ["minecraft:gray_terracotta", [57, 41, 35]],
  ["minecraft:light_gray_terracotta", [135, 107, 98]],
  ["minecraft:cyan_terracotta", [87, 92, 92]],
  ["minecraft:purple_terracotta", [122, 73, 88]],
  ["minecraft:blue_terracotta", [76, 62, 92]],
  ["minecraft:brown_terracotta", [76, 50, 35]],
  ["minecraft:green_terracotta", [76, 82, 42]],
  ["minecraft:red_terracotta", [142, 60, 46]],
  ["minecraft:black_terracotta", [37, 22, 16]],
  ["minecraft:quartz_block", [255, 250, 250]],
  ["minecraft:prismarine", [99, 156, 151]],
  ["minecraft:warped_wart_block", [22, 126, 134]],
  ["minecraft:deepslate", [100, 100, 100]]
] as const;

const WATER_BASE: [number, number, number] = [64, 64, 255];

export const MAP_ART_BLOCK_IDS = new Set([
  ...MAP_BASES.map(([blockId]) => blockId),
  "minecraft:water"
]);

export function createMapPalette(blocks: BlockInfo[], variant: Settings["map_variant"]): MapColorCandidate[] {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const shades: MapShade[] = variant === "stairs" ? [0, 1, 2] : [1];
  const candidates: MapColorCandidate[] = [];
  for (const [blockId, baseRgb] of MAP_BASES) {
    const block = byId.get(blockId);
    if (!block) continue;
    for (const shade of shades) {
      candidates.push({
        blockId,
        baseBlockId: blockId,
        mapRgb: shadeRgb(baseRgb, shade),
        blockRgb: block.rgb,
        shade,
        isWater: false,
        waterDepth: 0
      });
    }
  }
  if (byId.has("minecraft:water")) {
    for (const shade of shades) {
      candidates.push({
        blockId: "minecraft:water[level=0]",
        baseBlockId: "minecraft:water",
        mapRgb: shadeRgb(WATER_BASE, shade),
        blockRgb: WATER_BASE,
        shade,
        isWater: true,
        waterDepth: WATER_DEPTH[shade]
      });
    }
  }
  return candidates;
}

function shadeRgb(rgb: readonly [number, number, number], shade: MapShade): [number, number, number] {
  const multiplier = SHADE_MULTIPLIERS[shade];
  return [
    Math.floor((rgb[0] * multiplier) / 255),
    Math.floor((rgb[1] * multiplier) / 255),
    Math.floor((rgb[2] * multiplier) / 255)
  ];
}
