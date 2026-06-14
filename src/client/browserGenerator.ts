import { BLOCK_BY_ID } from "../blocks";
import type { BlockInfo, ConvertResponse, MaterialItem, Settings } from "../types";
import { selectBlocks } from "./palette";
import { AIR_ID, type ConvertedArt, createLitematicBytes } from "./litematic";

type Lab = [number, number, number];

export async function convertInBrowser(file: File, settings: Settings): Promise<ConvertResponse> {
  const art = await convertImage(file, settings);
  const litematic = createLitematicBytes(art, settings);
  const resultId = crypto.randomUUID();
  const materials = materialItems(art.materials);
  const safe = safeFilename(settings.name || "pixel-art");
  return {
    result_id: resultId,
    width: art.width,
    height: art.height,
    depth: art.depth,
    block_count: [...art.materials.values()].reduce((sum, count) => sum + count, 0),
    air_count: art.airCount,
    preview_png: art.previewPng,
    materials,
    downloads: {
      litematic: objectUrl(litematic, "application/octet-stream"),
      preview_png: art.previewPng,
      materials_csv: objectUrl(materialCsv(art.materials), "text/csv;charset=utf-8"),
      materials_json: objectUrl(JSON.stringify(materials, null, 2), "application/json;charset=utf-8"),
      [`filename:${safe}.litematic`]: ""
    }
  };
}

async function convertImage(file: File, settings: Settings): Promise<ConvertedArt> {
  const bitmap = await createImageBitmap(file);
  const [width, height] = outputSize(settings, bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("浏览器不支持 Canvas 2D。");
  drawFitted(ctx, bitmap, width, height, settings.fit_mode);
  const source = ctx.getImageData(0, 0, width, height);
  const blocks = selectBlocks(settings);
  if (!blocks.length) throw new Error("当前方块筛选没有可用方块。");
  const matched = matchPixels(source.data, width, height, blocks, settings);
  const previewPng = renderPreview(matched.blockGrid, settings.show_grid);
  const depth = Math.max(1, ...matched.heightGrid.flat()) + 1;
  return { ...matched, previewPng, width, height, depth };
}

function outputSize(settings: Settings, sourceWidth: number, sourceHeight: number): [number, number] {
  if (settings.art_mode === "map") return [settings.map_columns * 128, settings.map_rows * 128];
  if (!settings.lock_aspect) return [settings.target_width, settings.target_height];
  return [settings.target_width, Math.max(1, Math.round(settings.target_width * (sourceHeight / sourceWidth)))];
}

function drawFitted(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  width: number,
  height: number,
  fitMode: Settings["fit_mode"]
) {
  ctx.clearRect(0, 0, width, height);
  if (fitMode === "stretch") {
    ctx.drawImage(bitmap, 0, 0, width, height);
    return;
  }
  const scale = fitMode === "cover" ? Math.max(width / bitmap.width, height / bitmap.height) : Math.min(width / bitmap.width, height / bitmap.height);
  const sw = bitmap.width * scale;
  const sh = bitmap.height * scale;
  ctx.drawImage(bitmap, (width - sw) / 2, (height - sh) / 2, sw, sh);
}

function matchPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  blocks: BlockInfo[],
  settings: Settings
): Omit<ConvertedArt, "previewPng" | "width" | "height" | "depth"> {
  const work = new Float64Array(width * height * 3);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    work[p] = data[i];
    work[p + 1] = data[i + 1];
    work[p + 2] = data[i + 2];
  }
  const paletteRgb = blocks.map((block) => block.rgb);
  const paletteLab = blocks.map((block) => rgbToLab(block.rgb));
  const blockGrid: string[][] = [];
  const heightGrid: number[][] = [];
  const materials = new Map<string, number>();
  let airCount = 0;

  for (let y = 0; y < height; y += 1) {
    const blockRow: string[] = [];
    const heightRow: number[] = [];
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const idx = (y * width + x) * 3;
      const alpha = data[src + 3];
      if (alpha < 8 && settings.transparent_mode === "air") {
        blockRow.push(AIR_ID);
        heightRow.push(0);
        airCount += 1;
        continue;
      }
      if (alpha < 8 && settings.transparent_mode === "white") setWork(work, idx, [255, 255, 255]);
      if (alpha < 8 && settings.transparent_mode === "black") setWork(work, idx, [0, 0, 0]);
      const color: [number, number, number] = [clamp(work[idx]), clamp(work[idx + 1]), clamp(work[idx + 2])];
      const blockIndex = nearestBlock(color, paletteRgb, paletteLab, settings.quality);
      const selected = settings.replacements[blocks[blockIndex].id] || blocks[blockIndex].id;
      blockRow.push(selected);
      materials.set(selected, (materials.get(selected) || 0) + 1);
      heightRow.push(settings.art_mode === "map" && settings.map_variant === "stairs" ? Math.round(luminance(color) / 255 * 3) : 0);
      if (settings.quality === "high") diffuseError(work, width, height, x, y, blocks[blockIndex].rgb);
    }
    blockGrid.push(blockRow);
    heightGrid.push(heightRow);
  }
  return { blockGrid, heightGrid, materials, airCount };
}

