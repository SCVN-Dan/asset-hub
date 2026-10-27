# Asset Hub — Roadmap

- Cập nhật: 2026-10-27
- Chi tiết kỹ thuật: [PLAN.md](PLAN.md)
- Canvas (prototype + docs): https://claude.ai/artifact/VsfxZnDZguqCF2ASwwZfoP

**State:** `✅ Done` · `🔄 In progress` · `⏳ Todo` · `⛔ Blocked` · `❓ Cần quyết định`

Ước lượng thời gian là sơ bộ, cho 1 người.

**Nguyên tắc chia phase:** làm xong mục đích chính trước — **tìm và hiển thị được FBX của một branch, có preview** (Mốc A) — rồi mới mở rộng dần sang import, lọc trùng, shader. Kiến trúc handler (PLAN §8d) có từ Phase 1 để các phase sau chỉ cắm thêm.

---

## Tổng quan

| Mốc | Phase | Nội dung | Ước lượng | State |
|---|---|---|---|---|
| — | 0 | Planning & setup | — | ✅ |
| **A · Asset Browser** | 1 | App shell + UI (dữ liệu giả) | ~1 tuần | ✅ |
| A | 2 | Kết nối GitHub + tìm FBX trong branch | 1–1,5 tuần | ✅ |
| A | 3 | Preview FBX + dependency + thông số | 1,5–2 tuần | ✅ |
| **B · Import** | 4 | Xuất `.unitypackage` (ưu tiên) + copy vào project, lịch sử, undo | ~1 tuần | ⏳ tiếp theo |
| B | 4.5 | Tìm asset trên mọi branch / mọi repo (chỉ mục cục bộ) | ~1 tuần | ⏳ |
| B | 5 | Unity Companion + lọc trùng + Import Profile | 2–3 tuần | ⏳ |
| **C · Shader** | 6 | Render pipeline & Shader Mapping | 2–3 tuần | ⏳ |
| **D · Mở rộng** | 7 | Polish & mở rộng (chỉ mục dùng chung cho team, tìm bằng hình, tag, audio/sprite…) | tuỳ nhu cầu | ⏳ |
| D | 8 | Lên chính thức (GitHub App org) | phụ thuộc admin | ⏳ (làm song song được) |
| D | 9 | Particle System prefab (làm sau) | 2–3 tuần | ⏳ |

---

## Phase 0 — Planning & setup
| Việc | State |
|---|---|
| Đánh giá khả thi, chọn hướng kiến trúc | ✅ |
| Chốt scope: chỉ FBX + dependency | ✅ |
| Chốt nền tảng Git: GitHub | ✅ |
| Kiểm tra môi trường dev (git, git-lfs, gh, node) | ✅ |
| Tạo project `/Volumes/Supercent/asset-hub`, viết PLAN + ROADMAP | ✅ |
| Prototype UI (Sign in, Browse, Review, Import Profile) | ✅ |
| Duyệt thiết kế UI | ✅ |
| Song ngữ EN (mặc định) / VI | ✅ |
| Chốt tính năng bổ sung #1, 3, 4, 5, 7, 9, 10, 11; #8 làm sau (PLAN §8c) | ✅ |
| Thiết kế kiến trúc mở rộng theo loại asset (PLAN §8d) | ✅ |
| Đưa plan + roadmap lên canvas | ✅ |
| Chốt lưu trữ khi import + xử lý shader (PLAN §6b) | ✅ |
| Chia lại phase theo mốc (Asset Browser trước) | ✅ |
| Chốt Electron hay Tauri | ✅ Electron |

## Phase 1 — App shell + UI (Mốc A)
Mục tiêu: app chạy được, đủ màn Sign in + Browse với dữ liệu giả. Không cần repo thật.

