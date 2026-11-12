require('dotenv').config();
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32
    ? process.env.JWT_SECRET
    : 'hieu_tam_clinic_jwt_secret_key_2026_super_secure_9999';

async function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Yêu cầu đăng nhập để tiếp tục.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const [users] = await pool.execute(
            'SELECT id, email, full_name, role, is_active FROM users WHERE id = ? LIMIT 1',
            [decoded.id]
        );

        if (users.length === 0 || !users[0].is_active) {
            return res.status(403).json({ success: false, message: 'Tài khoản không tồn tại hoặc đã bị khóa.' });
        }

        req.user = users[0];

        if (req.user.role === 'doctor') {
            const [docs] = await pool.execute(
                'SELECT id, specialty_id, is_active FROM doctors WHERE user_id = ? LIMIT 1',
                [req.user.id]
            );
            if (docs.length === 0 || !docs[0].is_active) {
                return res.status(403).json({ success: false, message: 'Hồ sơ bác sĩ chưa được kích hoạt.' });
            }
            req.user.doctor_id = docs[0].id;
            req.user.specialty_id = docs[0].specialty_id;
        }

        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' });
    }
}

function authorizeRoles(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Bạn không có quyền truy cập.' });
        }
        next();
    };
}

module.exports = { authenticateToken, authorizeRoles, JWT_SECRET };