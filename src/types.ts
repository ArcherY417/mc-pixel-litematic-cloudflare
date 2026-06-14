export type BlockInfo = {
  id: string;
  name: string;
  rgb: [number, number, number];
  categories: string[];
  versions: string[];
  map_art: boolean;
  survival: boolean;
};

export type MaterialItem = {
  id: string;
  name: string;
  count: number;
  rgb: [number, number, number];
};

export type ConvertResponse = {
  result_id: string;
  width: number;
  height: number;
  depth: number;
  block_count: number;
  air_count: number;
  preview_png: string;
  materials: MaterialItem[];
  downloads: Record<string, string>;
};

export type RunMode = "auto" | "browser" | "server";

export type Settings = {
  name: string;
  author: string;
  mc_version: "1.20.1" | "1.21";
  art_mode: "pixel" | "map";
  target_width: number;
  target_height: number;
  lock_aspect: boolean;
  fit_mode: "stretch" | "contain" | "cover";
  quality: "fast" | "standard" | "high";
  transparent_mode: "air" | "white" | "black";
  palette_mode: "all" | "wool" | "concrete" | "terracotta" | "map_art" | "survival" | "custom";
  custom_blocks: string[];
  replacements: Record<string, string>;
  build_plane: "wall" | "floor" | "ceiling";
  direction: "north" | "south" | "east" | "west";
  map_columns: number;
  map_rows: number;
  map_variant: "flat" | "stairs";
  show_grid: boolean;
};