| Việc | State |
|---|---|
| Khung Electron + React + TS, build/dev script (electron-vite) | ✅ |
| Theme dark + component dùng chung (button, badge, tree, grid card, panel) | ✅ |
| i18n: `i18next`, `locales/en.json` + `vi.json`, EN mặc định, nút EN/VI lưu settings | ✅ |
| `HandlerRegistry` + interface `AssetTypeHandler` / `PreviewProvider` (PLAN §8d) | ✅ |
| `FbxHandler` bản đầu (`match` theo đuôi `.fbx`) | ✅ |
| Màn Sign in (UI, chưa nối thật) | ✅ |
| Màn Browse: top bar, cây thư mục, grid, search, filter, panel chi tiết — chạy với dữ liệu giả | ✅ |
| `AssetSource` interface + `MockAssetSource` (Phase 2 thay bằng GitHub) | ✅ |
| Unit test core/settings/locales (11 test) + smoke test app thật | ✅ |
| Settings: ngôn ngữ, thư mục cache | ✅ |

## Phase 2 — Kết nối GitHub + tìm FBX (Mốc A)
Mục tiêu: đăng nhập, chọn repo/branch, **thấy toàn bộ FBX của branch** trong cây thư mục + grid. Gộp luôn phần spike trên repo thật.

| Việc | State |
|---|---|
| Đăng nhập gh ngay trong app (`gh auth login --web`, mã tự copy vào clipboard, không cần GitHub App riêng) | ✅ |
| Test end-to-end với tài khoản thật (`SCVN-Dan`): 49 repo, 103 branch, **747 FBX** hiện đúng (691 ẩn trong `_ThirdParty`); tải cây lần đầu ~7 s, lần sau ~0,2 s nhờ cache | ✅ |
| Repo test: `supercent-io/hb_creative_xp_hero` @ `vn/net-catch` | ✅ |
| Login: `gh` token + fine-grained PAT; PAT mã hoá bằng `safeStorage` (Keychain); tự đăng nhập lại khi mở app | ✅ |
| List repo / branch qua REST API (phân trang), ô chọn có tìm kiếm | ✅ |
| Lấy cây file: Git Trees API (`recursive=1`), fallback `git ls-tree` khi `truncated` | ✅ |
| Nhận diện LFS qua `.gitattributes`, đọc dung lượng thật từ pointer bằng GraphQL theo lô | ✅ |
| Map lỗi GitHub (401, SSO, rate limit, 404, mạng) → thông báo song ngữ, nút mở trang SSO | ✅ |
| Tự dò Unity project root (repo test lồng trong `unity_project/…`) | ✅ |
| Thư mục loại trừ (mặc định `_ThirdParty`), chỉnh trong Settings | ✅ |
| Git engine: bare repo `--filter=blob:none` cho fallback ls-tree (token qua env, không lộ trong argv). Tải nội dung file → Phase 3 | 🔄 |
| Cache cây file theo commit (JSON trong thư mục cache) | ✅ |
| Lọc FBX qua `FbxHandler.match`, đổ vào cây thư mục + grid, search theo tên | ✅ |
| Index SQLite — dời: cache JSON theo commit đủ cho 1 repo; SQLite khi tìm nhiều repo (Phase 7) | ⏳ |
| Spike trên repo thật (qua bản clone local, chỉ đọc) → kết quả ở PLAN §11 | ✅ |
| Picker repo/branch có nhóm (theo tổ chức / tiền tố branch), nhớ repo + branch lần trước | ✅ |
| **Không cần Terminal**: app tự cài GitHub CLI chính thức (kiểm SHA-256) vào thư mục app nếu máy chưa có; hướng dẫn 4 bước trong khung mã | ✅ |
| Đọc mã đăng nhập cho mọi phiên bản gh (2.103 đổi câu chữ) + watchdog 20 s | ✅ |

## Phase 3 — Preview FBX + dependency + thông số (Mốc A)
Mục tiêu: chọn một FBX → thấy preview 3D có texture, danh sách dependency, thông số. **Xong phase này là đạt mục đích chính của tool.**

