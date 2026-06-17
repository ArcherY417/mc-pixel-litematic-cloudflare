import { BLOCK_BY_ID } from "../blocks";
import type { BlockInfo, ConvertResponse, MaterialItem, Settings } from "../types";
import { selectBlocks } from "./palette";
import { createMapPalette, type MapColorCandidate } from "./mapPalette";
import { AIR_ID, type BlockPlacement, type ConvertedArt, createLitematicBytes } from "./litematic";

type Lab = [number, number, number];
type Hsl = [number, number, number];
type MatchResult = { index: number; distance: number };

const DITHER_STRENGTH = 0.34;
const DITHER_ERROR_LIMIT = 42;
const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((value) => (value + 0.5) / 16);
const LANCZOS_RADIUS = 3;

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
    block_preview_png: art.blockPreviewPng,
    map_preview_png: art.mapPreviewPng,
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
  const bitmap = await createImageBitmap(file, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
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
  if (settings.art_mode === "map") {
    const matched = matchMapArt(source.data, width, height, blocks, settings);
    const mapPreview = renderRgbPreview(matched.mapPreviewRgb, width, height, settings.show_grid);
    const blockPreview = renderRgbPreview(matched.blockPreviewRgb, width, height, settings.show_grid);
    const previewPng = settings.map_preview === "blocks" ? blockPreview : mapPreview;
    return { ...matched, previewPng, blockPreviewPng: blockPreview, mapPreviewPng: mapPreview, width, height };
  }
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
  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = bitmap.width;
  sourceCanvas.height = bitmap.height;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) throw new Error("Browser does not support Canvas 2D.");
  sourceCtx.drawImage(bitmap, 0, 0);
  const source = sourceCtx.getImageData(0, 0, bitmap.width, bitmap.height);

  if (fitMode === "stretch") {
    ctx.putImageData(resizeLanczos(source, width, height), 0, 0);
    return;
  }
  const scale =
    fitMode === "cover"
      ? Math.max(width / bitmap.width, height / bitmap.height)
      : Math.min(width / bitmap.width, height / bitmap.height);
  const scaledWidth = Math.max(1, Math.round(bitmap.width * scale));
  const scaledHeight = Math.max(1, Math.round(bitmap.height * scale));
  const scaled = resizeLanczos(source, scaledWidth, scaledHeight);
  if (fitMode === "cover") {
    const left = Math.max(0, Math.floor((scaledWidth - width) / 2));
    const top = Math.max(0, Math.floor((scaledHeight - height) / 2));
    ctx.putImageData(cropImageData(scaled, left, top, width, height), 0, 0);
    return;
  }
  ctx.putImageData(scaled, Math.floor((width - scaledWidth) / 2), Math.floor((height - scaledHeight) / 2));
}

function resizeLanczos(source: ImageData, targetWidth: number, targetHeight: number) {
  const output = new ImageData(targetWidth, targetHeight);
  const xWeights = buildLanczosWeights(source.width, targetWidth);
  const yWeights = buildLanczosWeights(source.height, targetHeight);
  const temp = new Float64Array(targetWidth * source.height * 4);

  for (let sy = 0; sy < source.height; sy += 1) {
    for (let dx = 0; dx < targetWidth; dx += 1) {
      const weights = xWeights[dx];
      const out = (sy * targetWidth + dx) * 4;
      for (const { index: sx, weight } of weights) {
        const src = (sy * source.width + sx) * 4;
        temp[out] += source.data[src] * weight;
        temp[out + 1] += source.data[src + 1] * weight;
        temp[out + 2] += source.data[src + 2] * weight;
        temp[out + 3] += source.data[src + 3] * weight;
      }
    }
  }

  for (let dy = 0; dy < targetHeight; dy += 1) {
    const weights = yWeights[dy];
    for (let dx = 0; dx < targetWidth; dx += 1) {
      const out = (dy * targetWidth + dx) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const { index: sy, weight } of weights) {
        const src = (sy * targetWidth + dx) * 4;
        r += temp[src] * weight;
        g += temp[src + 1] * weight;
        b += temp[src + 2] * weight;
        a += temp[src + 3] * weight;
      }
      output.data[out] = clamp(Math.round(r));
      output.data[out + 1] = clamp(Math.round(g));
      output.data[out + 2] = clamp(Math.round(b));
      output.data[out + 3] = clamp(Math.round(a));
    }
  }
  return output;
}

function cropImageData(source: ImageData, left: number, top: number, width: number, height: number) {
  const output = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = left + x;
      const sy = top + y;
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
      const src = (sy * source.width + sx) * 4;
      const dst = (y * width + x) * 4;
      output.data[dst] = source.data[src];
      output.data[dst + 1] = source.data[src + 1];
      output.data[dst + 2] = source.data[src + 2];
      output.data[dst + 3] = source.data[src + 3];
    }
  }
  return output;
}

