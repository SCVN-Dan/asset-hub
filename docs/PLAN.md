# Asset Hub — Plan

> Desktop app đăng nhập GitHub công ty, duyệt một branch của Unity project nguồn, chọn **FBX + dependency** (material, texture, shader), preview, lọc trùng và import vào Unity project đích.

- Cập nhật: 2026-10-27
- Trạng thái tổng: **Planning** — xem [ROADMAP.md](ROADMAP.md)
- Thứ tự làm: Mốc A Asset Browser (tìm + hiển thị + preview FBX) → B Import → C Shader → D Mở rộng

---

## 1. Mục tiêu & phạm vi

### Trong phạm vi
- Đăng nhập GitHub (Device Flow / PAT / `gh` token).
- Chọn repo → branch, duyệt cây thư mục, lọc danh sách FBX.
- Tự resolve dependency của FBX: `.fbx.meta` → `.mat` → texture + shader.
- Preview 3D FBX (three.js) và thumbnail.
- Lọc asset trùng với project đích (GUID + hash).
- Import vào project đích, giữ GUID khi an toàn, remap khi cần.
- Nhận diện và chuyển đổi render pipeline của material (phase sau).
- Tính năng bổ sung đã chốt: xem §8c.

### Làm sau (kiến trúc phải chừa đường — xem §8d)
- Particle System prefab + preview động (sau đó có thể VFX Graph).

### Ngoài phạm vi
- Prefab thường, script, animator controller, scene, `.asset` khác (có thể thêm sau qua cơ chế handler §8d).
- Ghi / push ngược lên repo (app chỉ đọc).

---

## 2. Kiến trúc

```
┌──────────────── Asset Hub App (Electron) ───────────────┐
│  Login (Device Flow / PAT / gh) → Repo → Branch         │
│  Git engine: git + git-lfs (partial clone, sparse)      │
│  Indexer: GUID map, dependency graph, hash (SQLite)     │
│  UI: React — cây thư mục, grid, preview three.js        │
│  Dedupe + Conflict resolver                             │
└──────────────┬──────────────────────────────────────────┘
               │ copy file + .meta / lệnh qua localhost
┌──────────────▼──────────────────────────────────────────┐
│  Unity Companion (UPM package trong project đích)       │
│  - Quét project đích → index (GUID, hash)               │
│  - Remap GUID, kiểm tra shader                          │
│  - Chuyển pipeline material sau import                  │
└─────────────────────────────────────────────────────────┘
```

| Thành phần | Lựa chọn | Ghi chú |
|---|---|---|
| App shell | **Electron** (TS) | MVP nhanh; cân nhắc Tauri nếu cần nhẹ |
| UI | React + three.js (`FBXLoader`) | Preview gần đúng, không giống Unity 100% |
| Git | `git` + `git-lfs` CLI đóng gói kèm | Không tự viết git engine |
| Index | SQLite cục bộ | Cache theo repo |
| Unity side | UPM package (cài qua Git URL) | C# Editor scripts |

---

## 3. GitHub — xác thực & lấy dữ liệu

### 3.1 Đăng nhập

| Cách | Dùng khi | Quyền |
|---|---|---|
| **GitHub App (org)** — bản chính thức | Có admin tạo app | `Contents: Read`, `Metadata: Read`, bật Device Flow |
| GitHub App (cá nhân) | Test luồng Device Flow trên repo cá nhân | như trên |
| Fine-grained PAT | Test trên repo được share | `Contents: Read-only` (org có thể yêu cầu duyệt) |
| `gh auth token` | Test nhanh, không cần admin | theo quyền tài khoản |

Token lưu trong OS keychain. Org bật SAML SSO → token phải được authorize SSO.

### 3.2 API duyệt, Git tải