| Việc | State |
|---|---|
| Đọc `.meta` / `.mat` qua GraphQL theo lô (thay cho sparse-checkout — không cần git trên máy người dùng), chia lô + thử lại khi GitHub 502/504 | ✅ |
| Chỉ mục GUID → path theo commit (material, texture, shader), cache trên đĩa. Lần đầu ~130 s với repo test, sau đó tức thì | ✅ |
| Resolver GUID tổng quát đệ quy (cho prefab/particle) — dời sang Phase 9, FBX dùng resolver riêng | ⏳ |
| `FbxHandler.resolveDependencies`: kiểu A (GUID → .mat → shader + texture) + kiểu B (tên texture trong FBX → file gần nhất) | ✅ |
| Tải on-demand FBX + texture: git blob API, LFS batch API; cache nội dung theo hash | ✅ |
| Preview three.js + gán texture (texture trong FBX theo tên, texture `.mat` theo material) | ✅ |
| Điều khiển xem: kéo xoay (orbit), cuộn zoom, pan; góc nhìn có sẵn (trước/bên/trên); tự xoay; wireframe; reset góc nhìn | ✅ |
| Thumbnail grid: chụp khi xem lần đầu, cache theo hash | ✅ |
| #3 Preview animation clip trong FBX | ✅ |
| #1 Thông số (tris, vertex, mesh, material, bone, clip, dung lượng) + cảnh báo ngân sách playable | ✅ |
| Panel chi tiết: cây dependency, loại shader, cảnh báo thiếu / ghép theo tên | ✅ |
| Tăng tốc chỉ mục GUID: dùng lại chỉ mục của commit trước cho các `.meta` không đổi | ⏳ |
| Unit test resolver, client, cache (43 test) + e2e trên repo thật | ✅ |

## Phase 4 — Xuất `.unitypackage` + import cơ bản (Mốc B)
Mục tiêu: lấy FBX + dependency (kèm `.meta`, giữ GUID) ra khỏi repo theo hai cách: **xuất `.unitypackage`** (ưu tiên — không cần biết project đích, gửi được cho người khác, Phase 9 dùng lại cho particle) hoặc copy thẳng vào project đích. Chưa lọc trùng phức tạp: GUID đã có thì báo / bỏ qua. Chi tiết: PLAN §6c.

| Việc | State |
|---|---|
| Writer `.unitypackage` (tar.gz: `<guid>/asset`, `asset.meta`, `pathname`, `preview.png`), không cần Unity | ⏳ |
| `pathname` theo layout (mặc định `mirror` dưới `Assets/AssetHub/<repo>/`), dependency dùng chung vào `_Shared` | ⏳ |
| Nút "Xuất .unitypackage" (1 asset hoặc nhiều asset đã chọn), chọn nơi lưu, kèm thumbnail làm preview | ⏳ |
| Cảnh báo trước khi xuất nếu đã chọn project đích: GUID nào đã có (Unity sẽ ghi đè) | ⏳ |
| Test: package mở được trong Unity, GUID và tham chiếu material/texture giữ nguyên | ⏳ |
| Chọn project đích (thư mục Unity), kiểm tra hợp lệ | ⏳ |
| Copy file + `.meta`, layout `mirror`, thư mục `_Shared` | ⏳ |
| Bỏ qua file có GUID đã tồn tại trong đích (quét `.meta` của đích) | ⏳ |
| Màn Review bản đầu (danh sách file, trạng thái Mới / Đã có) | ⏳ |
| Metadata nguồn gốc + log import trong `<project>/.assethub/` | ⏳ |
| #5 Lịch sử import + undo file mới | ⏳ |
| #10 Deep link `assethub://` + nút Copy link | ⏳ |

## Phase 4.5 — Tìm asset trên mọi branch / mọi repo (Mốc B)
Mục tiêu: tìm được asset khi không biết nó ở repo / branch nào. Chỉ mục cục bộ, chạy nền trong app. Chi tiết: PLAN §8e.