function buildLanczosWeights(sourceSize: number, targetSize: number) {
  const scale = targetSize / sourceSize;
  const filterScale = scale < 1 ? 1 / scale : 1;
  const radius = LANCZOS_RADIUS * filterScale;
  const weights: Array<Array<{ index: number; weight: number }>> = [];
  for (let target = 0; target < targetSize; target += 1) {
    const center = (target + 0.5) / scale - 0.5;
    const start = Math.max(0, Math.ceil(center - radius));
    const end = Math.min(sourceSize - 1, Math.floor(center + radius));
    const entries: Array<{ index: number; weight: number }> = [];
    let total = 0;
    for (let source = start; source <= end; source += 1) {
      const weight = lanczos((center - source) / filterScale);
      if (weight === 0) continue;
      entries.push({ index: source, weight });
      total += weight;
    }
    if (total === 0) {
      entries.push({ index: Math.max(0, Math.min(sourceSize - 1, Math.round(center))), weight: 1 });
    } else {
      for (const entry of entries) entry.weight /= total;
    }
    weights.push(entries);
  }
  return weights;
}

function lanczos(x: number) {
  const ax = Math.abs(x);
  if (ax < 1e-7) return 1;
  if (ax >= LANCZOS_RADIUS) return 0;
  return (LANCZOS_RADIUS * Math.sin(Math.PI * ax) * Math.sin((Math.PI * ax) / LANCZOS_RADIUS)) / (Math.PI * Math.PI * ax * ax);
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
      const selectedRgb = blockRgb(selected) ?? blocks[match.index].rgb;
      blockRow.push(selected);
      heightRow.push(settings.art_mode === "map" && settings.map_variant === "stairs" ? Math.round(luminance(color) / 255 * 3) : 0);

      if (settings.quality === "high" && shouldDiffuse(color, match.distance)) {
        diffuseError(work, width, height, x, y, selectedRgb);
      }
    }
    blockGrid.push(blockRow);
    heightGrid.push(heightRow);
  }

  const cleanedGrid = settings.quality === "high" ? despeckleGrid(blockGrid) : blockGrid;
  return { blockGrid: cleanedGrid, heightGrid, materials: recountMaterials(cleanedGrid), airCount };
}

function matchMapArt(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  blocks: BlockInfo[],
  settings: Settings
): Omit<ConvertedArt, "previewPng" | "blockPreviewPng" | "width" | "height"> & {
  mapPreviewRgb: Uint8ClampedArray;
  blockPreviewRgb: Uint8ClampedArray;
} {
  const palette = createMapPalette(blocks, settings.map_variant);
  if (!palette.length) throw new Error("No map-art colors are available for the selected palette.");
  const work = new Float64Array(width * height * 3);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 3) {
    work[p] = data[i];
    work[p + 1] = data[i + 1];
    work[p + 2] = data[i + 2];
  }

  const paletteRgb = palette.map((candidate) => candidate.mapRgb);
  const paletteLab = paletteRgb.map((rgb) => rgbToLab(rgb));
  const chosen: (MapColorCandidate | null)[][] = [];
  const blockGrid: string[][] = [];
  const mapPreviewRgb = new Uint8ClampedArray(width * height * 4);
  const blockPreviewRgb = new Uint8ClampedArray(width * height * 4);
  let airCount = 0;

  for (let y = 0; y < height; y += 1) {
    const candidateRow: (MapColorCandidate | null)[] = [];
    const blockRow: string[] = [];
    for (let x = 0; x < width; x += 1) {
      const src = (y * width + x) * 4;
      const idx = (y * width + x) * 3;
      const alpha = data[src + 3];
      if (alpha < 8 && settings.transparent_mode === "air") {
        candidateRow.push(null);
        blockRow.push(AIR_ID);
        setPreviewPixel(mapPreviewRgb, x, y, width, [0, 0, 0], 0);
        setPreviewPixel(blockPreviewRgb, x, y, width, [0, 0, 0], 0);
        airCount += 1;
        continue;
      }
      if (alpha < 8 && settings.transparent_mode === "white") setWork(work, idx, [255, 255, 255]);
      if (alpha < 8 && settings.transparent_mode === "black") setWork(work, idx, [0, 0, 0]);
      const color: [number, number, number] = [clamp(work[idx]), clamp(work[idx + 1]), clamp(work[idx + 2])];
      const match = nearestMapColor(color, paletteRgb, paletteLab, settings.quality);
      const candidate = palette[match.index];
      candidateRow.push(candidate);
      blockRow.push(candidate.blockId);
      setPreviewPixel(mapPreviewRgb, x, y, width, candidate.mapRgb, 255);
      setPreviewPixel(blockPreviewRgb, x, y, width, candidate.blockRgb, 255);
      if (settings.quality === "high" && shouldDiffuse(color, match.distance)) {
        diffuseError(work, width, height, x, y, candidate.mapRgb);
      }
    }
    chosen.push(candidateRow);
    blockGrid.push(blockRow);
  }

  const heightGrid = mapHeightGrid(chosen, settings);
  const placements = mapPlacements(chosen, heightGrid);
  const materials = recountPlacementMaterials(placements);
  const maxLevel = placements.reduce((max, placement) => Math.max(max, placement.level), 0);
  return {
    blockGrid,
    heightGrid,
    placements,
    materials,
    airCount,
    depth: maxLevel + 1,
    mapPreviewRgb,
    blockPreviewRgb
  };
}

