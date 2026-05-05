const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'clinic_v2',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initDB() {
    try {
        const connection = await mysql.createConnection({
            host: 'localhost', user: 'root', password: ''
        });
        // Drop old database and create fresh
        await connection.query('DROP DATABASE IF EXISTS clinic_v2;');
        await connection.query('CREATE DATABASE clinic_v2;');
        await connection.end();

        console.log('[DB] Database clinic_v2 created.');

        // Users
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role ENUM('admintechnical','admin','customer','frontdesk','laboratory','owner') NOT NULL DEFAULT 'customer',
                customer_category ENUM('Regular','Senior','PWD','Pregnant') DEFAULT NULL,
                full_name VARCHAR(255) DEFAULT '',
                email VARCHAR(255) DEFAULT '',
                birthday DATE DEFAULT NULL,
                gender ENUM('Male','Female','Other') DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                reset_token VARCHAR(255),
                reset_expiry DATETIME
            )
        `);

        // Laboratories
        await pool.query(`
            CREATE TABLE IF NOT EXISTS laboratories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                service_type VARCHAR(100) DEFAULT '',
                assigned_staff_id INT DEFAULT NULL,
                is_open BOOLEAN DEFAULT true,
                start_time TIME DEFAULT NULL,
                cutoff_time TIME DEFAULT NULL,
                FOREIGN KEY (assigned_staff_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Service Packages
        await pool.query(`
            CREATE TABLE IF NOT EXISTS service_packages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                description TEXT,
                price DECIMAL(10,2) NOT NULL DEFAULT 0,
                est_time_minutes INT DEFAULT 15,
                is_active BOOLEAN DEFAULT true,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Package-Laboratory mapping (sequence)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS package_laboratories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                package_id INT NOT NULL,
                laboratory_id INT NOT NULL,
                sequence_order INT NOT NULL DEFAULT 1,
                est_time_minutes INT DEFAULT 10,
                FOREIGN KEY (package_id) REFERENCES service_packages(id) ON DELETE CASCADE,
                FOREIGN KEY (laboratory_id) REFERENCES laboratories(id) ON DELETE CASCADE
            )
        `);

        // Queue table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS queue (
                id VARCHAR(100) PRIMARY KEY,
                station_type ENUM('frontdesk','laboratory') NOT NULL DEFAULT 'frontdesk',
                station_id INT DEFAULT NULL,
                number VARCHAR(30) NOT NULL,
                type VARCHAR(10) NOT NULL,
                status ENUM('waiting','serving','completed','cancelled') NOT NULL DEFAULT 'waiting',
                customer_id INT DEFAULT NULL,
                sequence_id INT DEFAULT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Queue Sequences (multi-step tracking)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS queue_sequences (
                id INT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT NOT NULL,
                package_id INT NOT NULL,
                current_step INT DEFAULT 0,
                total_steps INT NOT NULL DEFAULT 1,
                status ENUM('in_progress','completed','cancelled') DEFAULT 'in_progress',
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME DEFAULT NULL,
                FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (package_id) REFERENCES service_packages(id) ON DELETE CASCADE
            )
        `);

        // Queue Logs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS queue_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                station_type ENUM('frontdesk','laboratory') DEFAULT 'frontdesk',
                station_id INT DEFAULT NULL,
                ticket_number VARCHAR(30),
                type VARCHAR(10),
                customer_id INT DEFAULT NULL,
                sequence_id INT DEFAULT NULL,
                package_name VARCHAR(150) DEFAULT '',
                price DECIMAL(10,2) DEFAULT 0,
                join_time DATETIME,
                serve_time DATETIME DEFAULT NULL,
                complete_time DATETIME DEFAULT NULL
            )
        `);

        // Appointments
        await pool.query(`
            CREATE TABLE IF NOT EXISTS appointments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT NOT NULL,
                package_id INT NOT NULL,
                appointment_date DATE NOT NULL,
                appointment_time TIME NOT NULL,
                status ENUM('scheduled','checked-in','completed','cancelled') DEFAULT 'scheduled',
                payment_status ENUM('pending','paid','refunded') DEFAULT 'pending',
                payment_method VARCHAR(50) DEFAULT 'mock',
                payment_ref VARCHAR(100) DEFAULT '',
                notes TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (package_id) REFERENCES service_packages(id) ON DELETE CASCADE
            )
        `);

        // Medical Records
        await pool.query(`
            CREATE TABLE IF NOT EXISTS medical_records (
                id INT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT NOT NULL,
                birthplace VARCHAR(255) DEFAULT '',
                address VARCHAR(255) DEFAULT '',
                phone VARCHAR(50) DEFAULT '',
                status VARCHAR(50) DEFAULT '',
                occupation VARCHAR(100) DEFAULT '',
                retiree BOOLEAN DEFAULT false,
                emergency_contact VARCHAR(255) DEFAULT '',
                current_health TEXT,
                past_conditions TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Lab Notes
        await pool.query(`
            CREATE TABLE IF NOT EXISTS lab_notes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT NOT NULL,
                staff_id INT DEFAULT NULL,
                note TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Announcements
        await pool.query(`
            CREATE TABLE IF NOT EXISTS announcements (
                id INT AUTO_INCREMENT PRIMARY KEY,
                message TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Settings
        await pool.query(`
            CREATE TABLE IF NOT EXISTS settings (
                id INT PRIMARY KEY DEFAULT 1,
                site_name VARCHAR(255) DEFAULT 'Medical Clinic',
                logo_path VARCHAR(255) DEFAULT '/images/examplelogo.svg',
                theme VARCHAR(20) DEFAULT 'light',
                navbar_color VARCHAR(50) DEFAULT '#ffffff',
                background_image VARCHAR(255) DEFAULT ''
            )
        `);
        await pool.query(`INSERT IGNORE INTO settings (id) VALUES (1)`);

        // Audit Logs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                action VARCHAR(100) NOT NULL,
                entity_type VARCHAR(50),
                entity_id INT DEFAULT NULL,
                details TEXT,
                performed_by INT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Staff Sessions (login/logout tracking)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS staff_sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                login_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                logout_time DATETIME DEFAULT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Pricing FAQs (kept for chatbot reference)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pricing_faqs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                service_name VARCHAR(150) NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                description TEXT
            )
        `);

        console.log('[DB] All tables created successfully.');
    } catch (err) {
        console.error('[DB] Failed to initialize:', err.message);
    }
}

module.exports = { pool, initDB };
