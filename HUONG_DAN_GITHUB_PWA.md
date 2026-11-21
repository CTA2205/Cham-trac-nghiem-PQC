# HƯỚNG DẪN ĐƯA ỨNG DỤNG LÊN GITHUB PAGES & CHẤM THI TRÊN ĐIỆN THOẠI (PWA OFFLINE)

> **Mục tiêu:** Giúp giáo viên đưa ứng dụng chấm thi lên GitHub Pages cá nhân để mở trực tiếp trên điện thoại (iPhone / Android), cài thành ứng dụng độc lập trên màn hình chính và chấm thi offline 100% mà không cần kết nối máy tính.

---

## I. CẤU TRÚC GÓI ĐÓNG GÓI PWA NÀY

Thư mục `DONG_GOI_PWA_GITHUB/` đã được tối ưu hóa hoàn chỉnh:
```
DONG_GOI_PWA_GITHUB/
│
├── index.html                  # Giao diện chính Responsive tối ưu cho cả Điện thoại & Máy tính
├── manifest.json               # Cấu hình PWA để cài lên Màn hình chính điện thoại (Home Screen)
├── sw.js                       # Service Worker tự động lưu Cache để chạy Offline 100% không cần mạng
├── HUONG_DAN_GITHUB_PWA.md     # Tài liệu hướng dẫn này
│
├── css/
│   └── style.css               # Giao diện có thanh điều hướng đáy (Bottom Nav) cho điện thoại
├── js/
│   ├── omr-engine.js           # Lõi thị giác máy tính nhận diện ô tô & tính điểm
│   ├── excel-handler.js        # Đọc/ghi Excel chuẩn 10 cột, lặp dòng tiêu đề khi in A4 ngang
│   ├── export-zip.js           # Nén file ZIP phân loại theo từng lớp
│   └── app-pwa.js              # Điều khiển ứng dụng, chụp camera & sửa nhanh (Live Fast-Fix)
├── lib/
│   ├── xlsx.full.min.js        # Thư viện SheetJS nội bộ
│   └── jszip.min.js            # Thư viện JSZip nội bộ
└── icons/
    └── icon.svg                # Biểu tượng ứng dụng trên màn hình điện thoại
```

---

## II. CÁC BƯỚC ĐƯA LÊN GITHUB PAGES (RẤT ĐƠN GIẢN)

Thầy/cô có thể dùng 1 trong 2 cách sau:

### CÁCH 1: TẢI TRỰC TIẾP TRÊN TRANG WEB GITHUB (KHÔNG CẦN CÀI GIT)