| Việc | Cách |
|---|---|
| User / repo / branch | REST: `GET /user/repos`, `GET /repos/{o}/{r}/branches` |
| Cây file + blob SHA | `GET /repos/{o}/{r}/git/trees/{branch}?recursive=1` (nếu `truncated` → `git ls-tree`) |
| Index GUID | `git clone --filter=blob:none --sparse` + `GIT_LFS_SKIP_SMUDGE=1`, sparse-checkout `*.meta`, `*.mat` |
| Hash FBX/texture | Đọc LFS pointer (`oid sha256`) — không cần tải file thật |
| Tải asset đã chọn | `git lfs pull --include="..."` |

Rate limit API: 5.000 req/giờ/user → không đọc `.meta` qua API.
Băng thông LFS tính vào quota của org → bắt buộc cache.

### 3.3 Việc cần admin (khi lên chính thức)
1. Tạo GitHub App trong org: `Contents: Read-only`, `Metadata: Read-only`, bật Device Flow, không webhook.
2. Cài app lên các repo chứa asset.
3. Cung cấp **Client ID** (không phải secret).
4. Kiểm tra quota LFS.

---

## 4. Resolve dependency của FBX

```
Character.fbx
├── Character.fbx.meta          ← luôn lấy (import settings, rig, clips)
│   └── externalObjects         ← material đã tách ra .mat
│       └── Body.mat (+ .meta)
│           ├── m_Shader ─► trong Packages/ → không copy, chỉ kiểm tra tồn tại
│           │               trong Assets/   → copy (+ sub-graph, .hlsl) hoặc thay Lit
│           └── m_TexEnvs ─► texture (+ .meta)
└── (không có externalObjects) material nhúng trong FBX
    └── texture tìm theo TÊN FILE ghi trong FBX
```

| Kiểu | Nhận biết | Cách resolve | Độ tin cậy |
|---|---|---|---|
| **A. Material tách ra** | `.meta` có `externalObjects` | Đi theo GUID | Chính xác |
| **B. Material nhúng** | Không có `externalObjects`, `materialImportMode ≠ 0` | Đọc tên texture từ FBX → tìm cùng thư mục → `Textures/` cạnh đó → toàn repo | Heuristic, user xác nhận |

Kiểu B phải giữ cấu trúc thư mục tương đối giữa FBX và texture (`materialSearch`).
Edge case: rig dùng "Copy From Other Avatar" → thêm dependency sang FBX khác.

---

## 5. Lọc asset trùng

Áp dụng cho FBX, material, texture. Hash tính trên file gốc, không tính `.meta`.

| # | Trường hợp | Phát hiện | Xử lý mặc định |
|---|---|---|---|
| 1 | Cùng GUID, cùng nội dung | GUID có ở đích + hash giống | Bỏ qua |
| 2 | Cùng GUID, khác nội dung | GUID trùng, hash khác | Hỏi: Ghi đè / Giữ cũ / Import bản mới (GUID mới) |
| 3 | Khác GUID, cùng nội dung | Hash giống | Dùng lại asset có sẵn, remap GUID |
| 4 | Gần giống (texture resize/nén lại) | pHash | Chỉ cảnh báo (phase sau) |

- Trùng path, khác GUID → import vào `Assets/AssetHub/<repo>/...` hoặc đổi tên.
- Dependency dùng chung chỉ import một lần.
- Remap GUID chỉ sửa: `m_TexEnvs`, `m_Shader` trong `.mat` và `externalObjects` trong `.fbx.meta`.
- Màn review: 🟢 Mới · ⚪ Đã có · 🔵 Dùng lại · 🟠 Xung đột.

---

## 6. Render pipeline (gộp với Shader Mapping — xem §6b)

Nhận diện: `ProjectSettings/GraphicsSettings.asset` (`m_CustomRenderPipeline`) + GUID shader trong `.mat`.

| Chuyển đổi | Khả năng | Cách |
|---|---|---|
| Built-in → URP | ✅ | Render Pipeline Converter (`Converters.RunInBatchMode`) |
| Built-in → HDRP | ✅ | HDRP Wizard upgrade material |
| URP → Built-in | ⚠️ | Tự map property (`_BaseMap→_MainTex`, `_BaseColor→_Color`, `_Smoothness→_Glossiness`…) |
| URP ↔ HDRP | ⚠️ | Map Lit↔Lit; mask map cần pack lại |
| Shader Graph | ⚠️ | Cần target của pipeline đích |
| Custom HLSL | ❌ | Gắn cờ đỏ, fallback Lit |