| Việc | State |
|---|---|
| Chỉ mục nhẹ: tên, path, blob SHA, dung lượng, repo, branch — không tải nội dung | ⏳ |
| Gộp theo SHA: cùng file ở nhiều branch chỉ lưu một lần + danh sách branch | ⏳ |
| Cập nhật tăng dần: branch có commit không đổi thì bỏ qua (dùng cache cây theo commit) | ⏳ |
| Ưu tiên quét: branch mặc định + branch push trong 30 ngày; branch cũ quét khi rảnh | ⏳ |
| Ô tìm kiếm có phạm vi: Branch này / Mọi branch của repo / Mọi repo; lọc theo loại, repo | ⏳ |
| "Asset này còn ở đâu?": cùng SHA hoặc cùng GUID ở repo / branch khác | ⏳ |
| Index SQLite + FTS (thay cho JSON khi dữ liệu lớn) | ⏳ |

## Phase 5 — Unity Companion + lọc trùng + Import Profile (Mốc B)
| Việc | State |
|---|---|
| UPM package Companion: quét project đích → index GUID + hash | ⏳ |
| Protocol App ↔ Companion: JSON có `version` + `capabilities`, giữ chỗ `renderPreview` | ⏳ |
| Dedupe trường hợp 1–3, màn review xung đột đầy đủ | ⏳ |
| Remap GUID trong `.mat` và `.fbx.meta` | ⏳ |
| FBX kiểu B: user xác nhận texture tìm theo tên | ⏳ |
| Tuỳ chọn import settings: giữ `.meta` gốc / preset đích | ⏳ |
| Import Profile `.assethub/profile.json`: root, layout (mirror / per-asset / by-type) + màn cài đặt | ⏳ |
| Shader tình huống 1: so phiên bản package, cảnh báo nguồn mới hơn | ⏳ |
| Shader tình huống 2: mặc định dùng bản đích, so property, ghi đè cần xác nhận, đổi tên khi giữ cả hai | ⏳ |
| Shader tình huống 3: trùng tên shader → remap | ⏳ |
| #11 Import vào thư mục đang chọn trong Unity | ⏳ |
| #5 Undo cho file bị ghi đè (backup + khôi phục) | ⏳ |
| Test trong Unity cùng user | ⏳ |

## Phase 6 — Render pipeline & Shader Mapping (Mốc C)
| Việc | State |
|---|---|
| Nhận diện pipeline nguồn/đích, badge trên asset | ⏳ |
| Shader Mapping engine trong Companion (shader, props, keywords, log) | ⏳ |
| shaderPolicy: keep-source / prefer-project / force-project-shader | ⏳ |
| Preset: Built-in → URP (Render Pipeline Converter), Built-in → HDRP, URP → Built-in | ⏳ |
| Cờ đỏ cho custom shader, fallback Lit | ⏳ |
| Màn Review hiện dòng shader mapping cho từng material | ⏳ |

## Phase 7 — Polish & mở rộng (Mốc D)
| Việc | State |
|---|---|
| Device Flow qua GitHub App cá nhân (test) | ⏳ |
| Tìm kiếm bước 2: chỉ mục dùng chung cho team — GitHub Action định kỳ quét repo, đẩy chỉ mục + thumbnail vào repo riêng (vd. `supercent-io/asset-index`); app chỉ tải về, tìm tức thì | ⏳ |
| Tìm bằng hình ảnh / mô tả (embedding thumbnail) | ⏳ |
| #7 Bộ sưu tập / yêu thích / tag | ⏳ |
| #9 `AudioHandler` + `SpriteHandler` (preview audio, sprite/UI 2D) | ⏳ |
| pHash cảnh báo texture gần giống | ⏳ |
| GitHub Actions dựng manifest + thumbnail sẵn | ⏳ |
| Đóng gói, code signing macOS/Windows | ⏳ |