1. Đăng nhập vào tài khoản [GitHub](https://github.com/).
2. Bấm dấu **`+`** ở góc trên cùng bên phải ➔ Chọn **`New repository`**.
3. Điền thông tin:
   - **Repository name**: ví dụ `cham-thi-2025` (hoặc tên tùy thích).
   - Chọn chế độ: **`Public`**.
   - Bấm nút xanh **`Create repository`**.
4. Tại trang repo vừa tạo, bấm vào dòng chữ **`uploading an existing file`**.
5. Kéo toàn bộ các tệp và thư mục bên trong thư mục `DONG_GOI_PWA_GITHUB` vào ô tải lên của GitHub:
   - `index.html`
   - `manifest.json`
   - `sw.js`
   - thư mục `css`
   - thư mục `js`
   - thư mục `lib`
   - thư mục `icons`
6. Cuộn xuống dưới cùng và bấm nút xanh **`Commit changes`**.

---

### BƯỚC QUAN TRỌNG: BẬT TÍNH NĂNG GITHUB PAGES

1. Trong trang repository của thầy/cô trên GitHub, bấm vào tab **`Settings`** (ở hàng menu trên).
2. Ở cột menu bên trái, tìm và bấm vào mục **`Pages`**.
3. Tại phần **Build and deployment**:
   - Mục **Source**: chọn **`Deploy from a branch`**.
   - Mục **Branch**: chọn nhánh **`main`** (hoặc `master`), thư mục giữ nguyên là **`/(root)`**.
   - Bấm nút **`Save`**.
4. Chờ khoảng 1-2 phút, GitHub sẽ cấp cho thầy/cô một đường link màu xanh dạng:
   👉 **`https://<tên-tài-khoản-github>.github.io/<tên-repo>/`**

---

## III. CÁCH CÀI ĐẶT APP LÊN MÀN HÌNH CHÍNH ĐIỆN THOẠI (ADD TO HOME SCREEN)

Khi mở đường link trên điện thoại bằng trình duyệt:

### Đối với iPhone / iPad (Dùng trình duyệt Safari):
1. Mở đường link GitHub Pages bằng **Safari**.
2. Bấm vào nút **Chia sẻ** (biểu tượng hình vuông có mũi tên chỉ lên ở thanh đáy).
3. Cuộn xuống và chọn **"Thêm vào MH chính"** (Add to Home Screen).
4. Bấm **"Thêm"** (Add). Biểu tượng ứng dụng sẽ xuất hiện trên màn hình điện thoại giống hệt như một App tải từ App Store.

### Đối với điện thoại Android (Samsung, Xiaomi, Oppo... - Dùng Google Chrome):
1. Mở đường link GitHub Pages bằng **Google Chrome**.
2. Bấm vào dấu **3 chấm** ở góc trên bên phải màn hình.
3. Chọn **"Cài đặt ứng dụng"** (Install App) hoặc **"Thêm vào Màn hình chính"**.
4. Bấm xác nhận cài đặt.

> ⚡ **ĐẶC QUYỀN OFFLINE 100%:** Ngay sau lần mở đầu tiên, Service Worker đã tự động lưu toàn bộ mã nguồn và thư viện vào bộ nhớ đệm. Thầy/cô có thể tắt mạng 4G/Wi-Fi hoặc mang điện thoại vào phòng thi vẫn mở và chấm bài bình thường!

---

## IV. QUY TRÌNH 4 BƯỚC CHẤM THI TRÊN ĐIỆN THOẠI

### BƯỚC 1: Quản Lý Đáp Án & Thang Điểm (Tab 1 📋)
- **Cách 1 (Nhanh nhất):** Bấm "Chọn tệp Excel đáp án" để nạp tệp `MAU DAP AN.xlsx`.
- **Cách 2 (Trực tiếp trên điện thoại):** Bấm chọn chế độ "Nhập trực tiếp trên Web", chạm vào các ô tròn A, B, C, D hoặc Đúng/Sai trên màn hình cảm ứng để soạn đáp án từng mã đề.
- Cấu hình thang điểm linh hoạt cho từng phần.

### BƯỚC 2: Quản Lý Danh Sách Học Sinh (Tab 2 👥)
- **Tùy chọn - Không bắt buộc:**
  * Nếu nạp tệp `DANH SACH HỌC SINH.xlsx`: Hệ thống sẽ tự động ghép tên và lớp khi quét bài.
  * Nếu **không nạp danh sách**: Ứng dụng vẫn chấm bình thường theo SBD 8 số đã tô trên phiếu. Bảng điểm xuất ra được sắp xếp theo SBD tăng dần (cột B) để thầy/cô dễ dàng dùng hàm `VLOOKUP` ghép với danh sách học sinh trên máy tính sau này.

### BƯỚC 3: Chụp & Chấm Bài Bằng Camera (Tab 3 📸)
- Bấm nút to nổi bật: **"📸 BẤM VÀO ĐÂY ĐỂ CHỤP & CHẤM BÀI NGAY"**.
- Camera điện thoại mở lên, chụp vuông góc tờ phiếu thi (đảm bảo nhìn rõ 4 góc định vị màu đen).
- **Tính năng Sửa Nhanh (Live Fast-Fix):**
  * Nếu học sinh tô mờ, quên tô SBD hoặc quên tô mã đề: Màn hình sẽ hiện ngay cửa sổ **Sửa Nhanh Tại Lúc Chụp**.
  * Cửa sổ hiển thị ảnh cắt vùng học sinh viết tay Họ tên, SBD, Mã đề bằng bút mực xanh.
  * Thầy/cô chỉ cần chạm vào nút mã đề tương ứng (`[1201]`, `[1202]`) và nhập SBD rồi bấm **"✅ XÁC NHẬN & CHẤM NGAY"**.
- Có thể bấm **"👁️ Xem bài"** bất kỳ lúc nào để soi bài thi và bảng đối chiếu đáp án chi tiết.

### BƯỚC 4: Bảng Điểm & Xuất Dữ Liệu (Tab 4 📊)
- **📊 Xuất Excel (10 cột):** Tạo tệp Excel chuẩn font Times New Roman, khổ A4 ngang, 2 chữ số thập phân, tổng điểm in đậm, lặp lại tiêu đề khi sang trang, chân bảng có ngày xuất An Giang và 3 chức danh ký duyệt.
- **📲 Chia Sẻ Bảng Điểm:** Sử dụng tính năng chia sẻ của điện thoại (Web Share API) để gửi trực tiếp tệp Excel qua **Zalo**, **Email cá nhân**, hoặc lưu vào **Google Drive** chỉ với 1 chạm!
- **📦 Đóng gói ZIP:** Gom ảnh các bài làm và tệp Excel thành file ZIP.
