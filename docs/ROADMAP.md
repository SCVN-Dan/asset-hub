# Asset Hub — Roadmap

- Cập nhật: 2026-10-29
- Chi tiết kỹ thuật: [PLAN.md](PLAN.md)
- Canvas (prototype + docs): https://claude.ai/artifact/VsfxZnDZguqCF2ASwwZfoP

**State:** `✅ Done` · `🔄 In progress` · `⏳ Todo` · `⛔ Blocked` · `❓ Cần quyết định`

Ước lượng thời gian là sơ bộ, cho 1 người.

**Phạm vi (2026-10-27):** app không import vào Unity — chỉ xuất `.unitypackage`, người dùng import bằng Unity.

**Nguyên tắc chia phase:** làm xong mục đích chính trước — **tìm và hiển thị được FBX của một branch, có preview** (Mốc A) — rồi mới mở rộng dần sang import, lọc trùng, shader. Kiến trúc handler (PLAN §8d) có từ Phase 1 để các phase sau chỉ cắm thêm.

---

## Tổng quan

| Mốc | Phase | Nội dung | Ước lượng | State |
|---|---|---|---|---|
| — | 0 | Planning & setup | — | ✅ |
| **A · Asset Browser** | 1 | App shell + UI (dữ liệu giả) | ~1 tuần | ✅ |
| A | 2 | Kết nối GitHub + tìm FBX trong branch | 1–1,5 tuần | ✅ |
| A | 3 | Preview FBX + dependency + thông số | 1,5–2 tuần | ✅ |
| **B · Xuất** | 4 | Xuất `.unitypackage` (import làm trong Unity) | ~3–4 ngày | ✅ |
| B | 4.5 | Tìm asset trên mọi branch / mọi repo (chỉ mục cục bộ) | ~1 tuần | ✅ (còn SQLite khi dữ liệu lớn) |
| B | 4.6 | **Playable-aware ranking**: thông số model lưu theo SHA, huy hiệu trên card, sắp xếp / lọc theo ngân sách playable | ~2–3 ngày | ✅ |
| **C · Kiểm tra (tuỳ chọn)** | 5 | So với project đích (chỉ đọc) + chỉnh shader khi xuất | ~1 tuần | ✅ so sánh + chống trùng + URP + shader trùng tên + Shader Mapping (chờ xem trên app) |
| C | 6 | **Thêm loại asset**: Texture, Material, Audio, Sprite/UI, Prefab (tĩnh), Animation clip, Font, Font TextMeshPro — mỗi loại một handler | ~1–2 tuần | ✅ (chờ xem trên app; Sprite Atlas để khi có file) |
| **D · Mở rộng** | 7 | Polish & mở rộng (chỉ mục dùng chung cho team, tìm bằng hình, tag, audio/sprite…) | tuỳ nhu cầu | ⏳ |
| D | 8 | Lên chính thức (GitHub App org) | phụ thuộc admin | ⏳ (làm song song được) |
| D | 9 | Particle System prefab | 2–3 tuần | ✅ chờ xem trên app (còn collision, lights, ribbon) |
| **E · Phát hành** | 10 | Đóng gói `.dmg` / installer, code signing, tự cập nhật — **làm cuối cùng** (trong lúc phát triển vẫn chạy `npm run dev` để test) | ~2–3 ngày | ⏳ |

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
| Resolver GUID tổng quát đệ quy (cho prefab/particle) | ✅ (Phase 6, prefab tĩnh) |
| `FbxHandler.resolveDependencies`: kiểu A (GUID → .mat → shader + texture) + kiểu B (tên texture trong FBX → file gần nhất) | ✅ |
| Tải on-demand FBX + texture: git blob API, LFS batch API; cache nội dung theo hash | ✅ |
| Preview three.js + gán texture (texture trong FBX theo tên, texture `.mat` theo material) | ✅ |
| Điều khiển xem: kéo xoay (orbit), cuộn zoom, pan; góc nhìn có sẵn (trước/bên/trên); tự xoay; wireframe; reset góc nhìn | ✅ |
| Thumbnail grid: chụp khi xem lần đầu, cache theo hash | ✅ |
| Thumbnail tự tạo chạy nền cho thẻ đang hiện trên màn hình (2 model một lúc, huỷ khi cuộn qua), spinner trên thẻ | ✅ |
| Lưới nạp dần 60 thẻ / lần khi cuộn, skeleton khi đang tải branch | ✅ |
| Gộp file giống hệt (cùng blob SHA): 1 thẻ + badge ×N, danh sách vị trí trong panel chi tiết, công tắc bật/tắt | ✅ |
| Phím mũi tên chọn file (↑↓ nhảy một hàng) | ✅ |
| Nút "Tìm material trong prefab" trên FBX: đọc prefab ở thư mục liên quan trước (dừng khi tìm thấy), nút quét tất cả; lấy đúng material của renderer dùng mesh đó (SkinnedMeshRenderer, MeshFilter+MeshRenderer, prefab lồng có override); áp vào preview + kèm khi xuất; cache theo SHA prefab | ✅ |
| Sửa: cache nằm trong thư mục `Cache` của Chromium (ổ không phân biệt hoa/thường) nên bị xoá khi mở lại app → chuyển sang `AssetHubCache`, tự chuyển cài đặt cũ | ✅ |
| #3 Preview animation clip trong FBX | ✅ |
| #1 Thông số (tris, vertex, mesh, material, bone, clip, dung lượng) + cảnh báo ngân sách playable | ✅ |
| Panel chi tiết: cây dependency, loại shader, cảnh báo thiếu / ghép theo tên | ✅ |
| Tăng tốc chỉ mục GUID: một lần `git fetch` cho mọi `.meta` (partial clone, không checkout) + nhớ GUID theo SHA của `.meta` cho mọi commit/branch; GraphQL 6 luồng khi máy không có git. Repo test: **~130 s → ~10 s** lần đầu, branch khác ~6 s | ✅ |
| Unit test resolver, client, cache (43 test) + e2e trên repo thật | ✅ |

## Phase 4 — Xuất `.unitypackage` (Mốc B)
Mục tiêu: app **chỉ xuất `.unitypackage`**; import làm trong Unity (Assets › Import Package, hộp thoại của Unity tự đánh dấu file mới / đã có và cho chọn file). App không ghi vào project Unity. Chi tiết: PLAN §6c.

