import { BLOCKS } from "../blocks";
import type { BlockInfo, Settings } from "../types";

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
    if (mode === "map_art") return block.map_art;
    if (mode === "survival") return block.survival;
    if (mode === "custom") return true;
    return block.categories.includes(mode);
  });
}
