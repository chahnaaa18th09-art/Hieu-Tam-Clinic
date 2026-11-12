const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const apiRoutes = require('./routes/api');
const { checkDatabaseConnection, pool } = require('./config/db');
const { expirePendingHoldsFromPool } = require('./services/appointmentHoldService');
const { processPendingEmails } = require('./services/appointmentEmailOutbox');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
let processingEmailOutbox = false;

async function dispatchPendingEmails() {
    if (processingEmailOutbox) return;
    processingEmailOutbox = true;
    try {
        await processPendingEmails(pool);
    } catch (error) {
        console.error('Không thể xử lý hàng đợi email đặt lịch:', error.message);
    } finally {
        processingEmailOutbox = false;
    }
}

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        // Cho phép request không có Origin (ví dụ health check, server-side)
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Origin không được phép bởi CORS.'));
    },
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Nạp các file giao diện tĩnh từ thư mục frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Khai báo các tuyến đường API
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.use((err, req, res, next) => {
    console.error('[Lỗi Server]:', err);
    res.status(500).json({ success: false, message: 'Đã xảy ra lỗi không xác định trên máy chủ.' });
});

app.listen(PORT, async () => {
    console.log('============================================================');
    console.log(`🏥 PHÒNG KHÁM ĐA KHOA HIẾU TÂM`);
    console.log(`🌐 Website đang chạy tại: http://localhost:${PORT}`);
    const dbCheck = await checkDatabaseConnection();
    if (dbCheck.connected) {
        console.log('✅ Kết nối CSDL MySQL: THÀNH CÔNG');
        try {
            await expirePendingHoldsFromPool(pool);
        } catch (error) {
            console.error('Không thể dọn yêu cầu đặt lịch hết hạn:', error.message);
        }
    } else {
        console.log('❌ Kết nối CSDL MySQL: THẤT BẠI (' + dbCheck.error + ')');
    }
    const expiryTimer = setInterval(async () => {
        try {
            await expirePendingHoldsFromPool(pool);
        } catch (error) {
            console.error('Không thể cập nhật yêu cầu đặt lịch hết hạn:', error.message);
        }
    }, 60 * 1000);
    expiryTimer.unref();
    void dispatchPendingEmails();
    const emailTimer = setInterval(dispatchPendingEmails, 10 * 1000);
    emailTimer.unref();
    console.log('============================================================');
});