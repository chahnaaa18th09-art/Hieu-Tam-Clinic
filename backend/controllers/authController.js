const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { JWT_SECRET } = require('../middleware/auth');

async function login(req, res) {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ email và mật khẩu.' });
        }

        const [users] = await pool.execute(
            'SELECT id, email, password_hash, full_name, role, is_active FROM users WHERE email = ? LIMIT 1',
            [email.trim().toLowerCase()]
        );

        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không chính xác.' });
        }

        const user = users[0];
        if (!user.is_active) {
            return res.status(403).json({ success: false, message: 'Tài khoản của bạn đã bị khóa.' });
        }

        const isMatch = await bcrypt.compare(password, user.password_hash).catch(() => false);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Email hoặc mật khẩu không chính xác.' });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role, email: user.email },
            JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
        );

        return res.json({
            success: true,
            message: 'Đăng nhập thành công.',
            data: {
                token,
                user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role }
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi đăng nhập.' });
    }
}

async function changePassword(req, res) {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'Mật khẩu mới phải có tối thiểu 6 ký tự.' });
        }

        const [users] = await pool.execute('SELECT password_hash FROM users WHERE id = ? LIMIT 1', [req.user.id]);
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy tài khoản.' });
        }
        const valid = await bcrypt.compare(currentPassword, users[0].password_hash).catch(() => false);
        if (!valid) {
            return res.status(400).json({ success: false, message: 'Mật khẩu hiện tại không đúng.' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await pool.execute('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);

        return res.json({ success: true, message: 'Đổi mật khẩu thành công.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi đổi mật khẩu.' });
    }
}

module.exports = { login, changePassword };