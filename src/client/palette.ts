import { BLOCKS } from "../blocks";
import type { BlockInfo, Settings } from "../types";

export function selectBlocks(settings: Settings): BlockInfo[] {
  const blocks = BLOCKS.filter((block) => block.versions.includes(settings.mc_version));
  if (settings.palette_mode === "custom") {
    const byId = new Map(BLOCKS.map((block) => [block.id, block]));
    const selected = settings.custom_blocks
      .map((id) => byId.get(id))
      .filter((block): block is BlockInfo => !!block && block.versions.includes(settings.mc_version));
    return selected.length ? selected : blocks;
  }
  if (settings.palette_mode === "all") return blocks;
  if (settings.palette_mode === "map_art") return blocks.filter((block) => block.map_art);
  if (settings.palette_mode === "survival") return blocks.filter((block) => block.survival);
  return blocks.filter((block) => block.categories.includes(settings.palette_mode));
}
