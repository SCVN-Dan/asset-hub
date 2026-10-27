# Asset Hub

Desktop app (Electron) lấy FBX + dependency (material, texture, shader) từ một branch GitHub của Unity project khác, preview, lọc trùng và import vào project hiện tại.

- [Plan](docs/PLAN.md)
- [Roadmap & state](docs/ROADMAP.md)
- Canvas prototype + docs: https://claude.ai/artifact/VsfxZnDZguqCF2ASwwZfoP

## Chạy

```bash
npm install
npm run dev        # mở app với hot reload
npm test           # unit test (vitest)
npm run typecheck
npm run build      # build ra out/
```

Hiện tại (Phase 1) app chạy với **dữ liệu mẫu** (`MockAssetSource`), chưa kết nối GitHub.

## Cấu trúc

```
src/
  core/            TypeScript thuần, dùng chung main + renderer
    types.ts         TreeEntry, Asset, AssetTypeHandler, PreviewProvider…
    registry.ts      HandlerRegistry — nơi duy nhất biết có những loại asset nào
    handlers/fbx.ts  FbxHandler
    source.ts        AssetSource — nguồn repo/branch/tree (mock → GitHub ở Phase 2)
    mock/            MockAssetSource
    tree.ts          dựng cây thư mục từ danh sách asset
  shared/          settings + kênh IPC dùng chung main/preload/renderer
  main/            Electron main process (cửa sổ, settings, dialog)
  preload/         expose window.api (contextIsolation + sandbox)
  renderer/        React UI
    src/i18n/        i18next, locales/en.json (mặc định) + vi.json
    src/screens/     SignIn, Browse, Settings
    src/components/  FolderTree, AssetCard, AssetDetails, LangToggle, Icons
```

**Thêm loại asset mới:** viết một `AssetTypeHandler` trong `src/core/handlers/`, đăng ký trong `createDefaultRegistry()` (`src/core/index.ts`), thêm key `assetTypes.<id>` vào cả hai file locale. Tab, filter, cây thư mục tự cập nhật.

**Thêm chuỗi UI:** thêm vào cả `en.json` và `vi.json` — test `locales.test.ts` báo lỗi nếu thiếu key.

## Sự cố khi cài

**`Electron failed to install correctly`** — npm mới chặn postinstall; `allowScripts` trong `package.json` đã cho phép `electron` và `esbuild`. Nếu vẫn lỗi (trình giải nén của Electron có thể thoát giữa chừng trên Node rất mới), giải nén thủ công file zip đã cache:

```bash
Z=$(find ~/Library/Caches/electron -name "electron-v*-darwin-*.zip" | head -1)
rm -rf node_modules/electron/dist && mkdir node_modules/electron/dist
ditto -x -k "$Z" node_modules/electron/dist
printf "Electron.app/Contents/MacOS/Electron" > node_modules/electron/path.txt
```
