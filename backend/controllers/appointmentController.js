
const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointmentController');

// =========================================================
// 1. CÁC ROUTE MỚI: ĐẶT LỊCH VÀ TRA CỨU LỊCH HẸN
// =========================================================

// Lấy danh sách khung giờ đã được đặt của bác sĩ theo ngày
router.get('/booked-slots', appointmentController.getBookedSlots);

// Tra cứu lịch hẹn bằng mã lịch hẹn và SĐT/Email
router.get('/lookup', appointmentController.lookupAppointment);

// Bệnh nhân hủy lịch hẹn
router.put('/:id/cancel', appointmentController.cancelAppointmentPublic);


// =========================================================
// 2. CÁC ROUTE CŨ: GIỮ NGUYÊN
// =========================================================

// Tạo lịch hẹn mới
router.post('/', appointmentController.createAppointment);

// Lấy danh sách tất cả lịch hẹn
router.get('/', appointmentController.getAllAppointments);

// Lấy thông tin một lịch hẹn theo ID
router.get('/:id', appointmentController.getAppointmentById);

// Cập nhật trạng thái lịch hẹn
router.put('/:id', appointmentController.updateAppointmentStatus);

// Xóa lịch hẹn
router.delete('/:id', appointmentController.deleteAppointment);


module.exports = router;