function nearestBlock(color: [number, number, number], paletteRgb: [number, number, number][], paletteLab: Lab[], quality: Settings["quality"]) {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const colorLab = quality === "fast" ? null : rgbToLab(color);
  for (let i = 0; i < paletteRgb.length; i += 1) {
    const distance =
      quality === "fast"
        ? weightedRgbDistance(color, paletteRgb[i])
        : squaredDistance(colorLab!, paletteLab[i]);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

function diffuseError(work: Float64Array, width: number, height: number, x: number, y: number, chosen: [number, number, number]) {
  const idx = (y * width + x) * 3;
  const error: [number, number, number] = [work[idx] - chosen[0], work[idx + 1] - chosen[1], work[idx + 2] - chosen[2]];
  addError(work, width, height, x + 1, y, error, 7 / 16);
  addError(work, width, height, x - 1, y + 1, error, 3 / 16);
  addError(work, width, height, x, y + 1, error, 5 / 16);
  addError(work, width, height, x + 1, y + 1, error, 1 / 16);
}

function addError(work: Float64Array, width: number, height: number, x: number, y: number, error: [number, number, number], factor: number) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const idx = (y * width + x) * 3;
  work[idx] += error[0] * factor;
  work[idx + 1] += error[1] * factor;
  work[idx + 2] += error[2] * factor;
}

function renderPreview(blockGrid: string[][], showGrid: boolean) {
  const width = blockGrid[0]?.length || 1;
  const height = blockGrid.length || 1;
  const factor = Math.max(1, Math.min(Math.floor(768 / Math.max(width, height)), 12));
  const canvas = document.createElement("canvas");
  canvas.width = width * factor;
  canvas.height = height * factor;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 Canvas 2D。");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const block = BLOCK_BY_ID.get(blockGrid[y][x]);
      if (!block) continue;
      ctx.fillStyle = `rgb(${block.rgb[0]}, ${block.rgb[1]}, ${block.rgb[2]})`;
      ctx.fillRect(x * factor, y * factor, factor, factor);
    }
  }
  if (showGrid && factor >= 6) {
    ctx.strokeStyle = "rgba(20, 24, 28, 0.28)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += factor) line(ctx, x, 0, x, canvas.height);
    for (let y = 0; y <= canvas.height; y += factor) line(ctx, 0, y, canvas.width, y);
  }
  return canvas.toDataURL("image/png");
}

function materialItems(materials: Map<string, number>): MaterialItem[] {
  return [...materials.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => {
      const block = BLOCK_BY_ID.get(id);
      return { id, count, name: block?.name || id, rgb: block?.rgb || [0, 0, 0] };
    });
}

function materialCsv(materials: Map<string, number>) {
  return `block_id,count\n${[...materials.entries()].sort((a, b) => b[1] - a[1]).map(([id, count]) => `${id},${count}`).join("\n")}\n`;
}

function objectUrl(data: Uint8Array | string, type: string) {
  const blobPart = typeof data === "string" ? data : new Uint8Array(data).buffer;
  return URL.createObjectURL(new Blob([blobPart], { type }));
}

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "pixel-art";
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function setWork(work: Float64Array, idx: number, color: [number, number, number]) {
  work[idx] = color[0];
  work[idx + 1] = color[1];
  work[idx + 2] = color[2];
}

function clamp(value: number) {
  return Math.max(0, Math.min(255, value));
}

function luminance(color: [number, number, number]) {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function weightedRgbDistance(a: [number, number, number], b: [number, number, number]) {
  return (a[0] - b[0]) ** 2 * 0.3 + (a[1] - b[1]) ** 2 * 0.59 + (a[2] - b[2]) ** 2 * 0.11;
}

function squaredDistance(a: Lab, b: Lab) {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function rgbToLab(rgb: [number, number, number]): Lab {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value > 0.04045 ? ((value + 0.055) / 1.055) ** 2.4 : value / 12.92;
  });
  let x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  let y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  let z = r * 0.0193339 + g * 0.119192 + b * 0.9503041;
  x /= 0.95047;
  z /= 1.08883;
  const fx = labPivot(x);
  const fy = labPivot(y);
  const fz = labPivot(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labPivot(value: number) {
  const delta = 6 / 29;
  return value > delta ** 3 ? Math.cbrt(value) : value / (3 * delta ** 2) + 4 / 29;
}