function nearestMapColor(
  color: [number, number, number],
  paletteRgb: [number, number, number][],
  paletteLab: Lab[],
  quality: Settings["quality"]
): MatchResult {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  const colorLab = quality === "fast" ? null : rgbToLab(color);
  for (let i = 0; i < paletteRgb.length; i += 1) {
    const distance = quality === "fast" ? weightedRgbDistance(color, paletteRgb[i]) : squaredDistance(colorLab!, paletteLab[i]);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return { index: best, distance: Math.sqrt(bestDistance) };
}

function mapHeightGrid(chosen: (MapColorCandidate | null)[][], settings: Settings) {
  const height = chosen.length;
  const width = chosen[0]?.length || 0;
  const grid = Array.from({ length: height }, () => new Array(width).fill(0));
  if (settings.map_variant !== "stairs") return grid;
  let min = 0;
  for (let x = 0; x < width; x += 1) {
    let level = 0;
    for (let y = 0; y < height; y += 1) {
      const candidate = chosen[y][x];
      if (candidate && !candidate.isWater) {
        if (candidate.shade === 2) level += 1;
        if (candidate.shade === 0) level -= 1;
      }
      grid[y][x] = level;
      min = Math.min(min, level);
    }
  }
  if (min < 0) {
    for (const row of grid) {
      for (let x = 0; x < row.length; x += 1) row[x] -= min;
    }
  }
  return grid;
}

function mapPlacements(chosen: (MapColorCandidate | null)[][], heightGrid: number[][]): BlockPlacement[] {
  const placements: BlockPlacement[] = [];
  for (let y = 0; y < chosen.length; y += 1) {
    for (let x = 0; x < chosen[y].length; x += 1) {
      const candidate = chosen[y][x];
      if (!candidate) continue;
      const baseLevel = heightGrid[y][x];
      if (candidate.isWater) {
        placements.push({ x, y, level: baseLevel, blockId: "minecraft:stone" });
        for (let i = 1; i <= candidate.waterDepth; i += 1) {
          placements.push({ x, y, level: baseLevel + i, blockId: candidate.blockId });
        }
      } else {
        placements.push({ x, y, level: baseLevel, blockId: candidate.blockId });
      }
    }
  }
  return placements;
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
      const block = BLOCK_BY_ID.get(baseBlockId(blockGrid[y][x]));
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

function renderRgbPreview(data: Uint8ClampedArray, width: number, height: number, showGrid: boolean) {
  const factor = Math.max(1, Math.min(Math.floor(768 / Math.max(width, height)), 12));
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) throw new Error("Browser does not support Canvas 2D.");
  sourceCtx.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);

  const canvas = document.createElement("canvas");
  canvas.width = width * factor;
  canvas.height = height * factor;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser does not support Canvas 2D.");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (showGrid && factor >= 6) {
    ctx.strokeStyle = "rgba(20, 24, 28, 0.28)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= canvas.width; x += factor) line(ctx, x, 0, x, canvas.height);
    for (let y = 0; y <= canvas.height; y += factor) line(ctx, 0, y, canvas.width, y);
  }
  return canvas.toDataURL("image/png");
}

function setPreviewPixel(
  data: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  rgb: [number, number, number],
  alpha: number
) {
  const offset = (y * width + x) * 4;
  data[offset] = rgb[0];
  data[offset + 1] = rgb[1];
  data[offset + 2] = rgb[2];
  data[offset + 3] = alpha;
}

function materialItems(materials: Map<string, number>): MaterialItem[] {
  return [...materials.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => {
      const block = BLOCK_BY_ID.get(baseBlockId(id));
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

function recountPlacementMaterials(placements: BlockPlacement[]) {
  const materials = new Map<string, number>();
  for (const placement of placements) {
    if (placement.blockId === AIR_ID) continue;
    materials.set(placement.blockId, (materials.get(placement.blockId) || 0) + 1);
  }
  return materials;
}

function baseBlockId(blockId: string) {
  return blockId.split("[", 1)[0];
}

function blockRgb(blockId: string): [number, number, number] | undefined {
  return BLOCK_BY_ID.get(baseBlockId(blockId))?.rgb;
}
