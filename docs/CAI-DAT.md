# Cài Asset Hub trên Mac

## 1. Chọn đúng file

Bấm  (góc trái trên màn hình) › **Giới thiệu về máy Mac này**, xem dòng **Chip** (hoặc **Bộ xử lý**):

| Máy ghi | Tải file |
|---|---|
| Apple M1, M2, M3, M4… | `Asset-Hub-<phiên bản>-arm64.dmg` |
| Intel | `Asset-Hub-<phiên bản>-x64.dmg` |

## 2. Cài

1. Mở file `.dmg` vừa tải.
2. Kéo **Asset Hub** vào thư mục **Applications**.
3. Đóng cửa sổ `.dmg` (có thể kéo ổ "Asset Hub" trên màn hình vào Thùng rác để tháo ra).

## 3. Mở lần đầu

App chưa được Apple chứng nhận (công ty chưa có tài khoản Apple Developer), nên lần mở **đầu tiên** macOS sẽ chặn với thông báo kiểu *"Không thể mở Asset Hub vì Apple không thể kiểm tra…"*. Chỉ cần cho phép một lần:

**macOS 15 (Sequoia) trở lên**
1. Mở Asset Hub trong Applications → macOS báo chặn → bấm **Xong**.
2. Mở **Cài đặt hệ thống** › **Quyền riêng tư & Bảo mật**, kéo xuống dưới cùng.
3. Ở dòng *"Asset Hub đã bị chặn…"* bấm **Vẫn mở** → nhập mật khẩu máy → bấm **Mở**.

**macOS 14 (Sonoma) trở xuống**
1. Trong Applications, **chuột phải** (hoặc Control + bấm) vào Asset Hub › **Mở**.
2. Bấm **Mở** trong hộp thoại hiện ra.

Từ lần sau mở bình thường như mọi app.

> Quen dùng Terminal? Một lệnh thay cho bước 3:
> `xattr -dr com.apple.quarantine "/Applications/Asset Hub.app"`

## 4. Đăng nhập

Bấm **BẮT ĐẦU**. Nếu máy chưa có GitHub CLI, app tự tải về (không cần quyền admin). GitHub sẽ hỏi xác nhận bằng một **mã vào phòng**: bấm **Mở GitHub**, dán mã (đã tự copy sẵn), bấm **Continue** rồi **Authorize**, quay lại app — xong. Những lần sau mở app là vào thẳng.

Tài khoản GitHub cần được mời vào tổ chức của công ty và có quyền đọc các repo asset.

## Gỡ cài đặt

Kéo **Asset Hub** trong Applications vào Thùng rác. Dữ liệu tải về và thumbnail nằm ở `~/Library/Application Support/asset-hub` — xoá thư mục này nếu muốn dọn sạch (hoặc dùng **Cài đặt › Bộ nhớ đệm › Xoá** trong app trước khi gỡ).

---

## Cho người build (dev)

```sh
npm run dist        # → release/Asset-Hub-<version>-arm64.dmg và -x64.dmg
```

- Cấu hình: `electron-builder.yml`. App ký **ad hoc** trong `scripts/adhoc-sign.cjs` (Apple Silicon không chạy code chưa ký); khi có Apple Developer ID thì bật ký thật + notarize, bỏ được bước 3 ở trên.
- Gói chỉ chứa `out/` (đã bundle hết thư viện), ngôn ngữ của Electron chỉ giữ en / vi / ko.
- Đổi `version` trong `package.json` trước mỗi bản phát hành.
