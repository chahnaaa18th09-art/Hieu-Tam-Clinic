# PHÒNG KHÁM ĐA KHOA HIẾU TÂM - HỆ THỐNG ĐẶT LỊCH KHÁM BỆNH

Ứng dụng web hỗ trợ bệnh nhân đặt lịch hẹn khám bệnh trực tuyến theo chuyên khoa, bác sĩ và khung giờ còn trống, đồng thời cung cấp bảng điều khiển cho Bác sĩ và Quản trị viên (Admin).

---

## 1. Yêu cầu môi trường
* **Node.js** (Phiên bản 18.x trở lên)
* **MySQL Server** (XAMPP, Laragon hoặc MySQL Workbench)

---

## 2. Hướng dẫn cài đặt CSDL (MySQL)
1. Mở phpMyAdmin hoặc MySQL Workbench.
2. Mở file `database/csdl.sql` và nhấn **Execute / Run** toàn bộ nội dung để tạo database `hieu_tam_clinic`, các bảng dữ liệu và ca trực mẫu.

---

## 3. Cài đặt và Khởi động Backend
1. Mở cửa sổ Terminal trong VS Code (`Ctrl + ~` hoặc vào menu **Terminal** -> **New Terminal**).
2. Di chuyển vào thư mục `backend`:
   ```bash
   cd backend