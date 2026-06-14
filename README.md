# MC Pixel Litematic Cloudflare

纯前端 JavaScript 版 Minecraft 图片转 `.litematic` 工具，适合 Cloudflare Pages 静态部署。

## Local

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
```

## Cloudflare Pages

仓库根目录就是 Vite 项目，Cloudflare Pages 这样填：

```text
Build command: npm run build
Build output directory: dist
```

不需要 Python、服务器、环境变量或 `/api`。

## License

MIT. See `LICENSE`.
