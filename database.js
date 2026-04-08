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

        // Departments Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS departments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                start_time TIME DEFAULT NULL,
                cutoff_time TIME DEFAULT NULL,
                is_open BOOLEAN DEFAULT true
            )
        `);

        // Users Table (Admin / Staff)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role ENUM('admin', 'staff', 'frontdesk', 'doctor', 'secretary', 'customer', 'cashier') NOT NULL DEFAULT 'customer',
                customer_category ENUM('Regular', 'Elderly', 'PWD') DEFAULT NULL,
                reset_token VARCHAR(255),
                reset_expiry DATETIME
            )
        `);

        // Migrate old role names if they exist
        try {
            // Step 1: Widen the ENUM to include all old and new values
            await pool.query(`ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'staff', 'frontdesk', 'doctor', 'secretary', 'customer', 'ultraadmin', 'cashier') NOT NULL DEFAULT 'customer'`);
            // Step 2: Convert old role names to new ones
            await pool.query(`UPDATE users SET role = 'admin' WHERE role = 'ultraadmin'`);
            await pool.query(`UPDATE users SET role = 'frontdesk' WHERE role = 'staff'`);
            // Step 3: Now that old values are gone, shrink the ENUM
            await pool.query(`ALTER TABLE users MODIFY COLUMN role ENUM('admin', 'frontdesk', 'doctor', 'secretary', 'customer', 'cashier') NOT NULL DEFAULT 'customer'`);
        } catch(e) {
            console.log('[DB Migration] Role enum migration skipped or already done:', e.message);
        }
        // Ensure customer_category column exists for older tables
        try {
            await pool.query(`ALTER TABLE users ADD COLUMN customer_category ENUM('Regular', 'Elderly', 'PWD') DEFAULT NULL`);
        } catch (err) {
            // Column already exists — that's fine
        }

        // Appointments Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS appointments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT NOT NULL,
                department_id INT NOT NULL,
                doctor_id INT DEFAULT NULL,
                phone_number VARCHAR(20) NOT NULL,
                status ENUM('scheduled', 'checked-in', 'cancelled') DEFAULT 'scheduled',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
                FOREIGN KEY (doctor_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Create Default UltraAdmin if none exists
        // (In a real app, use a strong password and bcrypt. We will inject one using bcrypt in server.js or default here if empty, but we'll do it securely in backend logic or here using raw SQL if we must. Since bcrypt is installed, let's just make the schema here and seed in server.js to use bcrypt)

        // Pricing/FAQs Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pricing_faqs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                service_name VARCHAR(150) NOT NULL,
                price DECIMAL(10, 2) NOT NULL,
                description TEXT
            )
        `);

        // Queue Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS queue (
                id VARCHAR(100) PRIMARY KEY,
                department_id INT NOT NULL,
                number VARCHAR(20) NOT NULL,
                type VARCHAR(10) NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'waiting', -- waiting, serving, completed, transferred, cancelled
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
            )
        `);

        // Queue Logs (Analytics)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS queue_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                department_id INT,
                ticket_number VARCHAR(20),
                type VARCHAR(10),
                join_time DATETIME,
                serve_time DATETIME,
                complete_time DATETIME,
                FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
            )
        `);

        // Clinic State (Legacy/Global Annoucements)
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

        // Settings Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                id INT PRIMARY KEY DEFAULT 1,
                site_name VARCHAR(255) DEFAULT 'Medical Clinic',
                logo_path VARCHAR(255) DEFAULT '',
                background_path VARCHAR(255) DEFAULT '',
                theme ENUM('light', 'dark', 'custom') DEFAULT 'light'
            )
        `);
        await pool.query(`INSERT IGNORE INTO settings (id, site_name, theme) VALUES (1, 'Medical Clinic', 'light')`);

        // AI Settings Table 
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_settings (
                id INT PRIMARY KEY DEFAULT 1,
                chatbot_enabled BOOLEAN DEFAULT true,
                ocr_enabled BOOLEAN DEFAULT true,
                anomaly_enabled BOOLEAN DEFAULT true,
                announcement_enabled BOOLEAN DEFAULT true,
                cutoff_enabled BOOLEAN DEFAULT true,
                estimation_enabled BOOLEAN DEFAULT true,
                performance_enabled BOOLEAN DEFAULT true,
                feedback_enabled BOOLEAN DEFAULT true,
                report_enabled BOOLEAN DEFAULT true,
                prediction_enabled BOOLEAN DEFAULT true
            )
        `);
        await pool.query(`INSERT IGNORE INTO ai_settings (id) VALUES (1)`);

        // AI Logs Table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                feature VARCHAR(50) NOT NULL,
                input_data TEXT,
                output_data TEXT,
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
