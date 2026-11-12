const express = require('express');
const router = express.Router();

const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const authController = require('../controllers/authController');
const patientController = require('../controllers/patientController');
const bookingController = require('../controllers/bookingController');
const doctorController = require('../controllers/doctorController');
const adminController = require('../controllers/adminController');

const { createRateLimiter } = require('../middleware/rateLimit');

const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
const publicLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });

// Xác thực
router.post('/auth/login', loginLimiter, authController.login);
router.post('/auth/change-password', authenticateToken, authController.changePassword);

// Cổng Bệnh nhân / Công khai
router.get('/public/specialties', patientController.getSpecialties);
router.get('/public/doctors', patientController.getPublicDoctors);
router.get('/public/doctors/:doctorId/dates', patientController.getDoctorAvailableDates);
router.get('/public/doctors/:doctorId/slots', patientController.getDoctorAvailableSlots);
router.post('/public/appointments', publicLimiter, bookingController.createAppointment);
router.post('/public/appointments/lookup', publicLimiter, patientController.lookupAppointment);
router.post('/public/appointments/cancel', publicLimiter, patientController.cancelAppointmentByPatient);
router.post('/public/contact', publicLimiter, patientController.submitContactForm);

// Cổng Bác sĩ
router.get('/doctor/dashboard', authenticateToken, authorizeRoles('doctor'), doctorController.getDoctorDashboard);
router.get('/doctor/appointments', authenticateToken, authorizeRoles('doctor'), doctorController.getDoctorAppointments);
router.patch('/doctor/appointments/:id/status', authenticateToken, authorizeRoles('doctor'), doctorController.updateDoctorAppointmentStatus);

// Cổng Quản trị viên (Admin)
router.get('/admin/stats', authenticateToken, authorizeRoles('admin'), adminController.getDashboardStats);
router.get('/admin/specialties', authenticateToken, authorizeRoles('admin'), adminController.getAllSpecialtiesAdmin);
router.post('/admin/specialties', authenticateToken, authorizeRoles('admin'), adminController.createSpecialty);
router.patch('/admin/specialties/:id', authenticateToken, authorizeRoles('admin'), adminController.updateSpecialty);
router.get('/admin/doctors', authenticateToken, authorizeRoles('admin'), adminController.getAllDoctorsAdmin);
router.post('/admin/doctors', authenticateToken, authorizeRoles('admin'), adminController.createDoctor);
router.patch('/admin/doctors/:id/status', authenticateToken, authorizeRoles('admin'), adminController.toggleDoctorActive);
router.get('/admin/shifts', authenticateToken, authorizeRoles('admin'), adminController.getShiftsAdmin);
router.post('/admin/shifts', authenticateToken, authorizeRoles('admin'), adminController.createShift);
router.put('/admin/shifts/:id', authenticateToken, authorizeRoles('admin'), adminController.updateShift);
router.delete('/admin/shifts/:id', authenticateToken, authorizeRoles('admin'), adminController.deleteShift);
router.get('/admin/appointments', authenticateToken, authorizeRoles('admin'), adminController.getAllAppointmentsAdmin);
router.patch('/admin/appointments/:id/status', authenticateToken, authorizeRoles('admin'), adminController.updateAppointmentStatusAdmin);
router.get('/admin/users', authenticateToken, authorizeRoles('admin'), adminController.getUsersAdmin);

module.exports = router;