UI hiển thị badge pipeline trên từng asset trước khi import.

---

## 6b. Lưu trữ khi import & xử lý shader (chốt 2026-10-27)

Unity tham chiếu bằng GUID nên user có thể di chuyển asset sau khi import mà không vỡ tham chiếu. App chỉ cần một layout mặc định hợp lý + cấu hình theo project.

### Import Profile (mỗi project đích một file `<project>/.assethub/profile.json`, commit lên Git để cả team dùng chung)

```json
{
  "root": "Assets/AssetHub/{repo}",
  "layout": "mirror",
  "sharedFolder": "{root}/_Shared",
  "shaderPolicy": "prefer-project",
  "projectShader": "Project/Character",
  "shaderMappings": [
    { "from": "Universal Render Pipeline/Lit", "to": "Project/Character",
      "props": { "_BaseMap": "_MainTex", "_BaseColor": "_Color", "_BumpMap": "_NormalMap" },
      "keywords": { "_NORMALMAP": "_USE_NORMAL" } }
  ]
}
```

| Layout | Ví dụ | Hợp khi |
|---|---|---|
| **mirror** (mặc định) | `Assets/AssetHub/<repo>/Art/Characters/Knight/…` | Truy vết nguồn dễ, giữ đúng đường dẫn tương đối FBX ↔ texture (kiểu B), không trùng path |
| **per-asset** | `Assets/AssetHub/Knight_Hero/{Models,Materials,Textures}` | Muốn mỗi asset gọn một thư mục |
| **by-type** | FBX → `Assets/Art/Models/`, `.mat` → `Assets/Art/Materials/`, texture → `Assets/Art/Textures/` | Project có quy ước thư mục riêng |