| Việc | State |
|---|---|
| Writer `.unitypackage` (tar.gz: `<guid>/asset`, `asset.meta`, `pathname`, `preview.png`), không cần Unity | ✅ |
| `pathname`: mặc định giữ đường dẫn như project nguồn; tuỳ chọn gom dưới `Assets/AssetHub/<repo>/` | ✅ |
| Kiểu **Theo loại**: `Assets/AssetHub/{Prefabs,Models,Materials,Textures,Animations,Audio,Fonts,Shaders,Other}/`; shader giữ cây thư mục trong `Shaders/` (`#include` tương đối); script và file trong `Editor/`, `Resources/`, `Plugins/`, `StreamingAssets/` giữ chỗ cũ; trùng tên → thư mục con theo thư mục nguồn (giữ tên file). **Mặc định** từ 2026-10-28; chọn trong Cài đặt (áp dụng cho mọi nút Xuất, lưu qua các lần mở app) | ✅ chờ test trong Unity |
| Xuất 1 asset hoặc nhiều asset (gói) — gộp dependency, mỗi GUID một bản | ✅ |
| Thumbnail đã render làm `preview.png` (PNG 128×128) | ✅ |
| Tóm tắt trước khi xuất: số file, dung lượng, thiếu, ghép theo tên | ✅ |
| Tuỳ chọn bỏ texture ghép theo tên khỏi gói | ✅ |
| Chọn nơi lưu, mở thư mục sau khi xuất; báo file bị bỏ (thiếu `.meta` / trùng GUID) | ✅ |
| Test gói: GUID khớp `.meta`, `pathname` đúng, texture của `.mat` có trong gói (kiểm tra bằng `tar`) | ✅ |
| Test import trong Unity (Assets › Import Package › Custom Package) | ✅ user xác nhận 2026-10-29 |
| #10 **Deep link** `assethub://open?repo=…&branch=…&path=…` + nút **Copy link** (panel chi tiết, kết quả Mọi branch); app nhận link khi đang chạy, khi link mở app, hoặc **dán vào ô tìm kiếm**; link được giữ tới khi màn duyệt sẵn sàng (kể cả đang đăng nhập); chặn link có `..`. Bấm link từ Slack / trình duyệt trên macOS chỉ chạy với app đã đóng gói (Phase 10) — lúc `npm run dev` thì dán vào ô tìm kiếm | ✅ chờ user xem trên app |
| ~~Copy thẳng vào project, màn review import, lịch sử / undo import (#5)~~ — bỏ: import làm trong Unity | — |

## Phase 4.5 — Tìm asset trên mọi branch / mọi repo (Mốc B)
Mục tiêu: tìm được asset khi không biết nó ở repo / branch nào. Chỉ mục cục bộ, chạy nền trong app. Chi tiết: PLAN §8e.

| Việc | State |
|---|---|
| Chỉ mục nhẹ: tên, path, blob SHA, dung lượng, repo, branch — không tải nội dung (`src/core/catalog`, 1 file JSON / repo, ~3,8 MB cho 104 branch) | ✅ |
| Gộp theo SHA: cùng file ở nhiều branch chỉ lưu một lần + danh sách branch | ✅ |
| Cập nhật tăng dần: branch có commit không đổi thì bỏ qua — mở lại chỉ mất ~3 s (1 GraphQL đọc đầu branch) | ✅ |
| Ưu tiên quét: branch đang mở → repo đang mở → branch mặc định + push trong 30 ngày → branch cũ. Quét nền nhường chỗ khi người dùng đang tải file; tạm dừng / tiếp tục; tự chạy lại sau rate-limit | ✅ |
| Ô tìm kiếm có phạm vi: Branch này / Mọi branch của repo / Mọi repo; lọc theo loại, repo, branch; bấm branch để mở đúng file ở đó | ✅ |
| "Asset này còn ở đâu?": cùng SHA ở repo / branch khác (mục "Cũng có ở" trong panel chi tiết) | ✅ |
| "Còn ở đâu" theo GUID (cùng asset nhưng đã sửa nội dung) | ⏳ |
| Index SQLite + FTS (thay cho JSON khi dữ liệu lớn) | ⏳ |

## Phase 4.6 — Playable-aware ranking (Mốc B, ưu tiên cho demo AX Hero)
Mục tiêu: tìm ra 20 model "boat" thì biết ngay cái nào **đáng dùng lại** cho playable, không phải mở từng cái. (Ý từ góp ý "Asset Reuse Intelligence", 2026-10-28.)

| Việc | State |
|---|---|
| Lưu thông số model theo SHA khi render thumbnail nền hoặc mở viewer (tris, vertices, bones, clips, material, texture, dung lượng) — dùng chung mọi branch (`stats.json`) | ✅ |
| Huy hiệu trên card: ✓ / ⚠ N + số tris; panel có dung lượng, bones; rê chuột xem lý do vượt | ✅ |
| Sắp xếp: khớp nhất, hợp playable nhất, nhẹ nhất, ít tris nhất, dùng nhiều nhất — luôn giữ mức khớp tìm kiếm trước (tên > nhóm từ > thư mục > sửa chính tả); nút "Đo N kết quả" (75 kết quả fish: 44 s) | ✅ |
| Lọc "chỉ asset vừa ngân sách playable" | ✅ |
| Dung lượng gồm cả dependency (texture của .mat): thumbnail nền đọc `.mat` (GUID đã biết gần model) → vẽ đúng material + tính MB texture, texture không tải (quá giới hạn / EXR) vẫn tính theo dung lượng file; FBX đo trước đó được đo lại nền một lần | ✅ chờ user xem trên app |
| Nút "Mở trên GitHub" cho file đang xem | ✅ |
| Xuất `.unitypackage` ngay từ kết quả Mọi branch / Mọi repo (không phải chuyển branch) | ✅ |
| **Tắt kiểm tra playable** (preset "Tắt", **mặc định** từ 2026-10-29 — không phải asset nào cũng dùng cho playable): ẩn ✓/⚠, thanh tải trọng, cảnh báo vượt ngân sách (vd. "texture 2.048 px vượt 1.024 px"), lọc "vừa ngân sách", sắp xếp "hợp playable nhất"; vẫn giữ cảnh báo không phụ thuộc playable (thiếu chữ Việt, texture chưa nén, module particle tốn kém…) | ✅ |
| Preset ngân sách: Network 5 MB / Network 2 MB (Meta) / Tuỳ chỉnh — chọn trong Cài đặt hoặc ngay cạnh ô sắp xếp; mọi ✓/⚠, lọc, xếp hạng, cảnh báo trong panel đổi theo ngay (thông số đo không phụ thuộc ngân sách) | ✅ |

## Phase 5 — (Tuỳ chọn, ưu tiên thấp) So với project đích + shader khi xuất (Mốc C)
Chỉ làm khi cần. Unity tự xử lý import; phần này giúp biết trước những gì Unity sẽ ghi đè hoặc thiếu.

| Việc | State |
|---|---|
| **Project Unity đích** (Cài đặt, chỉ đọc — kiểm có `Assets` + `ProjectSettings`). Khi xuất: quét `.meta` (GUID) + kích thước file của project, chỉ băm (SHA-1) file trùng GUID hoặc trùng kích thước với file trong gói → mỗi file: **đã có** (cùng GUID + nội dung → bỏ khỏi gói), **ghi đè** (cùng GUID, khác nội dung → cảnh báo), **dùng lại** (nội dung giống hệt, GUID khác → bỏ khỏi gói, đổi GUID trong `.mat` / `.prefab` / YAML và `.meta` sang bản của project — chống trùng asset thật; tắt được), **đổi tên** (đường dẫn đã có asset khác → Unity thêm " 1"). Kết quả hiện ngay dưới thanh Export. File dùng lại giữ cài đặt import của bản trong project | ✅ chờ user xem trên app |
| Cảnh báo URP: so `Packages/packages-lock.json` nguồn ↔ đích (khác major.minor, hoặc đích không có URP) | ✅ |
| **Shader khi xuất** (PLAN §6b tình huống 2 + 3): đọc tên shader (`Shader "…"` trong `.shader`; Shader Graph = `m_Path`/tên file, mặc định "Shader Graphs") ở gói và project đích (chỉ khi gói có shader). Bật "Dùng file project đã có": shader **trùng tên** khác GUID → bỏ khỏi gói, material trỏ sang shader của project; shader **cùng GUID khác nội dung** → bỏ khỏi gói, giữ bản của project (không làm hỏng material khác đang dùng). `.shader` ↔ Shader Graph trùng tên không đổi được (khác fileID) → chỉ cảnh báo; tắt tuỳ chọn → chỉ cảnh báo trùng tên / ghi đè. Thử trên cache: 16 `.shader`, Shader Graph có `m_Path` như `GAP_SG` | ✅ chờ user xem trên app |
| **Shader Mapping khi xuất** (không cần Unity): bảng ở `<project đích>/.assethub/shader-mapping.json` (commit lên Git, cả team dùng chung) — `{"mappings":[{"from":"Custom/Toon","to":"Universal Render Pipeline/Lit","props":{"_MainTex":"_BaseMap","_Color":"_BaseColor"}}]}`. `from` = tên shader, GUID, hoặc `builtin:<fileID>` (vd. `builtin:46` = Standard); `to` = tên hoặc GUID shader của project, tìm trong `Assets/`, `Packages/` và `Library/PackageCache/` (URP…). Material trong gói: đổi `m_Shader` (fileID đúng loại `.shader` / Shader Graph) + đổi tên property đã lưu; property trùng tên mới (material thường giữ cả `_MainTex` lẫn `_BaseMap`) bị thay. Báo dưới thanh Export: số material đã đổi (`from → to`), lỗi file mapping / `to` không có trong project. Chưa làm: keyword, shader nguồn vẫn đi kèm gói | ✅ chờ user xem trên app |
| ~~Unity Companion, import vào thư mục đang chọn (#11), undo ghi đè~~ — tạm hoãn: chỉ cần nếu sau này muốn chạy Render Pipeline Converter tự động | — |

## Phase 6 — Thêm loại asset ngoài FBX (Mốc C)
Mỗi loại là một `AssetTypeHandler` mới (PLAN §8d): nhận diện, preview, dependency, thông số, check. Core (catalog, tìm kiếm, GUID, xuất gói) dùng chung, không sửa. (Render pipeline & Shader Mapping cũ đã gộp vào Phase 5.)

| Loại | Preview | Dependency / thông số | State |
|---|---|---|---|
| **Texture** (png, jpg, tga, psd, gif, bmp; exr/hdr/tif liệt kê nhưng không vẽ) | Ảnh trực tiếp, nền caro / tối / sáng, vừa khung / 1:1; thumbnail lưới là chính ảnh (PSD, TGA tự giải mã) | Kích thước, dung lượng, định dạng, alpha; import settings từ `.meta` (loại, max size, override theo nền tảng, nén, mipmaps, sRGB) → **kích thước khi build**; cảnh báo playable (> 1024 px khi build, không nén, sprite bật mipmaps, > 4 MB); ✓/⚠ trên card chấm theo kích thước build; **Tải về** file ảnh (không xuất gói) | ✅ |
| **Material** (.mat) | Quả cầu / hộp / mặt phẳng three.js, gán texture theo slot + màu (`_BaseColor` / `_Color` / `_TintColor`), trong suốt / cutout, emission, độ bóng; material trong suốt (VFX) mặc định hiện trên mặt phẳng; thumbnail lưới = quả cầu | Shader (built-in theo tên / package URP / custom), texture + material cha (variant) theo GUID — dùng lại `describeMaterials`, GUID của chính `.mat` lấy từ `.meta`; panel: shader, bề mặt, màu, số texture + dung lượng, texture lớn nhất khi build, cảnh báo playable; xuất `.unitypackage` (mat + texture + shader custom) | ✅ |
| **Audio** (wav, mp3, ogg; aif / tracker liệt kê) | Phát trong app trên waveform: bấm để tua, Space phát / dừng, lặp, **Tự phát** khi chọn clip khác (nhớ giữa các lần mở); thumbnail lưới = waveform | Độ dài, kênh, sample rate gốc (đọc header WAV / OGG / MP3 vì Web Audio tự resample), import settings từ `.meta` (Load type, nén + quality, sample rate override, Force To Mono, override theo nền tảng — WebGL ưu tiên) → **dung lượng ước tính khi build**; cảnh báo playable (> 1 MB khi build, > 60 s, PCM, clip dài Decompress on load, âm ngắn stereo); card ghi độ dài + ≈ dung lượng; **Tải về** file như texture | ✅ |
| **Sprite / UI** (texture kiểu Sprite) | Trong viewer ảnh của Texture: khung từng sprite con (đánh số) + đường 9-slice, bật/tắt; nét vẽ giữ độ dày khi thu nhỏ | Từ `.meta`: chế độ (Single / Multiple / Polygon), số sprite, % sheet đã dùng (cảnh báo khi > 50% trống), Pixels per unit, viền 9-slice, packing tag; danh sách sprite (tên, kích thước, 9-slice) | ✅ chờ user xem trên app |
| **Tab Sprite**: texture có `textureType: 8` trong `.meta` — mở tab lần đầu → quét `.meta` của mọi texture (lưu theo SHA, dùng chung mọi branch, hiện dần); xem / tải như texture (khung sprite + 9-slice sẵn có). Thử trên 441 `.meta` trong cache: 71 sprite | ✅ chờ user xem trên app |
| Sprite Atlas (`.spriteatlas`) | — | 0 file ở các repo đã quét (xp_hero, luna_dino, luna_pizza) → để sau, khi có | ⏳ khi cần |
| **Prefab tĩnh** (mesh + material, không particle) | Dựng lại bằng three.js: cây transform (đổi hệ trục Unity → three), mesh từ FBX theo tỉ lệ import (UnitScaleFactor × globalScale), material + texture + màu theo GUID, prefab lồng nhau / Prefab Variant / model kéo thả (override vị trí, xoay, scale, material) tới 4 tầng; mesh khớp theo bảng tên trong `.meta` hoặc tên GameObject (chuẩn hoá, mỗi mesh một lần); thumbnail lưới; prefab UI / particle / chỉ script hiện thẻ chữ | Model, prefab lồng nhau, material (+ texture, shader), script custom, asset khác (sprite, audio, animator…) với số lần dùng; GUID của model / prefab / script / asset khác tra theo nhu cầu (gần nhất trước, đủ cả branch ở bước cuối); cảnh báo thiếu model, script custom, particle, prefab UI; xuất `.unitypackage` đủ file | ✅ chờ user xem trên app |
| **Animation clip** (`.anim`; clip trong FBX đã có từ Phase 3) | Phát trên model có rig khớp: curve vị trí / xoay / Euler / scale lấy mẫu Hermite như Unity, đổi hệ trục, tỉ lệ import; tự thử tối đa 4 model gần nhất (tên clip + thư mục, khớp ≥ 50% bone), hoặc chọn tay trong danh sách 8 model; phát / dừng, lặp, góc nhìn. **Thumbnail lưới**: model tư thế ở 40% clip (rig tự chọn, giữ 4 rig gần nhất trong bộ nhớ), mở clip / chọn rig tay thì cập nhật ảnh; clip không có rig: hình các curve + loại; card ghi độ dài. Clip Humanoid, UI, Sprite, nén: chỉ thông tin | Độ dài, frame, sample rate, loại (Generic / Humanoid / Legacy / UI / Sprite), số object, curve, key, event; cảnh báo key ở mọi frame (nên bật Keyframe Reduction); sprite / object tham chiếu được xuất kèm | ✅ chờ user xem trên app |
| **Font** (`.ttf`, `.otf`, `.ttc`) — xp_hero: 19 ttf, 6 otf | Câu mẫu bằng chính font, gõ thử, chỉnh cỡ; **ký tự font không có được tô cam** (không để trình duyệt lấy font khác che đi); lưới ký tự (300 đầu); thumbnail lưới = "Aa" (font chỉ tiếng Hàn: 가나) + tên font | Họ font, kiểu, số glyph, TrueType / CFF, dung lượng; độ phủ: Latin, tiếng Việt, Hàn, Kana, Hán, Cyrillic, Thái; từ `.meta`: chế độ ký tự (Dynamic / ASCII / tuỳ chọn), font dự phòng; ngân sách riêng **File font** (1 MB / 300 KB Meta); cảnh báo thiếu chữ tiếng Việt (liệt kê), font Hàn / Hán nặng → subset, bộ ký tự nướng sẵn; xuất `.unitypackage` (giữ GUID cho TMP), xuất theo loại vào `Fonts/`. Kiểm parser trên Arial, Georgia, Tahoma, Apple SD Gothic (.ttc, CFF, 11.172 âm tiết Hàn) | ✅ chờ user xem trên app |
| **Font TextMeshPro** (`.asset`) — hiện trong tab Font | Atlas (Alpha8 nằm trong file, hex) vẽ glyph trắng trên nền tối; thumbnail = atlas | Họ font, kiểu, cỡ gốc, số ký tự + độ phủ (Latin, Việt, Hàn…), atlas W×H, Static / Dynamic, font dự phòng; ước dung lượng build = atlas; cảnh báo Dynamic (font gốc vào build), atlas vượt ngân sách, thiếu chữ Việt; xuất kèm font dự phòng + font gốc khi Dynamic. Nhận diện **bằng nội dung** (`m_FaceInfo`) — chỉ đọc `.asset` có "SDF"/"Font" trong đường dẫn (`.asset` khác có thể rất nặng); font TMP bị đổi tên hẳn sẽ bị sót. Kiểm trên file thật BakbakOne-Regular SDF (97 ký tự, atlas 512²); `uni_shield_dir_SDF.asset` (Texture3D) bị loại đúng | ✅ chờ user xem trên app |
| Particle System prefab | → Phase 9 | | ⏳ |

Ghi chú chung:
- Tab loại asset trên sidebar sinh từ registry → thêm handler là có tab, đếm, lọc.
- Catalog Mọi branch chỉ lưu tên + path + SHA nên thêm loại không làm chỉ mục nặng đáng kể; khi lên hàng trăm nghìn file → SQLite (Phase 4.5).
- Thông số lưu theo SHA như Phase 4.6 để ranking dùng chung cho mọi loại.

## Ý đã cân nhắc nhưng không làm (2026-10-28)
| Ý | Lý do |
|---|---|
| Import thẳng vào Unity, chế độ Safe / Review Import, Companion | Hộp thoại Import Package của Unity đã xử lý trùng GUID và chọn file; app chỉ xuất `.unitypackage` kèm đủ dependency |
| Tự đổi GUID hàng loạt | Phải cập nhật mọi reference, dễ hỏng project |
| SQLite ngay từ đầu | Chỉ mục JSON hiện đủ nhanh (3,8 MB / 104 branch); chuyển khi lên hàng trăm nghìn asset |
| Thumbnail prefab do Unity Editor tạo cho MVP | Cần máy có Unity + license; để Phase 7/9 (CI render sẵn) |

## Phase 7 — Polish & mở rộng (Mốc D)
| Việc | State |
|---|---|
| Device Flow qua GitHub App cá nhân (test) | ⏳ |
| **Chỉ mục dùng chung qua thư mục** (không cần quyền admin): Cài đặt › Chỉ mục dùng chung chọn thư mục cả team dùng (ổ mạng, Google Drive…). **Ghi chỉ mục của tôi** → `AssetHubIndex/` gồm catalog mọi branch (gzip), dữ kiện theo SHA (GUID .meta, prefab → material, VFX, sprite, font TMP), thông số đo, thumbnail (+ dải frame VFX), `manifest.json` ghi cuối. Trước khi ghi luôn nhập bản đang có → không mất phần người khác. Máy khác **tự nhập** khi đăng nhập, mỗi 30 phút, khi đổi thư mục (chỉ khi `exportedAt` mới hơn lần nhập trước), hoặc bấm **Nhập ngay**. Gộp: commit chưa có + danh sách branch đọc gần hơn; thông số máy mình giữ (trừ khi gói có số đo đầy đủ hơn); thumbnail máy mình giữ, trừ card VFX kiểu cũ. Thử trên cache thật: 29 MB (thumbnail 27 MB), ghi 0,6 s, nhập 0,3 s — **tạm gác** (2026-10-30): sẽ làm bản cloud thay cho thư mục; code giữ nguyên, định dạng `AssetHubIndex/` dùng lại được | ⏸ dời sang cloud |
| Chỉ mục dùng chung bước 2: GitHub Action định kỳ quét repo, ghi cùng định dạng `AssetHubIndex/` vào repo riêng (vd. `supercent-io/asset-index`); app tải về thay cho đọc thư mục — **cần quyền admin, để sau** | ⏳ |
| Tìm bằng hình ảnh / mô tả (embedding thumbnail) — "tìm ngữ nghĩa" bước 2, sau nhóm từ khoá đã có | ⏳ |
| **Trợ lý AI tìm asset** (ý 2026-10-28): ô chat / "pet" nổi trong app; người dùng tả bằng lời ("cây tuyết low-poly dưới 5k tris, có texture") → AI dịch thành truy vấn trên chỉ mục sẵn có (tên, loại, thông số, tên clip) qua tool-calling, trả về card bấm được; về sau thêm mô tả ảnh thumbnail (vision) để tìm theo hình dạng / màu. Key API lưu trong keychain hệ điều hành, gọi từ main process; chỉ gửi tên / path / thông số, không gửi file asset | ⏳ |
| "Còn ở đâu" theo GUID (cùng asset nhưng đã sửa nội dung) | ⏳ |
| Thumbnail prefab / particle do Unity batchmode render sẵn trên CI, lưu theo SHA | ⏳ |
| **Màn đăng nhập kiểu lobby game** (prototype đã duyệt): rương trên bệ phát sáng, ngọc màu theo loại asset trôi quanh, một nút **BẮT ĐẦU**; mã một lần của gh = "mã vào phòng", cài gh = thanh loading, token = link nhỏ góc dưới; đăng nhập xong → **rương mở trong cảnh 3D** (three.js, `viewer/lobbyScene.ts`, tải riêng khi mở sảnh: rương toon có viền, nắp xoay trên bản lề, đèn trong rương, cột sáng, hạt sáng, ngọc 3D, sàn lưới) → camera bay theo đường cong vào lòng rương → chớp trắng → hub + lời chào. Đã đăng nhập sẵn: mở app là rương tự mở rồi vào hub (bấm / phím để bỏ qua); chỉ người chưa đăng nhập mới thấy nút BẮT ĐẦU. Rương tự khớp vào chỗ trống trên chữ ở mọi cỡ cửa sổ. Vừa cửa sổ 960×600; tôn trọng "giảm chuyển động". Bỏ dữ liệu mẫu (mock source, `isDemo`) | ✅ |
| **#7 Bộ sưu tập / yêu thích** (tag = bộ sưu tập: một asset nằm trong nhiều bộ): ★ trong panel chi tiết thêm vào **Yêu thích** (luôn có, không xoá được), menu "Bộ sưu tập" tick vào / ra từng bộ, tạo bộ mới ngay trong menu; card có ★; sidebar liệt kê các bộ + số asset, mở một bộ thay lưới thư mục — asset từ **mọi repo / branch** (thumbnail + thông số theo SHA, ghi chú repo · branch khi khác), bấm card mở đúng chỗ đã thêm; đổi tên / xoá bộ (xác nhận). Lưu trong settings của máy (không mất khi xoá cache); asset nhận theo repo + đường dẫn. Kèm sửa: dán link rồi Enter không còn chọn nhầm gợi ý tìm kiếm. Chưa có: chia sẻ bộ cho team (link / chỉ mục dùng chung), thêm cả bộ vào rương | ✅ |
| pHash cảnh báo texture gần giống | ⏳ |
| GitHub Actions dựng manifest + thumbnail sẵn | ⏳ |

## Phase 8 — Lên chính thức (Mốc D, làm song song được)
| Việc | State |
|---|---|
| Admin tạo GitHub App trong org (Contents/Metadata read, Device Flow) | ⏳ |
| Cài app lên các repo asset | ⏳ |
| Thay Client ID, bỏ đăng nhập bằng PAT nếu cần | ⏳ |
| Rollout cho team | ⏳ |

## Phase 9 — Particle System prefab (làm sau)
Chỉ thêm handler mới, không sửa core (PLAN §8d).

**Vì sao đáng làm (đo 2026-10-28):** xp_hero có 6.373 prefab, **~4.358 nằm trong thư mục FX / VFX / Particle** — hiện chỉ là thẻ chữ. Chia 2 bước:
- **(a) ~2–3 ngày, không cần Unity:** đọc `ParticleSystem` trong YAML prefab → cây emitter, thông số playable (max particles, số emitter, sub-emitter, texture nặng nhất, material/shader), cảnh báo; xuất đủ file.
- **(b) ~1,5–2 tuần:** preview chuyển động dựng lại bằng three.js (shape, lifetime, speed, size/color over lifetime, texture sheet) — gần đúng, đủ nhận ra hiệu ứng; hoặc Companion / CI render bằng Unity như bên dưới.
- `.vfx` (VFX Graph, 166 file): playable (Luna) không hỗ trợ → chỉ gắn nhãn, không làm preview.

| Việc | State |
|---|---|
| Đọc `ParticleSystem` + `ParticleSystemRenderer` trong YAML prefab (cả prefab lồng nhau): thời lượng, lặp, prewarm, lifetime / speed / size (cận trên của khoảng ngẫu nhiên), max particles, rate, **burst** (× số vòng), shape, chế độ render, material / trail / mesh, module tốn kém (noise, collision, trails, lights, sub emitter, texture sheet…). Kiểm trên 40 prefab FX thật (bước a) — gắn vào handler prefab sẵn có thay vì handler riêng: prefab vừa model vừa FX được cả hai | ✅ chờ user xem trên app |
| **Sửa lỗi xuất**: material của particle trước chỉ được chép file `.mat` — giờ đi qua bước đọc material như mesh → texture + shader custom vào gói; mesh của particle dạng Mesh tính là model | ✅ (có test) |
| Ước "particle cùng lúc" = rate × lifetime + burst (giới hạn bởi Max Particles); ngân sách mới **Particle (một hiệu ứng)**: 1.000 / 400 (Meta); card ghi "N particle", xếp hạng / lọc dùng chung | ✅ |
| Card + viewer prefab FX: texture của các emitter đông nhất cộng sáng (frame đầu của texture sheet) thay cho chữ "FX"; card FX cũ được vẽ lại một lần mỗi phiên | ✅ |
| Panel Particle: emitter (sắp theo số particle), shape / render / module, cảnh báo: collision, lights, noise, trails, mesh particle nhiều, prewarm, Max Particles để 1000 mặc định | ✅ |
| **Tab VFX**: prefab là hiệu ứng — **root là ParticleSystem**, hoặc **chỉ gồm particle** (không MeshRenderer, không model / prefab lồng) — hoặc **variant** của một hiệu ứng. Model gắn kèm FX (vd. `CuttingMachine.prefab`: máy + tia lửa cưa) và prefab chỉ *chứa* FX (`Additive GameObjects.prefab`) **không** tính; không đoán theo tên thư mục. Mở tab lần đầu trên một branch → quét nội dung mọi prefab (git hàng loạt, khối 24 MB, có tiến độ), lưu theo SHA dùng chung mọi branch → lần sau tức thì. Trên 393 prefab trong cache: 101 có particle, 10 variant | ✅ chờ user xem trên app |
| **Preview chuyển động bằng three.js** (bước b, không cần Unity): main module (duration, loop, prewarm, delay, lifetime / speed / size / rotation / color theo MinMaxCurve – MinMaxGradient như Unity), emission (rate + burst nhiều vòng), shape (sphere, hemisphere, cone, cone volume, box, circle, edge, rectangle; mesh/sprite ≈ sphere), gravity, velocity / force / limit velocity, color / size / rotation over lifetime, texture sheet, noise (gần đúng); billboard, stretched, horizontal, vertical (mesh → billboard); blend cộng sáng / alpha / nhân theo material; scale theo cây transform; nút Phát/Dừng, Phát lại, Lặp, 0,25× / 0,5× / 1×; camera căn theo vùng particle bay; thumbnail chụp lúc hiệu ứng đông nhất. Chưa: collision, lights, trail dạng ribbon, shader custom (dùng texture chính + màu) | ✅ chờ user xem trên app |
| **Sub emitter** (birth / death; collision coi như death vì preview không có va chạm): emitter con chỉ phát tại particle cha — burst khi sinh / chết, rate khi cha còn sống; kế thừa màu, size; tìm đúng emitter con dưới object cha khi prefab lồng nhiều lần | ✅ chờ user xem trên app |
| **Trail** (chế độ Particles): mỗi particle giữ 10 điểm (cách nhau ≥ minVertexDistance), quad nối các điểm hướng về camera; độ rộng theo widthOverTrail (× size nếu bật), màu colorOverTrail × colorOverLifetime (× màu particle nếu bật), mờ dần về cuối; material trail riêng; tối đa 600 trail / emitter | ✅ chờ user xem trên app |
| **Particle dạng mesh**: mesh FBX thật (tỉ lệ import như prefab), `InstancedMesh`, texture + blend của material; mờ dần bằng tối màu (không có alpha theo từng hạt) | ✅ chờ user xem trên app |
| **Thumbnail VFX động**: render nền 16 frame suốt hiệu ứng (one-shot: từ đầu tới tắt, tối đa 4 s; loop: 1 chu kỳ sau khi đầy, tối đa 3 s), lưu 1 sheet 4×4 (`<sha>.fx`); card hiện frame đông particle nhất, **rê chuột thì chạy**. Card kiểu cũ (texture chồng nhau / 1 frame) có `fxThumb` cũ → tự vẽ lại nền một lần, không cần mở preview. Mở preview không còn ghi đè card bằng 1 frame. Camera căn theo vùng hạt bay thật (đo khi chạy thử) | ✅ user xác nhận 2026-10-29 |
| **Sửa preview VFX** (FX_Unlock, Fire_effect — đã chụp app để kiểm): blend **premultiply** giờ nhân màu với alpha như Unity (trước: đĩa màu viền cứng, cộng thành khối trắng); chấm tròn mặc định mờ dần thật (`smoothstep` đảo cạnh là hành vi không xác định → đĩa cứng trên GPU Mac); **mesh có sẵn của Unity** (Quad, Cube, Sphere, Cylinder, Capsule, Plane) cho particle dạng mesh thay vì billboard to phủ màn hình; khung camera tính **theo từng emitter** (vài particle lớn như glow / khung đất không bị trăm tia lửa át đi); blend lấy từ shader particle cũ có sẵn của Unity / lệnh `Blend` trong shader custom; slot `_MainTex` là texture có sẵn của Unity → không lấy nhầm `_Noise`. Shader custom vẽ lửa bằng noise chỉ gần đúng (quầng mềm) | ✅ |
| **Sửa preview VFX đợt 2** (Crystals crossfade, Snow AOE, FX_SizeUp, FX_TreeSmoke — đã chụp app để kiểm): **Alpha Source** của texture (From Gray Scale → alpha từ trung bình RGB; None → đục) áp cho mọi chỗ nạp texture (particle, model, prefab, viewer ảnh, card; panel ghi rõ nguồn alpha); billboard **Render Alignment Local / World** vẽ thành quad theo trục emitter (World bù phép xoay của emitter); **xoay 3D theo từng particle** (start X/Y ngẫu nhiên, Rotation over Lifetime theo trục) cho cả quad và mesh; **mesh đúng trong FBX nhiều mesh**: fileID = xxHash64("Type:Mesh->" + tên + chỉ số) — dùng cho particle mesh và prefab tĩnh (trước: đoán theo tên); **slot texture theo shader**: đọc slot mà `.shader` / Shader Graph khai báo, không có thì `_MainTex` trước cho shader có sẵn / viết code, `_BaseMap` trước cho URP / Shader Graph. Shader Graph từ package (không có trong repo) vẫn phải đoán; **kích thước theo trục** (3D Start Size, Size over Lifetime "Separate Axes") cho quad và mesh — tia sáng / chữ không còn bị vẽ vuông (levelup_Player); **alpha theo từng particle dạng mesh** (trước chỉ làm tối màu → mesh alpha blend thành đục, vd. quả cầu Magic shield che hết particle) | ✅ |
| **Check script thiếu**: script `.cs` trong repo đã được xuất kèm (cảnh báo `customScript` có từ Phase 6). Thêm: script **từ package** (không có trong repo) được ghi lại khi tìm dependency; khi xuất có project đích, so GUID với `Assets/` + `.cs` / `.dll` trong `Packages/` và `Library/PackageCache/` → "⚠ N asset dùng script từ package mà project chưa có (Missing Script)". Chỉ so khi project đã mở bằng Unity ít nhất một lần (có `Library/PackageCache`), tránh báo nhầm | ✅ chờ user xem trên app |
| ~~Companion `renderPreview` (Unity render GIF/WebM)~~ — bỏ: user chọn preview three.js, không qua Unity | — |
| ~~CI batchmode render preview sẵn~~ — bỏ (như trên) | — |
| Tab VFX trong UI (sinh từ registry) | ✅ |
| Xuất particle prefab bằng cùng cơ chế `.unitypackage` (Phase 4), kèm texture + shader của material particle | ✅ |
| (Sau nữa) VFX Graph | ⏳ |

---

## Phase 10 — Phát hành (làm cuối cùng, Mốc E)
Trong lúc còn phát triển và test, chạy bằng `npm run dev`. Icon app đã có sẵn ở `build/` (svg, png, icns).

| Việc | State |
|---|---|
| `electron-builder`: `.dmg` cho Apple Silicon + Intel, ad-hoc sign | ⏳ |
| Giảm dung lượng gói: chỉ giữ locale Electron en / vi / ko (`electronLanguages`), font chỉ `.woff2` | ⏳ |
| Hướng dẫn mở app chưa ký lần đầu (Gatekeeper) cho người không rành kỹ thuật | ⏳ |
| Code signing + notarize (cần Apple Developer ID của công ty) | ⏳ |
| Windows installer (nếu team cần) | ⏳ |
| Tự cập nhật (GitHub Releases) | ⏳ |

---

## Nhật ký
| Ngày | Thay đổi |
|---|---|
| 2026-10-29 | **VFX: nút + Play (spam như Unity)** — mỗi lần bấm (hoặc phím Space khi viewer đang chọn) phát thêm một lượt chồng lên lượt đang chạy, như spawn prefab lần nữa: mỗi emitter một bản sao dùng chung texture / mesh / material, sub emitter nối trong cùng lượt, hệ loop chỉ phát 1 chu kỳ, xong thì tự huỷ, tối đa 12 lượt cùng lúc; Restart xoá các lượt bắn. **Sửa nhãn nút** hiện nguyên key (`particles.play`, `pause`, `restart`, `loop`): key chưa có trong file ngôn ngữ; thêm test quét code để mọi key gọi trong code đều có bản dịch. 179 test. |
| 2026-10-29 | **Mở prefab / VFX lần sau nhanh hơn**: file text (prefab, material, `.meta`, controller…) trước đây luôn đọc lại qua GraphQL mỗi lần mở; giờ lưu vào cache blob theo SHA (dùng chung mọi branch) → mở lại không gọi mạng cho text. **VFX tự phát khi hiện**: trước đó hiệu ứng chạy ngầm dưới lớp "Putting the prefab together…" (chờ texture) nên one-shot đã hết khi hiện ra; giờ phát lại từ đầu lúc hiện, nút **Play** phát lại từ đầu ngay. **Tên app khi dev**: `scripts/dev-app-name.mjs` (predev + postinstall) đổi `CFBundleName` của Electron.app trong `node_modules` → menu bar / Dock ghi "Asset Hub" (bản đóng gói đặt tên ở Phase 10). 175 test. |
| 2026-10-29 | **Sửa lỗi model vô hình khi texture không tìm thấy** (vd. `Customer_Run.anim`: rig `Customer_Red.fbx` khớp 100% bone nhưng thumbnail / viewer trống). Texture thiếu được thay bằng PNG 1×1 **trong suốt** → material nhân ra đen trong suốt, model biến mất; giờ dùng PNG **trắng** (`BLANK_TEXTURE`) → hiện màu material / vertex color. Kiểm bằng render thật (Electron ẩn): 0 → ~8.800 pixel. Ảnh hưởng cả rig animation, model FBX, prefab (đo trên cache: 15/76 thumbnail clip, 4/68 thumbnail model trống). Card model / prefab có `modelThumb` 2, clip `animThumb` 4 → vẽ lại một lần; phiên bản card gộp chung (`CARD_VERSIONS`) cho merge thông số và chỉ mục dùng chung. 174 test. |
| 2026-10-29 | **Animation: tìm rig theo Animator Controller** — đọc ~24 `.controller` gần clip nhất (nhớ theo commit), controller nào chứa GUID của clip thì model cùng tên controller được thử đầu tiên (`Stack_Idle` ∈ `Customer.controller` → `Customer_Red.fbx`; trước đó không có gợi ý nào). **Ẩn clip không tìm thấy model** khỏi tab Animation / All (khai báo `unlisted` trong handler, thumbnail ghi `rigged`); dòng trạng thái có nút "Đã ẩn N clip — hiện". Card clip vẽ lại một lần (`animThumb` 3). 172 test. |
| 2026-10-29 | **Sửa lỗi animation không hiện** (vd. `Customer_Idle.anim` ở xp_hero NetCatch): project xếp theo tên game (`Animations/ASMR-Fish/…`, `Models/ASMR-Fish/…`) nên thư mục clip không nói nhân vật, tên nhân vật chỉ có trong tên file — trước đây tên file chỉ coi là động tác → `Customer_Red.fbx` / `Customer.fbx` không vào danh sách rig, chỉ thử model cá (0% bone). Giờ chữ trong tên clip không phải động tác (Idle, Run, Attack…) chọn thêm model cùng tên, chèn vào lượt thử 2–3; ứng viên đầu giữ nguyên (so trên 2.228 clip thật của 2 commit: 0 clip đổi ứng viên đầu). Card clip vẽ lại một lần (`animThumb` 2). 171 test. |
| 2026-10-29 | **Phase 7 — Chỉ mục dùng chung qua thư mục** (làm local trước, phần cần admin để sau): xuất / nhập catalog + dữ kiện + thông số + thumbnail qua thư mục chung, tự nhập khi có bản mới. Sửa: gói tạo cho bộ loại asset khác vẫn nhập thumbnail / thông số / dữ kiện (chỉ bỏ catalog). 170 test. |
| 2026-10-29 | User xác nhận trên app: thumbnail VFX động, khung camera VFX, tối ưu cache / tốc độ tải. |
| 2026-10-29 | **VFX căn camera theo vùng hạt thật sự bay** (trước: theo tầm bay ước tính tốc độ × thời gian sống, toả đều mọi hướng → zoom quá xa): chạy thử hiệu ứng 1 lượt không vẽ, lấy hộp chứa 96% vị trí hạt mỗi trục + nửa cỡ hạt; dùng cho cả preview lẫn thumbnail. Card VFX vẽ lại một lần (`FX_THUMB_VERSION` 2). 165 test. |
| 2026-10-29 | **Tối ưu cache + tốc độ tải** (đo trước: cache 1,7 GB, `blobs` 1,3 GB không bao giờ xoá). (1) **Giới hạn cache** file đã tải (mặc định 2 GB; 1 / 2 / 5 / 10 GB / không giới hạn trong Cài đặt): vượt thì xoá file lâu không dùng nhất trước (đánh dấu khi đọc), kiểm sau mỗi 200 MB tải + lúc mở app; thumbnail, thông số, clone git không bị xoá; Cài đặt hiện dung lượng + nút **Xoá file đã tải**. (2) **Cache tree / GUID nén gzip**: 14,1 MB → 2,2 MB, đọc chậm thêm ~11 ms; file `.json` cũ tự chuyển khi đọc. (3) Tự dọn thư mục phiên bản cũ (`prefabfx`, `prefabfx2`) + file `.tmp` sót. (4) **Thumbnail qua giao thức `assethub-thumb://`**: lưu ảnh nhị phân (nhỏ hơn base64 ~25%), mở branch chỉ trả danh sách URL thay vì đẩy toàn bộ ảnh (19 MB) qua IPC, ảnh tải khi card hiện; thumbnail cũ tự chuyển. (5) **Tách bundle**: viewer + three.js tải khi cần, bundle khởi động 1,9 MB → 681 KB. 163 test. |
| 2026-10-29 | **Phase 4 xong** (import `.unitypackage` trong Unity OK). **Thumbnail VFX động**: tự render nền, card = frame đông nhất, rê chuột chạy 16 frame cả hiệu ứng; card VFX cũ tự vẽ lại. Bỏ code card ghép texture không còn dùng. 150 test. |
| 2026-10-29 | **Kiểm tra playable thành tuỳ chọn, mặc định tắt** (bỏ cảnh báo kiểu "texture 2.048 px vượt 1.024 px", bỏ lọc / sắp xếp theo ngân sách khi tắt). **Deep link** `assethub://` + Copy link + dán link vào ô tìm kiếm (Phase 4 #10). |
| 2026-10-28 | **Phase 5 — So với project đích**: chọn project Unity (chỉ đọc); khi xuất bỏ file đã có, **dùng lại file giống hệt khác GUID** (đổi tham chiếu, không thêm bản trùng), báo trước file bị ghi đè / đổi tên, cảnh báo khác URP. 146 test. |
| 2026-10-28 | **Phase 6 xong**: tab Sprite (quét `.meta` texture), font TextMeshPro trong tab Font (atlas, ký tự, độ phủ, Static/Dynamic). Cơ chế quét theo nội dung dùng chung cho VFX / Sprite / TMP (`knownAssets`, lưu theo SHA, hiện dần); loại asset ẩn (`hidden`) cho file chỉ hiện qua tab khác. 140 test. |
| 2026-10-28 | **Phase 9 xong phần chính**: sub emitter (birth / death), trail, particle dạng mesh trong preview three.js. 137 test (có test mô phỏng không cần WebGL). |
| 2026-10-28 | **Phase 9 bước (b) — particle chạy bằng three.js** ngay trong app; **tab VFX** chỉ còn prefab tự có ParticleSystem hoặc variant (sửa lỗi `Additive GameObjects.prefab` chỉ chứa FX bị tính là VFX). 134 test. |
| 2026-10-28 | **Phase 9 bước (a) — Particle**: đọc particle system trong prefab, ước số particle cùng lúc, ngân sách Particle, card bằng texture emitter, panel emitter + cảnh báo. **Sửa lỗi** xuất prefab FX thiếu texture / shader của material particle. 127 test. |
| 2026-10-28 | **Phase 6 — Font xong** (chờ xem trên app): handler `.ttf/.otf/.ttc` (tab Font tự sinh), bộ đọc sfnt tự viết (name, maxp, cmap 4/12, .ttc), câu mẫu đánh dấu ký tự thiếu, lưới ký tự, độ phủ 7 hệ chữ, cài đặt import từ `.meta`, ngân sách File font, thumbnail "Aa"; xuất theo loại vào `Fonts/`. Ghi chú Phase 9 Particle (2 bước) + ý **trợ lý AI tìm asset** (Phase 7). |
| 2026-10-28 | **Xuất theo loại**: kiểu đường dẫn mới `Assets/AssetHub/Prefabs`, `Models`, `Materials`, `Textures`… Lưu ý: tránh trùng **đường dẫn**, còn trùng **GUID** Unity vốn tự cập nhật bản cũ tại chỗ; trùng nội dung khác GUID cần Phase 5. |
| 2026-10-28 | **Dung lượng gồm dependency ngay trên card**: thumbnail FBX đọc thêm `.mat` (kiểu A) → card có màu/texture thật và MB texture đủ, không cần mở model; FBX đã đo trước đó được đo lại nền một lần. |
| 2026-10-28 | **Preset ngân sách playable**: 5 MB (Google, AppLovin, Unity…) / 2 MB (Meta) / Tuỳ chỉnh từng giới hạn (tris, cỡ texture, MB texture, MB model, bone, KB audio, giây audio). Đổi ở Cài đặt hoặc cạnh ô sắp xếp; card, lọc, xếp hạng, panel đổi theo ngay. |
| 2026-10-28 | **Chọn rig cho animation chính xác hơn**: thư mục chứa clip = nhân vật (trọng số cao), tên clip = hành động (gần như không tính) → clip vũ khí của player ra `player.fbx` (87–91% bone) thay vì cây đũa phép; danh sách chỉ còn model liên quan (bỏ model đã thử 0% bone); thêm "Model khác…" tìm trong mọi FBX; lựa chọn tay được nhớ theo thư mục clip (dùng cho cả thumbnail các clip cùng thư mục). |
| 2026-10-28 | **Animation gắn với FBX**: tab Animation liệt kê cả FBX chứa clip (đã đo) hoặc tên dạng `Model@Clip.fbx` — handler khai báo `alsoShows`, UI không biết riêng FBX; tên clip lưu cùng thông số theo SHA và **tìm kiếm khớp tên clip** ("attack" ra Goblin.fbx có clip Goblin_Attack); card FBX có huy hiệu **▶ N** (rê chuột xem tên clip); mở FBX từ tab Animation thì tự phát clip đầu. FBX đo từ trước được render lại nền một lần để lấy tên clip. |
| 2026-10-28 | Thumbnail cho animation clip: model ở tư thế giữa clip trên rig tự chọn (clip không có rig: vẽ curve), card ghi độ dài; mở clip hoặc chọn rig khác thì thumbnail cập nhật theo. Rig đã đọc được giữ lại cho các clip cùng nhân vật. |
| 2026-10-28 | **Phase 6 — Animation clip xong** (chờ xem trên app): handler `.anim`, parser curve + nội suy Hermite, phát trên rig tự chọn. Kiểm trên 10 clip thật: DarkWizard / Ballista khớp 100% ở ứng viên đầu, Goblin 59% (đúng model); clip vũ khí của player chưa tìm đúng rig tự động (chọn tay). 109 test. |
| 2026-10-28 | **Phase 6 — Prefab tĩnh xong** (chờ xem trên app): handler `.prefab`, resolver đệ quy (model, prefab lồng nhau, material, script, asset khác) với tra GUID theo nhu cầu cho các loại chỉ mục chưa có; preview ghép mesh FBX theo cây transform + material; thumbnail. Unity 2022 không ghi tên mesh trong `.meta` (fileID là mã băm) → khớp theo tên GameObject; kiểm trên 28 prefab thật (kích thước đúng, mỗi node đúng mesh). 105 test. |
| 2026-10-28 | **Phase 6 — Sprite xong** (chờ xem trên app): texture kiểu Sprite hiện khung sprite con + 9-slice trên ảnh, phần Sprite trong panel (chế độ, số sprite, % sheet dùng, PPU, viền, danh sách). Parser kiểm trên 49 `.meta` thật (sheet 14 và 4 sprite, 7 ảnh 9-slice). 101 test. |
| 2026-10-28 | Lưới: hiện **đã tải X/Y** (thumbnail sẵn sàng / card có thể có thumbnail) cạnh số asset, có thanh tiến độ; thumbnail **tải nền hết danh sách** sau khi xong card trên màn hình (4 card / lượt, từ trên xuống, nhường khi đang mở file, bỏ qua card vừa lỗi). |
| 2026-10-28 | **Phase 6 — Audio xong**: handler audio (tab Audio tự sinh, xp_hero @ net-catch: 249 clip), player + waveform, panel Audio với import settings và dung lượng ước tính khi build, cảnh báo playable riêng cho audio (không dùng ngân sách file model), xếp hạng dùng chung, Tải về. Resolver "file + .meta" tách thành `resolveSelf` dùng chung cho texture + audio. Header khớp `afinfo` trên 10 file thật; parser `.meta` kiểm trên 12 file thật. 98 test. |
| 2026-10-28 | **Phase 6 — Material xong**: handler `.mat` (tab Material tự sinh, xp_hero @ net-catch: 2.578 file), preview quả cầu / hộp / mặt phẳng với texture + màu + trong suốt / cutout + emission, thumbnail lưới, panel Material (shader, bề mặt, màu, texture, cảnh báo playable), xếp hạng dùng chung (card ghi "N texture" thay cho tris), xuất gói kèm texture + shader custom. Kiểm parser trên 40 `.mat` thật (URP, built-in, particle, Unity 5). 91 test. |
| 2026-10-27 | Khởi tạo project, viết PLAN + ROADMAP. |
| 2026-10-27 | Thêm prototype UI 3 màn hình trên canvas. |
| 2026-10-27 | Duyệt thiết kế UI; thêm song ngữ EN (mặc định) / VI. Ghi thiết kế vào PLAN §8b. |
| 2026-10-27 | Chốt tính năng bổ sung (PLAN §8c), kiến trúc handler mở rộng (PLAN §8d), thêm phase Particle. |
| 2026-10-27 | Đưa toàn bộ plan + roadmap lên canvas prototype. |
| 2026-10-27 | Chốt Import Profile và xử lý shader (PLAN §6b); thêm màn Import Profile. |
| 2026-10-27 | **Chia lại phase theo mốc**: A Asset Browser (1–3) → B Import (4–5) → C Shader (6) → D Mở rộng (7–9). Spike gộp vào Phase 2. |
| 2026-10-28 | Texture: thay Xuất gói / Thêm vào gói bằng nút **Tải về** (lưu file ảnh gốc, LFS lấy nội dung thật, có "Mở trong Finder") — cả ở Mọi branch. Handler khai báo cách giao: `delivery: 'file' \| 'unitypackage'`. |
| 2026-10-28 | **Phase 6 — Texture xong**: handler mới (tab Texture tự sinh từ registry, xp_hero @ net-catch: 1.375 texture), thumbnail = chính ảnh, panel ảnh + import settings + kích thước khi build + cảnh báo playable, xếp hạng / lọc dùng chung, xuất gói file + `.meta` (không chờ chỉ mục GUID). Chỉ mục Mọi branch ghi kèm danh sách loại asset → tự quét lại một lần khi thêm loại. |
| 2026-10-28 | **Phase 4.6 xong (phần chính)**: thông số model lưu theo SHA khi tạo thumbnail / mở model; card có ✓/⚠ + tris; sắp xếp Hợp playable nhất / Nhẹ nhất / Ít tris / Dùng nhiều nhất (giữ mức khớp tìm kiếm trước); lọc vừa ngân sách; nút Đo N kết quả; Mở trên GitHub; xuất gói ngay từ kết quả Mọi branch. Kịch bản demo: tìm "fish" trên 104 branch → đo 75 kết quả 44 s → chọn → xuất 1 click. |
| 2026-10-28 | Ghi nhận góp ý: thêm **Phase 4.6 Playable-aware ranking** (làm tiếp), Phase 6 đổi thành **Thêm loại asset** (Texture ưu tiên 1, Material, Audio, Sprite/UI, Prefab tĩnh, Animation clip), mục "Ý đã cân nhắc nhưng không làm". |
| 2026-10-28 | **Mở file nhanh, tải từng phần**: đo bằng `ASSETHUB_TRACE=1` → chậm do phải dựng chỉ mục GUID cả branch (31–186 s) trước khi trả dependency. Giờ: (1) hiện ngay những gì đã biết (~2–4 s), dòng chưa rõ ghi "đang kiểm tra…"; (2) tra GUID theo nhu cầu qua GraphQL — đoán theo tên material trước, rồi thư mục gần nhất, theo loại file (.mat / texture / shader), song song; (3) chỉ mục đầy đủ dựng nền ngay khi mở branch. Lần đầu tuyệt đối (cache trống): 186 s → hiện sau 3,8 s, đủ sau 18 s; branch đã học: ~2 s. Prefab không tự tải nữa: chỉ báo "dùng trong N prefab đã biết" + nút tải. Thumbnail đọc file ở chế độ nền (nhường file đang mở). |
| 2026-10-28 | **Phase 4.5 xong**: tìm trên Mọi branch / Mọi repo. Chỉ mục nền gộp theo SHA; 104 branch của xp_hero: 6.947 FBX trong 200 s lần đầu, ~3 s các lần sau. Cây quá lớn (truncated) tải gộp nhiều commit trong 1 lần git, dùng repo cache riêng để không chặn việc đang xem. Ưu tiên tải thứ đang chọn: quét nền + thumbnail tạm dừng khi model đang mở còn tải; thumbnail render từ trên xuống theo lưới (cả kết quả ở branch khác); lọc theo repo / branch; "Cũng có ở N branch khác" + bấm để mở. Đóng gói `.dmg` dời về Phase 10 (cuối). |
| 2026-10-28 | Gọn panel chi tiết: bỏ Storage / Blob SHA / Size / badge kiểu material / dòng "import would copy"; ẩn shader built-in & package (Unity có sẵn); gộp texture dùng cho nhiều slot thành 1 dòng; ẩn thông số = 0 (bones, clips) hoặc 1 mesh; gộp cảnh báo ngân sách thành 1 ô; bỏ cảnh báo "thiếu texture/material" trùng với dòng "not in repo"; đường dẫn + nút Copy cùng 1 hàng. |
| 2026-10-28 | **Tìm kiếm thông minh**: gõ nhóm từ khoá ra cả tên thành viên (fish → Kraken, Octopus, Tuna; weapon → Sword, Ballista…), hiểu tiếng Việt có/không dấu (cá, cây, cá mập), sửa lỗi chính tả (buliding → Building, wolf ↔ Wlof), số nhiều, tên thư mục; ô gợi ý từ khoá kèm số kết quả (↑↓ Enter). Bộ từ khoá ở `src/core/search/concepts.ts`, thêm từ không cần sửa code khác. |
| 2026-10-28 | **Rà soát trước khi đóng gói** (review độc lập, 14 lỗi): file tạm cache trùng tên khi ghi song song; nhận LFS pointer kể cả khi thiếu `.gitattributes`; không cache kết quả đọc lỗi (GUID, prefab) và text GraphQL bị cắt; material variant (`m_Parent`) + `#include` shader / Shader Graph sub-graph vào gói; `.mat` kiểu Unity 5 + CRLF; git chạy tuần tự theo repo, `ls-tree -z` (tên file tiếng Việt/Unicode); progress index báo cho mọi màn chờ; khôi phục offline thử lại, nhận diện rate-limit; chặn điều hướng khi kéo-thả file vào cửa sổ, chỉ 1 instance; bỏ kết quả tìm prefab cũ khi đổi FBX; xoá gói khi đổi project; không đọc branch cũ khi đổi repo; giải phóng texture/blob URL của viewer; thumbnail lỗi thử lại sau 2 phút, chờ cache thumbnail trước khi render, bỏ qua FBX > 40 MB; nén gói bất đồng bộ (không đơ cửa sổ). |
| 2026-10-28 | Material từ prefab: Fish_Tuna_A.fbx không có material — được gán ở FishModel.prefab. Thêm nút tìm material trong prefab (1,8 s), preview + export dùng material đó. Sửa tên material URP và ưu tiên `_BaseMap` hơn `_MainTex`. |
| 2026-10-28 | Thumbnail tự tạo chạy nền + nạp dần, gộp file giống hệt, phím mũi tên. Sửa mất cache khi mở lại app (trùng thư mục `Cache` của Chromium). |
| 2026-10-27 | Chỉ mục GUID nhanh hơn ~13 lần: git fetch một lần + cache GUID theo SHA `.meta`. Không gọi git trên macOS khi chưa có Command Line Tools. |
| 2026-10-27 | **Phase 4 (phần app) xong**: xuất `.unitypackage` 1 model hoặc cả gói, preview PNG, 2 layout đường dẫn, bỏ texture theo tên. Test gói Short_Wood + Snow_Tree: 5 asset, GUID/pathname/tham chiếu đúng. Còn: test import trong Unity, deep link. |
| 2026-10-27 | **Không import trong app**: Phase 4 chỉ còn xuất `.unitypackage`; bỏ copy vào project, review import, lịch sử/undo; Phase 5 + 6 gộp thành phase tuỳ chọn (so với project đích chỉ đọc, chỉnh `.mat` khi xuất); Companion tạm hoãn. |
| 2026-10-27 | Thêm xuất `.unitypackage` vào Phase 4 (ưu tiên), thêm Phase 4.5 tìm asset mọi branch / mọi repo; chỉ mục dùng chung + tìm bằng hình vào Phase 7; particle xuất bằng `.unitypackage`. |
| 2026-10-27 | **Phase 3 xong** — Mốc A đạt: xem FBX 3D (xoay/zoom/pan, góc nhìn, wireframe, animation), dependency kiểu A/B, thông số + ngân sách playable, thumbnail. Test trên Short_Wood (A), LogPlatform (thiếu material), Snow_Tree (B), TF_Player_Throw (animation). |
| 2026-10-27 | Sửa: nhớ branch (do app dev chạy main process cũ — `npm run dev` giờ dùng `--watch`); app tự cài gh, không cần Terminal; tương thích câu chữ mới của gh 2.103. |
| 2026-10-27 | **Phase 2 xong**: test end-to-end với tài khoản thật trên `hb_creative_xp_hero @ vn/net-catch` — 747 FBX, cache hoạt động. Thêm đăng nhập gh qua trình duyệt ngay trong app. |
| 2026-10-27 | **Phase 2 code xong**: đăng nhập gh/PAT, list repo/branch, Trees API + LFS + fallback git, dò Unity root, thư mục loại trừ. 26 unit test + smoke test qua. Spike repo thật → PLAN §11. Còn: test end-to-end với tài khoản thật. |
| 2026-10-27 | **Phase 1 xong**: app Electron chạy với dữ liệu mẫu (Sign in, Browse, Settings, EN/VI). Typecheck, 11 unit test, smoke test đều qua. |
