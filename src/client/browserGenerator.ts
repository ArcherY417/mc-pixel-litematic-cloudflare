import { BLOCK_BY_ID } from "../blocks";
import type { BlockInfo, ConvertResponse, MaterialItem, Settings } from "../types";
import { selectBlocks } from "./palette";
import { AIR_ID, type ConvertedArt, createLitematicBytes } from "./litematic";

type Lab = [number, number, number];
type Hsl = [number, number, number];
type MatchResult = { index: number; distance: number };

const DITHER_STRENGTH = 0.34;
const DITHER_ERROR_LIMIT = 42;
const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((value) => (value + 0.5) / 16);

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
  if (!ctx) throw new Error("Browser does not support Canvas 2D.");
  drawFitted(ctx, bitmap, width, height, settings.fit_mode);
  const source = ctx.getImageData(0, 0, width, height);
  const blocks = selectBlocks(settings);
  if (!blocks.length) throw new Error("No blocks are available for the selected palette.");
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
  const scale =
    fitMode === "cover"
      ? Math.max(width / bitmap.width, height / bitmap.height)
      : Math.min(width / bitmap.width, height / bitmap.height);
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
  const paletteHsl = blocks.map((block) => rgbToHsl(block.rgb));
  const blockGrid: string[][] = [];
  const heightGrid: number[][] = [];
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
      const match = nearestBlock(color, paletteRgb, paletteLab, paletteHsl, settings.quality, x, y);
      const selected = settings.replacements[blocks[match.index].id] || blocks[match.index].id;
      blockRow.push(selected);
      heightRow.push(settings.art_mode === "map" && settings.map_variant === "stairs" ? Math.round(luminance(color) / 255 * 3) : 0);

      if (settings.quality === "high" && shouldDiffuse(color, match.distance)) {
        diffuseError(work, width, height, x, y, blocks[match.index].rgb);
      }
    }
    blockGrid.push(blockRow);
    heightGrid.push(heightRow);
  }

  const cleanedGrid = settings.quality === "high" ? despeckleGrid(blockGrid) : blockGrid;
  return { blockGrid: cleanedGrid, heightGrid, materials: recountMaterials(cleanedGrid), airCount };
}

function nearestBlock(
  color: [number, number, number],
  paletteRgb: [number, number, number][],
  paletteLab: Lab[],
  paletteHsl: Hsl[],
  quality: Settings["quality"],
  x: number,
  y: number
): MatchResult {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const colorLab = quality === "fast" ? null : rgbToLab(color);
  const colorHsl = quality === "fast" ? null : rgbToHsl(color);
  for (let i = 0; i < paletteRgb.length; i += 1) {
    const distance =
      quality === "fast"
        ? weightedRgbDistance(color, paletteRgb[i])
        : hueAwareLabDistance(colorHsl!, paletteHsl[i], squaredDistance(colorLab!, paletteLab[i]));
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  if (quality === "high" && colorHsl) {
    best = pastelLightenIndex(colorHsl, best, paletteHsl, x, y);
    best = pastelTintIndex(color, colorHsl, best, paletteHsl, x, y);
  }
  return { index: best, distance: Math.sqrt(bestDistance) };
}

function pastelLightenIndex(sourceHsl: Hsl, best: number, paletteHsl: Hsl[], x: number, y: number) {
  const bestHsl = paletteHsl[best];
  const lightnessGap = sourceHsl[2] - bestHsl[2];
  if (sourceHsl[2] < 0.62 || lightnessGap < 0.04) return best;
  const warmPastel = (sourceHsl[0] <= 52 || sourceHsl[0] >= 350) && sourceHsl[2] > 0.64;

  let neutral = -1;
  let neutralScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < paletteHsl.length; i += 1) {
    const candidate = paletteHsl[i];
    if (candidate[1] > 0.09 || candidate[2] <= bestHsl[2] + 0.05) continue;
    const score = Math.abs(candidate[2] - sourceHsl[2]) * 100 + candidate[1] * 30;
    if (score < neutralScore) {
      neutral = i;
      neutralScore = score;
    }
  }
  if (neutral < 0) return best;
  if (warmPastel) return sourceHsl[2] > 0.79 ? neutral : best;

  const neutralHsl = paletteHsl[neutral];
  const denominator = Math.max(0.001, neutralHsl[2] - bestHsl[2]);
  const amount = clamp01(lightnessGap / denominator) * (sourceHsl[1] > 0.45 ? 0.58 : 0.72);
  const threshold = BAYER_4X4[((y + 1) % 4) * 4 + ((x + 2) % 4)];
  return amount > threshold ? neutral : best;
}

