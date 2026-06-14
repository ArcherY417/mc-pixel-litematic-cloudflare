# MC Pixel Litematic Cloudflare

![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Frontend](https://img.shields.io/badge/frontend-React%20%2B%20Vite-646CFF)
![Deploy](https://img.shields.io/badge/deploy-Cloudflare%20Pages-F38020)
![No Backend](https://img.shields.io/badge/backend-not%20required-2EA043)

纯浏览器版 Minecraft 图片转 `.litematic` 工具。上传图片，选择方块、方向、画幅和质量模式，然后直接在浏览器里生成 Litematica 投影文件。

这个仓库专门给 Cloudflare Pages / GitHub Pages / 静态托管使用：没有 Python，没有服务器，没有数据库，也没有 `/api`。

## 功能亮点

- 图片导入：支持 PNG、JPG、WebP、GIF 首帧。
- 像素画模式：普通墙画、地画、天花板投影。
- Map Art 模式：支持 128x128 单地图和多地图拼接。
- 方块筛选：全部、羊毛、混凝土、陶瓦、地图画可用、生存友好、自定义方块。
- 颜色匹配：快速、标准、高质量抖动三档。
- 构建方向：north、south、east、west。
- 导出文件：`.litematic`、材料清单 CSV/JSON、预览 PNG。
- 纯前端生成：所有图片和结果都在用户浏览器内处理，不上传到服务器。

## 在线部署

Cloudflare Pages 推荐配置：

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
```

仓库根目录就是 Vite 项目，不需要设置 Root directory。

## 本地运行

```powershell
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5173
```

## 构建

```powershell
npm run build
```

构建产物会输出到：

```text
dist/
```

## 测试

```powershell
npm run test
```

当前测试重点覆盖 `.litematic` 浏览器端写入逻辑、BlockStates 位打包、朝向坐标映射和 gzip/NBT 基本结构。

## 项目结构

```text
.
├─ src/
│  ├─ client/
│  │  ├─ browserGenerator.ts  # 图片转方块、预览、材料清单
│  │  ├─ litematic.ts         # .litematic 结构和坐标映射
│  │  ├─ nbt.ts               # 浏览器端 NBT writer
│  │  └─ palette.ts           # 方块筛选
│  ├─ blocks.ts               # 内置 Minecraft 方块颜色表
│  ├─ main.tsx                # React UI
│  └─ styles.css              # 页面样式
├─ package.json
└─ vite.config.ts
```

## 给 AI Agent 的快速上下文

这是纯静态仓库。不要添加后端 API、Node 服务、Python 服务或数据库。所有生成逻辑应该继续运行在浏览器端。

重要入口：

- UI：`src/main.tsx`
- 颜色匹配和图片转换：`src/client/browserGenerator.ts`
- `.litematic` 写入：`src/client/litematic.ts`
- NBT/GZip：`src/client/nbt.ts`
- 方块库：`src/blocks.ts`

验证命令：

```powershell
npm run test
npm run build
npm audit --audit-level=high
```

## 常见问题

### Cloudflare 上需要后端吗？

不需要。这个版本就是为纯静态部署准备的。

### 图片会上传吗？

不会。图片在浏览器里读取、转换和生成文件。

### 生成的是哪个 Minecraft 版本？

界面里可以选择 1.20.1 或 1.21 系列方块库。导出目标是 Minecraft Java Edition + Litematica。

### 为什么另一个 Python 仓库是 GPL？

Python 版依赖 `litemapy`，所以单独使用 GPL-3.0-only。这个 Cloudflare 纯 JS 版不依赖 `litemapy`，因此使用 MIT。

## License

MIT. See [LICENSE](LICENSE).

## Disclaimer

This project is not affiliated with Mojang, Microsoft, Minecraft, or Litematica.