## Phase 8 — Lên chính thức (Mốc D, làm song song được)
| Việc | State |
|---|---|
| Admin tạo GitHub App trong org (Contents/Metadata read, Device Flow) | ⏳ |
| Cài app lên các repo asset | ⏳ |
| Thay Client ID, bỏ đăng nhập bằng PAT nếu cần | ⏳ |
| Rollout cho team | ⏳ |

## Phase 9 — Particle System prefab (làm sau)
Chỉ thêm handler mới, không sửa core (PLAN §8d).

| Việc | State |
|---|---|
| `ParticlePrefabHandler`: nhận diện prefab có `ParticleSystem` | ⏳ |
| Check script thiếu (MonoBehaviour custom) | ⏳ |
| Companion `renderPreview`: scene tạm, simulate, xuất GIF/WebM, cache | ⏳ |
| (Tuỳ chọn) CI batchmode render preview sẵn | ⏳ |
| Tab Particles trong UI (sinh từ registry) | ⏳ |
| Xuất particle prefab bằng cùng cơ chế `.unitypackage` (Phase 4) | ⏳ |
| (Sau nữa) VFX Graph | ⏳ |

---

## Nhật ký
| Ngày | Thay đổi |
|---|---|
| 2026-10-27 | Khởi tạo project, viết PLAN + ROADMAP. |
| 2026-10-27 | Thêm prototype UI 3 màn hình trên canvas. |
| 2026-10-27 | Duyệt thiết kế UI; thêm song ngữ EN (mặc định) / VI. Ghi thiết kế vào PLAN §8b. |
| 2026-10-27 | Chốt tính năng bổ sung (PLAN §8c), kiến trúc handler mở rộng (PLAN §8d), thêm phase Particle. |
| 2026-10-27 | Đưa toàn bộ plan + roadmap lên canvas prototype. |
| 2026-10-27 | Chốt Import Profile và xử lý shader (PLAN §6b); thêm màn Import Profile. |
| 2026-10-27 | **Chia lại phase theo mốc**: A Asset Browser (1–3) → B Import (4–5) → C Shader (6) → D Mở rộng (7–9). Spike gộp vào Phase 2. |
| 2026-10-27 | Thêm xuất `.unitypackage` vào Phase 4 (ưu tiên), thêm Phase 4.5 tìm asset mọi branch / mọi repo; chỉ mục dùng chung + tìm bằng hình vào Phase 7; particle xuất bằng `.unitypackage`. |
| 2026-10-27 | **Phase 3 xong** — Mốc A đạt: xem FBX 3D (xoay/zoom/pan, góc nhìn, wireframe, animation), dependency kiểu A/B, thông số + ngân sách playable, thumbnail. Test trên Short_Wood (A), LogPlatform (thiếu material), Snow_Tree (B), TF_Player_Throw (animation). |
| 2026-10-27 | Sửa: nhớ branch (do app dev chạy main process cũ — `npm run dev` giờ dùng `--watch`); app tự cài gh, không cần Terminal; tương thích câu chữ mới của gh 2.103. |
| 2026-10-27 | **Phase 2 xong**: test end-to-end với tài khoản thật trên `hb_creative_xp_hero @ vn/net-catch` — 747 FBX, cache hoạt động. Thêm đăng nhập gh qua trình duyệt ngay trong app. |
| 2026-10-27 | **Phase 2 code xong**: đăng nhập gh/PAT, list repo/branch, Trees API + LFS + fallback git, dò Unity root, thư mục loại trừ. 26 unit test + smoke test qua. Spike repo thật → PLAN §11. Còn: test end-to-end với tài khoản thật. |
| 2026-10-27 | **Phase 1 xong**: app Electron chạy với dữ liệu mẫu (Sign in, Browse, Settings, EN/VI). Typecheck, 11 unit test, smoke test đều qua. |