function pastelTintIndex(
  color: [number, number, number],
  sourceHsl: Hsl,
  best: number,
  paletteHsl: Hsl[],
  x: number,
  y: number
) {
  const chroma = Math.max(color[0], color[1], color[2]) - Math.min(color[0], color[1], color[2]);
  if (chroma < 14 || sourceHsl[1] < 0.08 || sourceHsl[2] < 0.48) return best;
  if ((sourceHsl[0] <= 52 || sourceHsl[0] >= 350) && sourceHsl[2] > 0.55) return best;

  const bestHsl = paletteHsl[best];
  if (bestHsl[1] >= 0.09 && hueDistance(sourceHsl[0], bestHsl[0]) < 54) return best;

  let tint = -1;
  let tintScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < paletteHsl.length; i += 1) {
    const candidate = paletteHsl[i];
    if (candidate[1] < 0.12) continue;
    const hueDiff = hueDistance(sourceHsl[0], candidate[0]);
    if (hueDiff > 50) continue;
    const lightnessGap = Math.abs(sourceHsl[2] - candidate[2]);
    const score = hueDiff * 2.4 + lightnessGap * 120 - candidate[1] * 18;
    if (score < tintScore) {
      tint = i;
      tintScore = score;
    }
  }
  if (tint < 0) return best;

  const tintHsl = paletteHsl[tint];
  const lightnessGap = Math.abs(sourceHsl[2] - tintHsl[2]);
  const neutralBase = bestHsl[1] < 0.09;
  const baseAmount =
    clamp01((chroma - 12) / 86) *
    clamp01((sourceHsl[2] - 0.45) / 0.5) *
    clamp01(1 - Math.max(0, lightnessGap - 0.14) / 0.5) *
    0.58;
  const minimumPastelTint =
    neutralBase && sourceHsl[2] > 0.68 ? clamp01((chroma - 16) / 70) * 0.62 : 0;
  const amount = Math.max(baseAmount, minimumPastelTint);
  const threshold = BAYER_4X4[(y % 4) * 4 + (x % 4)];
  return amount > threshold ? tint : best;
}

function shouldDiffuse(color: [number, number, number], labDistance: number) {
  const lum = luminance(color);
  const chroma = Math.max(color[0], color[1], color[2]) - Math.min(color[0], color[1], color[2]);
  if (lum > 205 && chroma < 42) return false;
  if (labDistance < 9 || labDistance > 46) return false;
  return true;
}

function diffuseError(work: Float64Array, width: number, height: number, x: number, y: number, chosen: [number, number, number]) {
  const idx = (y * width + x) * 3;
  const error: [number, number, number] = [
    clampError(work[idx] - chosen[0]),
    clampError(work[idx + 1] - chosen[1]),
    clampError(work[idx + 2] - chosen[2])
  ];
  addError(work, width, height, x + 1, y, error, 7 / 16);
  addError(work, width, height, x - 1, y + 1, error, 3 / 16);
  addError(work, width, height, x, y + 1, error, 5 / 16);
  addError(work, width, height, x + 1, y + 1, error, 1 / 16);
}

