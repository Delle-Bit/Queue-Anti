const mysql = require('mysql2/promise');

// Standard local configuration
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'clinic_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initDB() {
    try {
        // Create DB if it doesn't exist
        const connection = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: ''
        });
        await connection.query('CREATE DATABASE IF NOT EXISTS clinic_db;');
        await connection.end();

        // Now connect and create tables
        console.log('Database connected successfully.');

        // Creating the necessary tables
        await pool.query(`
            CREATE TABLE IF NOT EXISTS queue (
                id VARCHAR(100) PRIMARY KEY,
                number VARCHAR(20) NOT NULL,
                type VARCHAR(10) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'waiting', -- waiting, serving, done, cancelled
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS clinic_state (
                id INT PRIMARY KEY DEFAULT 1,
                currentServing VARCHAR(20) DEFAULT '--',
                isOpen BOOLEAN DEFAULT true
            )
        `);

        // Initialize state row if none exists
        await pool.query(`INSERT IGNORE INTO clinic_state (id, currentServing, isOpen) VALUES (1, '--', true)`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS announcements (
                id INT AUTO_INCREMENT PRIMARY KEY,
                message TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('Tables initialized successfully.');
    } catch (err) {
        console.error('Failed to initialize database. Ensure MySQL is running on localhost:3306 with root / no password.', err.message);
    }
}

module.exports = {
    pool,
    initDB
};
