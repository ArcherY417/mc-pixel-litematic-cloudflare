import { BLOCKS } from "../blocks";
import type { BlockInfo, Settings } from "../types";

const PIXEL_ART_BLOCKS = new Set([
  "minecraft:white_wool",
  "minecraft:white_concrete",
  "minecraft:white_terracotta",
  "minecraft:light_gray_wool",
  "minecraft:pink_wool",
  "minecraft:pink_concrete",
  "minecraft:light_blue_wool",
  "minecraft:cyan_wool",
  "minecraft:lime_wool",
  "minecraft:lime_concrete",
  "minecraft:lime_terracotta",
  "minecraft:quartz_block",
  "minecraft:calcite",
  "minecraft:bone_block",
  "minecraft:mushroom_stem",
  "minecraft:end_stone",
  "minecraft:smooth_sandstone",
  "minecraft:snow_block",
  "minecraft:sea_lantern",
  "minecraft:verdant_froglight",
  "minecraft:pearlescent_froglight",
  "minecraft:ochre_froglight",
  "minecraft:prismarine",
  "minecraft:cherry_planks"
]);

export function selectBlocks(settings: Settings): BlockInfo[] {
  const blocks = BLOCKS.filter((block) => block.versions.includes(settings.mc_version));
  const modes = settings.palette_modes?.length ? settings.palette_modes : [settings.palette_mode];
  if (modes.includes("custom")) {
    const byId = new Map(BLOCKS.map((block) => [block.id, block]));
    const selected = settings.custom_blocks
      .map((id) => byId.get(id))
      .filter((block): block is BlockInfo => !!block && block.versions.includes(settings.mc_version));
    return selected.length ? selected : blocks;
  }
  if (modes.includes("all")) return blocks;
  return blocks.filter((block) => blockMatchesPalette(block, modes));
}

export function blockMatchesPalette(block: BlockInfo, modes: Settings["palette_modes"]) {
  return modes.some((mode) => {
    if (mode === "all") return true;
    if (mode === "pixel_art") return PIXEL_ART_BLOCKS.has(block.id);
    if (mode === "map_art") return block.map_art;
    if (mode === "survival") return block.survival;
    if (mode === "custom") return true;
    return block.categories.includes(mode);
  });
}