function addError(work: Float64Array, width: number, height: number, x: number, y: number, error: [number, number, number], factor: number) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const idx = (y * width + x) * 3;
  work[idx] += error[0] * factor * DITHER_STRENGTH;
  work[idx + 1] += error[1] * factor * DITHER_STRENGTH;
  work[idx + 2] += error[2] * factor * DITHER_STRENGTH;
}

function renderPreview(blockGrid: string[][], showGrid: boolean) {
  const width = blockGrid[0]?.length || 1;
  const height = blockGrid.length || 1;
  const factor = Math.max(1, Math.min(Math.floor(768 / Math.max(width, height)), 12));
  const canvas = document.createElement("canvas");
  canvas.width = width * factor;
  canvas.height = height * factor;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser does not support Canvas 2D.");
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

function clampError(value: number) {
  return Math.max(-DITHER_ERROR_LIMIT, Math.min(DITHER_ERROR_LIMIT, value));
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

function hueAwareLabDistance(sourceHsl: Hsl, candidateHsl: Hsl, labSquared: number) {
  const sourceS = sourceHsl[1];
  const sourceL = sourceHsl[2];
  const candidateS = candidateHsl[1];
  if (sourceS < 0.045) return labSquared;

  const hueDiff = hueDistance(sourceHsl[0], candidateHsl[0]);
  const colorIntent = clamp01((sourceS - 0.045) / 0.22) * (sourceL > 0.55 ? 1.18 : 1);
  const candidateIsNeutral = candidateS < 0.075;
  const candidateHasColor = candidateS > 0.08;
  const nearHue = clamp01(1 - hueDiff / 48);
  const farHue = clamp01((hueDiff - 58) / 92);

  let penalty = (hueDiff / 180) ** 2 * (220 + 300 * colorIntent);
  if (candidateIsNeutral) penalty += (sourceL > 0.55 ? 260 : 150) * colorIntent;
  if (candidateHasColor) penalty -= nearHue * (190 + 160 * colorIntent) * colorIntent;
  if (candidateHasColor) penalty += farHue * 260 * colorIntent;
  return Math.max(0, labSquared + penalty);
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function hueDistance(a: number, b: number) {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

function rgbToHsl(rgb: [number, number, number]): Hsl {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return [hue * 60, saturation, lightness];
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

function despeckleGrid(grid: string[][]) {
  const height = grid.length;
  const width = grid[0]?.length || 0;
  const output = grid.map((row) => [...row]);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const current = grid[y][x];
      if (current === AIR_ID) continue;
      const counts = new Map<string, number>();
      for (let yy = y - 1; yy <= y + 1; yy += 1) {
        for (let xx = x - 1; xx <= x + 1; xx += 1) {
          if (xx === x && yy === y) continue;
          if (yy < 0 || yy >= height || xx < 0 || xx >= width) continue;
          const neighbor = grid[yy][xx];
          if (neighbor === AIR_ID) continue;
          counts.set(neighbor, (counts.get(neighbor) || 0) + 1);
        }
      }
      let majority = current;
      let majorityCount = 0;
      for (const [blockId, count] of counts.entries()) {
        if (count > majorityCount) {
          majority = blockId;
          majorityCount = count;
        }
      }
      if (majority === current || majorityCount < 5) continue;
      if (isProtectedDarkLine(current, majority)) continue;
      output[y][x] = majority;
    }
  }
  return output;
}

function isProtectedDarkLine(currentId: string, replacementId: string) {
  const current = BLOCK_BY_ID.get(currentId);
  const replacement = BLOCK_BY_ID.get(replacementId);
  if (!current || !replacement) return false;
  return luminance(current.rgb) < 80 && luminance(replacement.rgb) > 125;
}

function recountMaterials(grid: string[][]) {
  const materials = new Map<string, number>();
  for (const row of grid) {
    for (const blockId of row) {
      if (blockId === AIR_ID) continue;
      materials.set(blockId, (materials.get(blockId) || 0) + 1);
    }
  }
  return materials;
}
