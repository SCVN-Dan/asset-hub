# Cài Asset Hub trên Mac

## 1. Máy cần gì

Mac chip Apple (**M1, M2, M3, M4**) — xem ở  (góc trái trên màn hình) › **Giới thiệu về máy Mac này** › dòng **Chip**. Mac chip Intel không chạy được. Cần mạng để tải app (~90 MB) lúc cài.

## 2. Cài

1. Tải **`Asset-Hub-Installer.dmg`** (khoảng 1 MB) và mở nó.
2. Mở **Cài Asset Hub** trong cửa sổ hiện ra.
3. **Lần đầu** macOS sẽ chặn trình cài vì nó chưa được Apple chứng nhận — cho phép một lần:
   - **macOS 15 (Sequoia) trở lên:** bấm **Xong** ở thông báo chặn → mở **Cài đặt hệ thống** › **Quyền riêng tư & Bảo mật**, kéo xuống cuối, ở dòng *"Cài Asset Hub đã bị chặn…"* bấm **Vẫn mở** → nhập mật khẩu máy → **Mở**.
   - **macOS 14 (Sonoma) trở xuống:** **chuột phải** vào **Cài Asset Hub** › **Mở** → **Mở**.
4. Bấm **Cài đặt**. Trình cài tải bản mới nhất từ GitHub (có thanh tiến trình), kiểm tra file, cài vào **Applications** rồi tự mở Asset Hub. App cài theo cách này mở thẳng, không bị chặn.

Có bản mới: chạy lại **Cài Asset Hub** — nó tải bản mới nhất và thay bản cũ.

## 3. Đăng nhập

Bấm **BẮT ĐẦU**. Nếu máy chưa có GitHub CLI, app tự tải về (không cần quyền admin). GitHub sẽ hỏi xác nhận bằng một **mã vào phòng**: bấm **Mở GitHub**, dán mã (đã tự copy sẵn), bấm **Continue** rồi **Authorize**, quay lại app — xong. Những lần sau mở app là vào thẳng.

Tài khoản GitHub cần được mời vào tổ chức của công ty và có quyền đọc các repo asset.

## Gỡ cài đặt

Kéo **Asset Hub** trong Applications vào Thùng rác. Dữ liệu tải về và thumbnail nằm ở `~/Library/Application Support/asset-hub` — xoá thư mục này nếu muốn dọn sạch (hoặc dùng **Cài đặt › Bộ nhớ đệm › Xoá** trong app trước khi gỡ).

---

## Cho người build (dev)

```sh
npm run dist:web    # release/Asset-Hub-Installer.dmg (~1 MB) + Asset-Hub-arm64.zip (+ .sha256)
npm run release     # đăng v<version> lên GitHub Releases của repo public trong package.json "releaseRepo"
npm run dist        # (tuỳ chọn) bản .dmg đầy đủ ~90 MB, không cần mạng khi cài
```

- Trình cài: `scripts/installer.applescript` (biên dịch bằng `osacompile` trong `scripts/make-web-installer.mjs`), tải `releases/latest/download/Asset-Hub-arm64.zip` và chỉ cài khi khớp mã SHA-256 đăng kèm.
- Cấu hình: `electron-builder.yml`, chỉ Apple Silicon. App ký **ad hoc** (`scripts/adhoc-sign.cjs`); khi có Apple Developer ID thì ký thật + notarize, bỏ được bước cho phép ở trên.
- Đổi `version` trong `package.json` trước mỗi bản phát hành (tag `v<version>`).
