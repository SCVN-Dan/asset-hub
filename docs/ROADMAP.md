# Asset Hub — Roadmap

- Cập nhật: 2026-10-28
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
| **B · Xuất** | 4 | Xuất `.unitypackage` (import làm trong Unity) | ~3–4 ngày | 🔄 xong phần app, chờ test trong Unity |
| B | 4.5 | Tìm asset trên mọi branch / mọi repo (chỉ mục cục bộ) | ~1 tuần | ✅ (còn SQLite khi dữ liệu lớn) |
| B | 4.6 | **Playable-aware ranking**: thông số model lưu theo SHA, huy hiệu trên card, sắp xếp / lọc theo ngân sách playable | ~2–3 ngày | ✅ (còn dung lượng gồm dependency) |
| **C · Kiểm tra (tuỳ chọn)** | 5 | So với project đích (chỉ đọc) + chỉnh shader khi xuất | ~1 tuần | ⏳ ưu tiên thấp |
| C | 6 | **Thêm loại asset**: Texture, Material, Audio, Sprite/UI, Prefab (tĩnh), Animation clip — mỗi loại một handler | ~1–2 tuần | ✅ (chờ xem Prefab + Animation trên app; còn Sprite Atlas, tab Sprite) |
| **D · Mở rộng** | 7 | Polish & mở rộng (chỉ mục dùng chung cho team, tìm bằng hình, tag, audio/sprite…) | tuỳ nhu cầu | ⏳ |
| D | 8 | Lên chính thức (GitHub App org) | phụ thuộc admin | ⏳ (làm song song được) |
| D | 9 | Particle System prefab (làm sau) | 2–3 tuần | ⏳ |
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
| Xuất 1 asset hoặc nhiều asset (gói) — gộp dependency, mỗi GUID một bản | ✅ |
| Thumbnail đã render làm `preview.png` (PNG 128×128) | ✅ |
| Tóm tắt trước khi xuất: số file, dung lượng, thiếu, ghép theo tên | ✅ |
| Tuỳ chọn bỏ texture ghép theo tên khỏi gói | ✅ |
| Chọn nơi lưu, mở thư mục sau khi xuất; báo file bị bỏ (thiếu `.meta` / trùng GUID) | ✅ |
| Test gói: GUID khớp `.meta`, `pathname` đúng, texture của `.mat` có trong gói (kiểm tra bằng `tar`) | ✅ |
| Test import trong Unity (Assets › Import Package › Custom Package) | ⏳ chờ user |
| #10 Deep link `assethub://` + nút Copy link | ⏳ |
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
| Dung lượng gồm cả dependency (texture của .mat) — hiện đo đủ khi mở model; thumbnail chỉ tính texture nêu trong FBX | 🟡 |
| Nút "Mở trên GitHub" cho file đang xem | ✅ |
| Xuất `.unitypackage` ngay từ kết quả Mọi branch / Mọi repo (không phải chuyển branch) | ✅ |
| Preset ngân sách: Network 5 MB (mặc định) / Network 2 MB (Meta) / Tuỳ chỉnh — chọn trong Cài đặt hoặc ngay cạnh ô sắp xếp; mọi ✓/⚠, lọc, xếp hạng, cảnh báo trong panel đổi theo ngay (thông số đo không phụ thuộc ngân sách) | ✅ |

## Phase 5 — (Tuỳ chọn, ưu tiên thấp) So với project đích + shader khi xuất (Mốc C)
Chỉ làm khi cần. Unity tự xử lý import; phần này giúp biết trước những gì Unity sẽ ghi đè hoặc thiếu.

