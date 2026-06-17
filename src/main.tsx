import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Box,
  Check,
  Download,
  Eraser,
  FileArchive,
  FileImage,
  Github,
  Grid3X3,
  ImageUp,
  ListFilter,
  Loader2,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Upload
} from "lucide-react";
import { BLOCKS } from "./blocks";
import { convertInBrowser } from "./client/browserGenerator";
import { blockMatchesPalette } from "./client/palette";
import "./styles.css";
import type { ConvertResponse, Settings } from "./types";

const initialSettings: Settings = {
  name: "pixel-art",
  author: "MC Pixel Litematic Studio",
  mc_version: "1.21",
  art_mode: "pixel",
  target_width: 64,
  target_height: 64,
  lock_aspect: true,
  fit_mode: "contain",
  quality: "standard",
  transparent_mode: "air",
  palette_mode: "all",
  palette_modes: ["all"],
  custom_blocks: [],
  replacements: {},
  build_plane: "wall",
  direction: "north",
  map_columns: 1,
  map_rows: 1,
  map_variant: "flat",
  map_preview: "map",
  show_grid: true
};

function App() {
  const blocks = BLOCKS;
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string>("");
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [result, setResult] = useState<ConvertResponse | null>(null);
  const [previewMode, setPreviewMode] = useState<"source" | "converted">("converted");
  const [blockSearch, setBlockSearch] = useState("");
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);

  const versionBlocks = useMemo(
    () => blocks.filter((block) => block.versions.includes(settings.mc_version)),
    [blocks, settings.mc_version]
  );

  const filteredBlocks = useMemo(() => {
    const q = blockSearch.trim().toLowerCase();
    const modes = settings.palette_modes?.length ? settings.palette_modes : [settings.palette_mode];
    return versionBlocks.filter((block) => {
      if (q && !`${block.id} ${block.name}`.toLowerCase().includes(q)) return false;
      if (modes.includes("custom")) return true;
      return blockMatchesPalette(block, modes);
    });
  }, [blockSearch, settings.palette_mode, settings.palette_modes, versionBlocks]);

  const selectedCustomSet = useMemo(() => new Set(settings.custom_blocks), [settings.custom_blocks]);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function chooseFile(next: File | null) {
    if (!next) return;
    setFile(next);
    setResult(null);
    setError("");
    const url = URL.createObjectURL(next);
    setSourceUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return url;
    });
    const cleanName = next.name.replace(/\.[^.]+$/, "").slice(0, 80);
    setSettings((current) => ({ ...current, name: cleanName || current.name }));
  }

  async function convert() {
    if (!file) {
      setError("请选择图片。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await convertInBrowser(file, settings);
      setResult(data);
      setPreviewMode("converted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败。");
    } finally {
      setBusy(false);
    }
  }

  function toggleCustomBlock(blockId: string) {
    setSettings((current) => {
      const next = new Set(current.custom_blocks);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return { ...current, custom_blocks: [...next], palette_mode: "custom", palette_modes: ["custom"] };
    });
  }

  function togglePaletteMode(mode: Settings["palette_modes"][number]) {
    setSettings((current) => {
      if (mode === "all") {
        return { ...current, palette_mode: "all", palette_modes: ["all"] };
      }
      if (mode === "custom") {
        return { ...current, palette_mode: "custom", palette_modes: ["custom"] };
      }
      const currentModes = current.palette_modes?.length ? current.palette_modes : [current.palette_mode];
      const next = new Set(currentModes.filter((item) => item !== "all" && item !== "custom"));
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      const palette_modes: Settings["palette_modes"] = next.size ? ([...next] as Settings["palette_modes"]) : ["all"];
      return { ...current, palette_mode: palette_modes[0] as Settings["palette_mode"], palette_modes };
    });
  }

  function setReplacement(from: string, to: string) {
    setSettings((current) => ({
      ...current,
      replacements: { ...current.replacements, [from]: to }
    }));
  }

  function clearReplacements() {
    setSettings((current) => ({ ...current, replacements: {} }));
  }

  const convertedPreview =
    settings.art_mode === "map" && settings.map_preview === "blocks"
      ? result?.block_preview_png || result?.preview_png
      : result?.map_preview_png || result?.preview_png;
  const previewSrc = previewMode === "source" ? sourceUrl : convertedPreview || sourceUrl;
  const outputSize =
    settings.art_mode === "map"
      ? `${settings.map_columns * 128} x ${settings.map_rows * 128}`
      : `${settings.target_width} x ${settings.lock_aspect ? "auto" : settings.target_height}`;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>MC Pixel Litematic Studio</h1>
          <p>本地生成 Java Litematica 投影</p>
        </div>
        <div className="status-strip">
          <span>{settings.mc_version}</span>
          <span>{settings.art_mode === "map" ? "Map Art" : "Pixel Art"}</span>
          <span>{outputSize}</span>
          <a
            className="github-link"
            href="https://github.com/ArcherY417/mc-pixel-litematic-cloudflare"
            target="_blank"
            rel="noreferrer"
            title="Open GitHub repository"
          >
            <Github size={16} />
            <span>GitHub</span>
          </a>
        </div>
      </header>

      <section className="workspace">
        <aside className="settings-panel">
          <PanelTitle icon={<ImageUp size={18} />} label="输入" />
          <button className="upload-zone" onClick={() => fileInput.current?.click()} type="button">
            <Upload size={22} />
            <span>{file ? file.name : "选择图片"}</span>
          </button>
          <input
            ref={fileInput}
            className="hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          />

          <div className="field-grid">
            <label>
              名称
              <input value={settings.name} onChange={(event) => update("name", event.target.value)} />
            </label>
            <label>
              作者
              <input value={settings.author} onChange={(event) => update("author", event.target.value)} />
            </label>
          </div>

          <PanelTitle icon={<SlidersHorizontal size={18} />} label="转换" />
          <div className="field-grid two">
            <label>
              版本
              <select value={settings.mc_version} onChange={(event) => update("mc_version", event.target.value as Settings["mc_version"])}>
                <option value="1.21">1.21 系列</option>
                <option value="1.20.1">1.20.1</option>
              </select>
            </label>
            <label>
              质量
              <select value={settings.quality} onChange={(event) => update("quality", event.target.value as Settings["quality"])}>
                <option value="fast">快速</option>
                <option value="standard">标准</option>
                <option value="high">高质量</option>
              </select>
            </label>
          </div>

          <Segmented
            value={settings.art_mode}
            options={[
              ["pixel", "普通"],
              ["map", "Map Art"]
            ]}
            onChange={(value) => update("art_mode", value as Settings["art_mode"])}
          />

          {settings.art_mode === "pixel" ? (
            <div className="field-grid three">
              <label>
                宽
                <input
                  type="number"
                  min={1}
                  max={1024}
                  value={settings.target_width}
                  onChange={(event) => update("target_width", Number(event.target.value))}
                />
              </label>
              <label>
                高
                <input
                  type="number"
                  min={1}
                  max={1024}
                  value={settings.target_height}
                  disabled={settings.lock_aspect}
                  onChange={(event) => update("target_height", Number(event.target.value))}
                />
              </label>
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={settings.lock_aspect}
                  onChange={(event) => update("lock_aspect", event.target.checked)}
                />
                锁比例
              </label>
            </div>
          ) : (
            <div className="field-grid three">
              <label>
                列
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={settings.map_columns}
                  onChange={(event) => update("map_columns", Number(event.target.value))}
                />
              </label>
              <label>
                行
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={settings.map_rows}
                  onChange={(event) => update("map_rows", Number(event.target.value))}
                />
              </label>
              <label>
                形态
                <select value={settings.map_variant} onChange={(event) => update("map_variant", event.target.value as Settings["map_variant"])}>
                  <option value="flat">平面</option>
                  <option value="stairs">阶梯</option>
                </select>
              </label>
              <label>
                预览
                <select value={settings.map_preview} onChange={(event) => update("map_preview", event.target.value as Settings["map_preview"])}>
                  <option value="map">地图效果</option>
                  <option value="blocks">方块外观</option>
                </select>
              </label>
            </div>
          )}

          <div className="field-grid two">
            <label>
              适配
              <select value={settings.fit_mode} onChange={(event) => update("fit_mode", event.target.value as Settings["fit_mode"])}>
                <option value="contain">完整</option>
                <option value="cover">裁切</option>
                <option value="stretch">拉伸</option>
              </select>
            </label>
            <label>
              透明
              <select
                value={settings.transparent_mode}
                onChange={(event) => update("transparent_mode", event.target.value as Settings["transparent_mode"])}
              >
                <option value="air">空气</option>
                <option value="white">白色</option>
                <option value="black">黑色</option>
              </select>
            </label>
          </div>

          <PanelTitle icon={<Box size={18} />} label="结构" />
          <div className="field-grid two">
            <label>
              平面
              <select
                value={settings.art_mode === "map" ? "floor" : settings.build_plane}
                disabled={settings.art_mode === "map"}
                onChange={(event) => update("build_plane", event.target.value as Settings["build_plane"])}
              >
                <option value="wall">竖墙</option>
                <option value="floor">地面</option>
                <option value="ceiling">天花板</option>
              </select>
            </label>
            <label>
              朝向
              <select value={settings.direction} onChange={(event) => update("direction", event.target.value as Settings["direction"])}>
                <option value="north">North</option>
                <option value="south">South</option>
                <option value="east">East</option>
                <option value="west">West</option>
              </select>
            </label>
          </div>

          <PanelTitle icon={<ListFilter size={18} />} label="方块" />
          <div className="palette-options" role="group" aria-label="方块类型">
            {[
              ["all", "全部"],
              ["wool", "羊毛"],
              ["concrete", "混凝土"],
              ["terracotta", "陶瓦"],
              ["pixel_art", "推荐"],
              ["map_art", "地图画"],
              ["survival", "生存"],
              ["custom", "自定义"]
            ].map(([mode, label]) => {
              const active = (settings.palette_modes?.length ? settings.palette_modes : [settings.palette_mode]).includes(
                mode as Settings["palette_modes"][number]
              );
              return (
                <button
                  key={mode}
                  className={active ? "active" : ""}
                  type="button"
                  onClick={() => togglePaletteMode(mode as Settings["palette_modes"][number])}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="search-box">
            <Search size={16} />
            <input value={blockSearch} onChange={(event) => setBlockSearch(event.target.value)} placeholder="搜索方块" />
          </div>
          <div className="block-list">
            {filteredBlocks.map((block) => (
              <button
                key={block.id}
                className={`block-row ${selectedCustomSet.has(block.id) ? "selected" : ""}`}
                type="button"
                onClick={() => toggleCustomBlock(block.id)}
                title={block.id}
              >
                <span className="swatch" style={{ background: rgb(block.rgb) }} />
                <span>{block.name}</span>
                {selectedCustomSet.has(block.id) && <Check size={15} />}
              </button>
            ))}
          </div>
        </aside>

        <section className="main-panel">
          <div className="toolbar">
            <div className="seg-wrap">
              <Segmented
                value={previewMode}
                options={[
                  ["source", "原图"],
                  ["converted", "结果"]
                ]}
                onChange={(value) => setPreviewMode(value as "source" | "converted")}
              />
              <label className="icon-toggle" title="网格">
                <Grid3X3 size={17} />
                <input
                  type="checkbox"
                  checked={settings.show_grid}
                  onChange={(event) => update("show_grid", event.target.checked)}
                />
              </label>
            </div>
            <label className="zoom-control">
              缩放
              <input type="range" min="0.5" max="4" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
            </label>
            <button className="primary" onClick={convert} disabled={busy} type="button">
              {busy ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
              生成
            </button>
          </div>

          {error && <div className="error-line">{error}</div>}

          <div className="preview-stage">
            {previewSrc ? (
              <img src={previewSrc} style={{ transform: `scale(${zoom})` }} alt="preview" />
            ) : (
              <button className="empty-preview" onClick={() => fileInput.current?.click()} type="button">
                <FileImage size={34} />
                <span>选择图片</span>
              </button>
            )}
          </div>

          <div className="result-band">
            <Metric label="宽" value={result?.width ?? 0} />
            <Metric label="高" value={result?.height ?? 0} />
            <Metric label="厚" value={result?.depth ?? 0} />
            <Metric label="方块" value={result?.block_count ?? 0} />
            <Metric label="空气" value={result?.air_count ?? 0} />
          </div>

          <div className="lower-grid">
            <section className="materials-panel">
              <div className="panel-heading">
                <h2>材料</h2>
                <button className="ghost" onClick={clearReplacements} type="button" title="清空替换">
                  <Eraser size={16} />
                </button>
              </div>
              <div className="materials-list">
                {(result?.materials ?? []).map((item) => (
                  <div className="material-row" key={item.id}>
                    <span className="swatch" style={{ background: rgb(item.rgb) }} />
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.count.toLocaleString()} blocks</span>
                    </div>
                    <select value={settings.replacements[item.id] ?? item.id} onChange={(event) => setReplacement(item.id, event.target.value)}>
                      {versionBlocks.map((block) => (
                        <option key={block.id} value={block.id}>
                          {block.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </section>

            <section className="download-panel">
              <div className="panel-heading">
                <h2>导出</h2>
              </div>
              <DownloadLink href={result?.downloads.litematic} icon={<FileArchive size={18} />} label=".litematic" downloadName={`${safeDownloadName(settings.name)}.litematic`} />
              <DownloadLink href={result?.downloads.materials_csv} icon={<Download size={18} />} label="材料 CSV" downloadName={`${safeDownloadName(settings.name)}-materials.csv`} />
              <DownloadLink href={result?.downloads.materials_json} icon={<Download size={18} />} label="材料 JSON" downloadName={`${safeDownloadName(settings.name)}-materials.json`} />
              <DownloadLink href={result?.downloads.preview_png} icon={<FileImage size={18} />} label="预览 PNG" downloadName={`${safeDownloadName(settings.name)}-preview.png`} />
              <a
                className="legal-link"
                href="https://github.com/ArcherY417/mc-pixel-litematic-cloudflare/blob/main/DISCLAIMER.md"
                target="_blank"
                rel="noreferrer"
              >
                Disclaimer
              </a>
            </section>
          </div>
        </section>
      </section>
    </main>
  );
}

function PanelTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="panel-title">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange
}: {
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented">
      {options.map(([id, label]) => (
        <button className={value === id ? "active" : ""} key={id} onClick={() => onChange(id)} type="button">
          {label}
        </button>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function DownloadLink({ href, icon, label, downloadName }: { href?: string; icon: React.ReactNode; label: string; downloadName: string }) {
  return (
    <a className={`download-link ${href ? "" : "disabled"}`} href={href ?? "#"} download={downloadName} onClick={(event) => !href && event.preventDefault()}>
      {icon}
      <span>{label}</span>
    </a>
  );
}

function rgb(color: [number, number, number]) {
  return `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
}

function safeDownloadName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "pixel-art";
}

createRoot(document.getElementById("root")!).render(<App />);
