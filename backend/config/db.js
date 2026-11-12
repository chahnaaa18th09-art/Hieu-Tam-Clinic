const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'hieu_tam_clinic',
    charset: 'utf8mb4',
    collation: 'utf8mb4_unicode_ci',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+07:00',
    dateStrings: true
});

pool.on('connection', connection => {
    connection.query("SET time_zone = '+07:00'", error => {
        if (error) console.error('[Lỗi múi giờ CSDL]:', error.message);
    });
});

async function checkDatabaseConnection() {
    try {
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        return { connected: true };
    } catch (error) {
        return { connected: false, error: error.message };
    }
}

module.exports = { pool, checkDatabaseConnection };