- Dependency dùng chung → `{root}/_Shared/`, copy một lần.
- Asset "Dùng lại" / "Đã có" không copy, chỉ remap.
- #11 import vào thư mục đang chọn = thay `{root}`, layout vẫn áp dụng.
- Metadata nguồn gốc (repo, commit, path gốc, GUID, log import) ở `<project>/.assethub/` — ngoài `Assets/` nên Unity không import; dùng cho lịch sử/undo (#5).

### 4 tình huống shader

| # | Tình huống | Phát hiện | Xử lý mặc định |
|---|---|---|---|
| 1 | Shader trong package (URP/Lit…), khác phiên bản URP | So `Packages/packages-lock.json` nguồn ↔ đích | Không copy; URP tự nâng cấp material. Cảnh báo khi nguồn mới hơn đích |
| 2 | Shader custom cùng GUID, khác nội dung | GUID trùng, hash khác | **Dùng bản của project đích**; ghi đè chỉ khi user xác nhận rõ (ảnh hưởng mọi material). So danh sách property, báo thiếu/thừa |
| 3 | Cùng tên shader, khác GUID | Đọc `Shader "Custom/Toon"` | Coi là cùng shader → remap sang shader có sẵn, không import thêm (tránh trùng tên, `Shader.Find` không xác định) |
| 4 | Project dùng một house shader, asset dùng shader khác | Shader của material ≠ house shader | Áp Shader Mapping |

Muốn giữ cả hai bản ở tình huống 2: import với GUID mới **và đổi tên trong file shader** (vd. `Custom/Toon_<repo>`).

### Shader policy

| Policy | Hành vi |
|---|---|
| `keep-source` | Giữ shader của asset, import kèm nếu đích chưa có |
| `prefer-project` (mặc định) | Có mapping → chuyển sang shader project; không có → giữ nguồn + cảnh báo |
| `force-project-shader` | Luôn chuyển sang house shader, không import shader nguồn; property không map được ghi vào báo cáo |

Companion thực thi sau import: gán shader → copy texture/giá trị theo mapping → bật/tắt keyword → log property không map được.
Chuyển pipeline (§6) là một bộ mapping có sẵn của cùng cơ chế này.
Màn Review hiện mỗi material: `Shader: URP/Lit → Project/Character (mapping "Default")`.

---

## 7. Rủi ro & vấn đề cần lường

| Vấn đề | Mức | Hướng xử lý |
|---|---|---|
| Repo thật lộn xộn (GUID trùng, texture sai chỗ, shader custom) | **Cao** | Spike trên repo thật sớm nhất |
| FBX kiểu B (material nhúng) | Trung bình | Heuristic + user xác nhận |
| Import settings texture (platform override) | Trung bình | Hỏi giữ `.meta` gốc hay áp preset đích |
| Preview khác Unity | Thấp | Chấp nhận; FBX < 7.0 / ASCII có thể không đọc được |
| Khác version Unity | Thấp | Cảnh báo khi nguồn mới hơn đích |
| Quota LFS | Trung bình | Cache, chỉ tải khi preview/import |
| Org yêu cầu duyệt PAT / SSO | Trung bình | Fallback `gh` token |

---

## 8. Khả năng mở rộng

| Khi | Hướng |
|---|---|
| Nhiều repo/branch | Cache theo repo, `git fetch` incremental, index SQLite |
| Repo > 100k file | `git ls-tree`, index theo diff commit |
| Nhiều người dùng | GitHub Actions dựng `manifest.json` + thumbnail khi push → Releases/S3 |
| Thêm loại asset | Resolver dạng plugin theo loại file |
| Tìm kiếm | Tag, tên, sau này semantic search |

---

## 8b. Thiết kế UI (đã duyệt 2026-10-27)

Prototype: https://claude.ai/artifact/VsfxZnDZguqCF2ASwwZfoP

| Màn | Nội dung |
|---|---|
| **1 · Sign in** | Device Flow (hiện mã), fine-grained PAT, dùng tài khoản `gh` CLI; ghi chú SAML SSO |
| **2 · Browse assets** | Top bar: repo, branch, sync, search, project đích + badge pipeline. Trái: cây thư mục, filter pipeline/trạng thái. Giữa: grid FBX (badge FBX, trạng thái, pipeline, số mat/tex). Phải: preview 3D, path, cây dependency kèm trạng thái, cảnh báo, nút Import |
| **3 · Review before import** | Chip lọc trạng thái, bảng file (trạng thái, path đích, loại, xử lý), dropdown xử lý xung đột, tuỳ chọn thư mục đích / import settings / pipeline, tổng kết số file |

Phong cách: dark theme kiểu editor tool, font Inter + JetBrains Mono (path), accent xanh `#2F6FE0`.
Màu trạng thái: Mới `#3FCF8E` · Đã có `#9AA3B2` · Dùng lại `#6AA8FF` · Xung đột `#F5A524` (luôn kèm chữ, không chỉ dựa vào màu).

### Đa ngôn ngữ (i18n)
- Hỗ trợ **English (mặc định)** và **Tiếng Việt**.
- Nút chuyển EN / VI trên header mọi màn; lựa chọn lưu vào settings của app, áp dụng toàn app.
- Toàn bộ chuỗi UI nằm trong file resource (`locales/en.json`, `locales/vi.json`), không hardcode trong component; dùng thư viện i18n (vd. `i18next` + `react-i18next`).
- Thuật ngữ kỹ thuật giữ nguyên tiếng Anh ở cả hai ngôn ngữ: FBX, material, texture, shader, GUID, pipeline, URP, Built-in, branch, repo.
- Tên file, path, tên repo/branch không dịch.
- Thông báo lỗi từ git / GitHub API: hiện bản dịch tóm tắt + chi tiết gốc tiếng Anh.
- Prototype: mỗi màn có nút EN/VI riêng (canvas không chia sẻ state giữa các màn); bản thật dùng chung một setting.

---

## 8c. Tính năng bổ sung (đã chốt 2026-10-27)

| # | Tính năng | Mô tả | Phase |
|---|---|---|---|
| 1 | **Thông số asset + cảnh báo dung lượng playable** | Tris, vertex, bone, số material, độ phân giải và dung lượng texture, dung lượng ước tính. Ngưỡng cảnh báo cấu hình theo preset (vd. preset "Playable") | 3 |
| 3 | **Preview animation clip trong FBX** | Liệt kê clip, play/pause, loop, tốc độ (three.js `AnimationMixer`) | 3 |
| 5 | **Lịch sử import + hoàn tác** | Mỗi lần import ghi log: file đã ghi, GUID, remap, file bị ghi đè (có backup). Undo xoá file mới và khôi phục backup | 4 (log, undo file mới) · 5 (undo ghi đè) |
| 10 | **Deep link** | `assethub://open?repo=<org>/<repo>&branch=<b>&path=<p>`; nút "Copy link"; Electron đăng ký protocol | 4 |
| 11 | **Import vào thư mục đang chọn trong Unity** | Companion báo thư mục đang chọn ở Project window; app có tuỳ chọn import thẳng vào đó | 5 |
| 4 | **Tìm kiếm nhiều repo** | Thêm nhiều repo vào thư viện; index mỗi repo trong SQLite, tìm chung bằng FTS | 7 |
| 7 | **Bộ sưu tập / yêu thích / tag** | Lưu local trước; sau có thể chia sẻ trong team | 7 |
| 9 | **Preview audio + sprite/UI 2D** | Audio: wav/mp3/ogg phát trực tiếp. Sprite: ảnh + slice đọc từ `.meta` (`spriteSheet`). TGA/PSD cần loader riêng | 7 |
| 8 | **Particle System prefab + preview động** | Resolver GUID đệ quy, cảnh báo script thiếu; preview do Companion/CI render thành GIF/WebM | 9 (làm sau) |

Không chọn lúc này: #2 kiểm tra tương thích Luna, #6 báo asset nguồn có bản mới.

---

## 8d. Kiến trúc mở rộng theo loại asset

Mục tiêu: thêm loại asset mới (particle, audio, sprite…) chỉ bằng cách **đăng ký một handler**, không sửa core, UI, index hay import pipeline.

### Asset type handler

```ts
interface AssetTypeHandler {
  id: string;                         // 'fbx' | 'audio' | 'sprite' | 'particle-prefab' …
  labelKey: string;                   // key i18n cho tab / badge
  match(entry: TreeEntry, meta?: MetaYaml): boolean;
  // Mặc định dùng GenericGuidResolver; handler chỉ bổ sung (vd. FBX kiểu B tìm texture theo tên)
  resolveDependencies?(asset: Asset, ctx: ResolveContext): Promise<DepNode[]>;
  getStats?(asset: Asset, ctx: StatsContext): Promise<AssetStats>;
  checks?: AssetCheck[];              // cảnh báo: dung lượng, shader, script thiếu…
  preview: PreviewProvider;
}

interface PreviewProvider {
  kind: 'three' | 'audio' | 'image' | 'unity-render';
  // Luôn async và trả về media/handle → preview do Companion/CI render cắm vào sau mà không đổi UI
  load(asset: Asset, ctx: PreviewContext): Promise<PreviewResult>;
}
```

- `HandlerRegistry` là nơi duy nhất biết có những loại asset nào. UI (tab, filter, badge), indexer và import đều đọc từ registry.
- Phase 1 chỉ đăng ký `FbxHandler`; sau thêm `AudioHandler`, `SpriteHandler`, rồi `ParticlePrefabHandler`.

### Các điểm chừa đường từ Phase 1–3

| Phần | Quyết định |
|---|---|
| **Resolver** | Viết `GenericGuidResolver` ngay từ đầu: đi theo mọi `guid:` trong YAML (đệ quy, chống vòng lặp), bỏ qua GUID của package/built-in. FBX dùng nó + phần bổ sung riêng. Particle prefab sau này dùng lại nguyên |
| **Index (SQLite)** | Bảng `assets(id, repo, path, guid, type, hash, stats_json)`, bảng `deps(from_guid, to_guid)`. Không có cột riêng cho FBX; thông số theo loại để trong `stats_json` |
| **Preview** | Mọi preview qua `PreviewProvider` async + cache theo `hash`. Loại `unity-render` gọi Companion (hoặc lấy file CI render sẵn) |
| **Companion protocol** | Giao tiếp JSON có `version` + `capabilities`. Lệnh: `scan`, `import`, `getSelectedFolder`; **giữ chỗ** `renderPreview` cho particle. App kiểm tra capability trước khi dùng |
| **Checks** | Cảnh báo là plugin (`AssetCheck`): budget playable, shader custom, script thiếu (cho prefab)… |
| **Import** | Import pipeline không phụ thuộc loại asset: nhận danh sách file + kế hoạch remap từ resolver |
| **UI** | Tab/filter loại asset sinh từ registry; panel chi tiết gồm các block (preview, stats, deps, checks) để mỗi handler góp phần của mình |
| **i18n** | Mỗi handler có namespace chuỗi riêng (`locales/<lang>/<handlerId>.json`) |

### Particle prefab sau này cần gì thêm
- `ParticlePrefabHandler`: `match` = prefab có component `ParticleSystem` (đọc YAML).
- Check "script thiếu" cho MonoBehaviour custom; sub-emitter đi theo GUID nên resolver tổng quát đã xử lý.
- Preview `unity-render`: Companion mở scene tạm, simulate, chụp frame → GIF/WebM → cache; hoặc CI batchmode render sẵn.

---

## 9. Môi trường dev (đã kiểm tra 2026-10-27)

| Tool | Trạng thái |
|---|---|
| git | ✅ 2.39.5 |
| git-lfs | ✅ |
| gh | ✅ — **chưa login** |
| node / npm | ✅ v26.11.1 |

## 10. Câu hỏi còn mở
- [ ] Tên repo + branch nguồn để spike
- [ ] Đường dẫn Unity project đích + version Unity + pipeline
- [ ] Org có bật SAML SSO / yêu cầu duyệt fine-grained PAT không?
- [ ] Chốt Electron hay Tauri (đề xuất Electron)

---

## 11. Kết quả spike trên repo thật (2026-10-27)

Repo `supercent-io/hb_creative_xp_hero` @ `vn/net-catch` (commit `65e91d0603`), đọc qua bản clone local, chỉ đọc.

| Chỉ số | Giá trị | Ảnh hưởng |
|---|---|---|
| Unity project | Lồng ở `unity_project/hb_creative_xp_hero/`, Unity 2023.2.20f1, URP 16.0.6 (pipeline asset riêng) | App tự dò project root (đã làm ở Phase 2) |
| Tổng file | 37.572 | Dưới giới hạn 100k entry của Trees API |
| FBX | 1.438 file, 456,7 MB | |
| Git LFS | **Không dùng** — FBX commit thẳng vào git | Dung lượng lấy từ Trees API; Phase 3 tải file bằng git blob/raw, không phải LFS |
| FBX trong `_ThirdParty` | 691 (48%) | Thư mục loại trừ mặc định `_ThirdParty` |
| Material tách ra (kiểu A) | 144 | |
| Material nhúng / legacy (kiểu B) | 1.220 (293 dùng `materialLocation: 0` → Unity tìm `.mat` theo tên) | Phase 3: resolver theo tên là phần quan trọng, không phải edge case |
| Không có material | 74 | |
| Material được FBX tham chiếu nhưng không có trong repo | 28 / 69 | Cảnh báo "thiếu material" trong panel chi tiết |
| Shader | Chủ yếu URP/Lit (package), có Toony Colors Pro (custom) | Tình huống shader 1 và 2 đều xuất hiện |
| Texture dùng chung nhiều material | 11 / 38 | Thư mục `_Shared` có ích |