| Việc | State |
|---|---|
| Chọn project Unity trên máy (chỉ đọc) → đánh dấu asset đã có cùng GUID (Unity sẽ ghi đè khi import) | ⏳ |
| Cảnh báo shader: so phiên bản URP (`packages-lock.json`) nguồn ↔ đích; shader custom chưa có trong đích; trùng tên shader | ⏳ |
| Chỉnh `.mat` khi xuất (Shader Mapping đơn giản): đổi shader GUID + tên property theo bảng mapping — không cần Unity | ⏳ |
| ~~Unity Companion, import vào thư mục đang chọn (#11), undo ghi đè~~ — tạm hoãn: chỉ cần nếu sau này muốn chạy Render Pipeline Converter tự động | — |

## Phase 6 — Thêm loại asset ngoài FBX (Mốc C)
Mỗi loại là một `AssetTypeHandler` mới (PLAN §8d): nhận diện, preview, dependency, thông số, check. Core (catalog, tìm kiếm, GUID, xuất gói) dùng chung, không sửa. (Render pipeline & Shader Mapping cũ đã gộp vào Phase 5.)

| Loại | Preview | Dependency / thông số | State |
|---|---|---|---|
| **Texture** (png, jpg, tga, psd, gif, bmp; exr/hdr/tif liệt kê nhưng không vẽ) | Ảnh trực tiếp, nền caro / tối / sáng, vừa khung / 1:1; thumbnail lưới là chính ảnh (PSD, TGA tự giải mã) | Kích thước, dung lượng, định dạng, alpha; import settings từ `.meta` (loại, max size, override theo nền tảng, nén, mipmaps, sRGB) → **kích thước khi build**; cảnh báo playable (> 1024 px khi build, không nén, sprite bật mipmaps, > 4 MB); ✓/⚠ trên card chấm theo kích thước build; **Tải về** file ảnh (không xuất gói) | ✅ |
| **Material** (.mat) | Quả cầu / hộp / mặt phẳng three.js, gán texture theo slot + màu (`_BaseColor` / `_Color` / `_TintColor`), trong suốt / cutout, emission, độ bóng; material trong suốt (VFX) mặc định hiện trên mặt phẳng; thumbnail lưới = quả cầu | Shader (built-in theo tên / package URP / custom), texture + material cha (variant) theo GUID — dùng lại `describeMaterials`, GUID của chính `.mat` lấy từ `.meta`; panel: shader, bề mặt, màu, số texture + dung lượng, texture lớn nhất khi build, cảnh báo playable; xuất `.unitypackage` (mat + texture + shader custom) | ✅ |
| **Audio** (wav, mp3, ogg; aif / tracker liệt kê) | Phát trong app trên waveform: bấm để tua, Space phát / dừng, lặp, **Tự phát** khi chọn clip khác (nhớ giữa các lần mở); thumbnail lưới = waveform | Độ dài, kênh, sample rate gốc (đọc header WAV / OGG / MP3 vì Web Audio tự resample), import settings từ `.meta` (Load type, nén + quality, sample rate override, Force To Mono, override theo nền tảng — WebGL ưu tiên) → **dung lượng ước tính khi build**; cảnh báo playable (> 1 MB khi build, > 60 s, PCM, clip dài Decompress on load, âm ngắn stereo); card ghi độ dài + ≈ dung lượng; **Tải về** file như texture | ✅ |
| **Sprite / UI** (texture kiểu Sprite) | Trong viewer ảnh của Texture: khung từng sprite con (đánh số) + đường 9-slice, bật/tắt; nét vẽ giữ độ dày khi thu nhỏ | Từ `.meta`: chế độ (Single / Multiple / Polygon), số sprite, % sheet đã dùng (cảnh báo khi > 50% trống), Pixels per unit, viền 9-slice, packing tag; danh sách sprite (tên, kích thước, 9-slice) | ✅ chờ user xem trên app |
| Sprite Atlas (`.spriteatlas`), tab / lọc riêng cho sprite | Atlas: danh sách sprite / thư mục được pack | Tab Sprite cần đọc `.meta` của mọi texture (chỉ mục hiện chỉ có tên) | ⏳ |
| **Prefab tĩnh** (mesh + material, không particle) | Dựng lại bằng three.js: cây transform (đổi hệ trục Unity → three), mesh từ FBX theo tỉ lệ import (UnitScaleFactor × globalScale), material + texture + màu theo GUID, prefab lồng nhau / Prefab Variant / model kéo thả (override vị trí, xoay, scale, material) tới 4 tầng; mesh khớp theo bảng tên trong `.meta` hoặc tên GameObject (chuẩn hoá, mỗi mesh một lần); thumbnail lưới; prefab UI / particle / chỉ script hiện thẻ chữ | Model, prefab lồng nhau, material (+ texture, shader), script custom, asset khác (sprite, audio, animator…) với số lần dùng; GUID của model / prefab / script / asset khác tra theo nhu cầu (gần nhất trước, đủ cả branch ở bước cuối); cảnh báo thiếu model, script custom, particle, prefab UI; xuất `.unitypackage` đủ file | ✅ chờ user xem trên app |
| **Animation clip** (`.anim`; clip trong FBX đã có từ Phase 3) | Phát trên model có rig khớp: curve vị trí / xoay / Euler / scale lấy mẫu Hermite như Unity, đổi hệ trục, tỉ lệ import; tự thử tối đa 4 model gần nhất (tên clip + thư mục, khớp ≥ 50% bone), hoặc chọn tay trong danh sách 8 model; phát / dừng, lặp, góc nhìn. **Thumbnail lưới**: model tư thế ở 40% clip (rig tự chọn, giữ 4 rig gần nhất trong bộ nhớ), mở clip / chọn rig tay thì cập nhật ảnh; clip không có rig: hình các curve + loại; card ghi độ dài. Clip Humanoid, UI, Sprite, nén: chỉ thông tin | Độ dài, frame, sample rate, loại (Generic / Humanoid / Legacy / UI / Sprite), số object, curve, key, event; cảnh báo key ở mọi frame (nên bật Keyframe Reduction); sprite / object tham chiếu được xuất kèm | ✅ chờ user xem trên app |
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
| Tìm kiếm bước 2: chỉ mục dùng chung cho team — GitHub Action định kỳ quét repo, đẩy chỉ mục + thumbnail vào repo riêng (vd. `supercent-io/asset-index`); app chỉ tải về, tìm tức thì | ⏳ |
| Tìm bằng hình ảnh / mô tả (embedding thumbnail) — "tìm ngữ nghĩa" bước 2, sau nhóm từ khoá đã có | ⏳ |
| "Còn ở đâu" theo GUID (cùng asset nhưng đã sửa nội dung) | ⏳ |
| Thumbnail prefab / particle do Unity batchmode render sẵn trên CI, lưu theo SHA | ⏳ |
| #7 Bộ sưu tập / yêu thích / tag | ⏳ |
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

## Phase 10 — Phát hành (làm cuối cùng, Mốc E)
Trong lúc còn phát triển và test, chạy bằng `npm run dev`. Icon app đã có sẵn ở `build/` (svg, png, icns).

| Việc | State |
|---|---|
| `electron-builder`: `.dmg` cho Apple Silicon + Intel, ad-hoc sign | ⏳ |
| Hướng dẫn mở app chưa ký lần đầu (Gatekeeper) cho người không rành kỹ thuật | ⏳ |
| Code signing + notarize (cần Apple Developer ID của công ty) | ⏳ |
| Windows installer (nếu team cần) | ⏳ |
| Tự cập nhật (GitHub Releases) | ⏳ |

---

## Nhật ký
| Ngày | Thay đổi |
|---|---|
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
