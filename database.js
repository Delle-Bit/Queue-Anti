const mysql = require('mysql2/promise');

// Connection settings come from the environment so the app can be pointed at a
// real database server on deployment. The defaults are the local XAMPP/MySQL
// install a developer gets out of the box, so an existing .env-less checkout
// keeps working unchanged.
// Most managed MySQL providers require TLS and refuse a plaintext connection.
// DB_SSL=true is the usual case; DB_SSL_CA carries a provider's CA certificate
// inline when it issues one; DB_SSL=skip-verify is the escape hatch for a
// self-signed server certificate and should not be used over the open internet.
function dbSslOption() {
    if (process.env.DB_SSL_CA) {
        return { ca: process.env.DB_SSL_CA, rejectUnauthorized: true };
    }
    const flag = String(process.env.DB_SSL || '').trim().toLowerCase();
    if (flag === 'true' || flag === '1' || flag === 'required') return { rejectUnauthorized: true };
    if (flag === 'skip-verify') return { rejectUnauthorized: false };
    return null;
}

const DB_SSL = dbSslOption();

const DB_CONFIG = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'clinic_v2',
    ...(DB_SSL ? { ssl: DB_SSL } : {})
};

const pool = mysql.createPool({
    ...DB_CONFIG,
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
    queueLimit: 0
});

// How long to keep trying before giving up on the database at boot. This is
// here for containers: `docker compose up` starts the app and MySQL together,
// and MySQL takes several seconds to become reachable on a cold volume. The
// same patience covers a managed database that is briefly unavailable while a
// platform restarts the app around it.
const DB_CONNECT_RETRIES = Number(process.env.DB_CONNECT_RETRIES) || 15;
const DB_CONNECT_DELAY_MS = Number(process.env.DB_CONNECT_DELAY_MS) || 2000;

// Codes that mean "not up yet" rather than "wrong". Retrying a bad password or
// an unresolvable hostname only delays a failure that will never resolve, and
// hides the real cause behind thirty seconds of waiting.
const DB_TRANSIENT_CODES = new Set([
    'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'EPIPE',
    'PROTOCOL_CONNECTION_LOST', 'ER_CON_COUNT_ERROR', 'ER_SERVER_SHUTDOWN'
]);

async function connectWithRetry(config) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await mysql.createConnection(config);
        } catch (err) {
            if (!DB_TRANSIENT_CODES.has(err.code) || attempt >= DB_CONNECT_RETRIES) throw err;
            console.log(`[DB] ${config.host}:${config.port} not ready yet (${err.code}) - retrying in ${DB_CONNECT_DELAY_MS / 1000}s [${attempt}/${DB_CONNECT_RETRIES}]`);
            await new Promise(resolve => setTimeout(resolve, DB_CONNECT_DELAY_MS));
        }
    }
}

// The result forms that used to live as a `testTemplates` object inside
// public/laboratory.js, plus the three that had no structured fields at all and
// fell through to a plain findings box. They are seeded once so an existing
// deployment keeps the exact forms its staff already know; after that they are
// the administrators' to change.
const DEFAULT_TEST_STRUCTURES = [
    {
        name: 'Complete Blood Count (CBC)', input_mode: 'structured',
        description: 'Standard haematology panel.',
        fields: [
            { label: 'White Blood Cell (WBC)', unit: 'x10^9/L', reference_range: '4.0 - 10.0', default_value: '6.5' },
            { label: 'Red Blood Cell (RBC)', unit: 'x10^12/L', reference_range: '4.5 - 5.9', default_value: '5.0' },
            { label: 'Hemoglobin', unit: 'g/dL', reference_range: '13.5 - 17.5', default_value: '14.2' },
            { label: 'Hematocrit', unit: '%', reference_range: '41 - 50', default_value: '43' },
            { label: 'Platelet Count', unit: 'x10^9/L', reference_range: '150 - 450', default_value: '280' }
        ]
    },
    {
        name: 'Blood Chemistry', input_mode: 'structured',
        description: 'Fasting metabolic and lipid markers.',
        fields: [
            { label: 'Fasting Blood Sugar (FBS)', unit: 'mg/dL', reference_range: '70 - 99', default_value: '88' },
            { label: 'Blood Urea Nitrogen (BUN)', unit: 'mg/dL', reference_range: '7 - 20', default_value: '12' },
            { label: 'Creatinine', unit: 'mg/dL', reference_range: '0.6 - 1.2', default_value: '0.9' },
            { label: 'Total Cholesterol', unit: 'mg/dL', reference_range: '< 200', default_value: '175' }
        ]
    },
    {
        name: 'Urinalysis', input_mode: 'structured',
        description: 'Physical and chemical urine examination.',
        fields: [
            { label: 'Color', field_type: 'text', reference_range: 'Pale Yellow - Straw', default_value: 'Yellow' },
            { label: 'pH', reference_range: '4.5 - 8.0', default_value: '6.0' },
            { label: 'Specific Gravity', reference_range: '1.005 - 1.030', default_value: '1.015' }
        ]
    },
    {
        name: 'X-Ray Scan', input_mode: 'freeform',
        description: 'Radiographic reading, written up as a report.', fields: []
    },
    {
        name: 'Ultrasound', input_mode: 'freeform',
        description: 'Sonographic findings, written up as a report.', fields: []
    },
    {
        name: 'Other Diagnostics', input_mode: 'freeform',
        description: 'Anything without a fixed form - notes, observations and unstructured findings.',
        fields: []
    }
];

const DEFAULT_SERVICES = [
    { name: 'Hematology (CBC)', price: 450, description: 'Complete blood count screening.', est_time_minutes: 15, category: 'Laboratory' },
    { name: 'Clinical Microscopy', price: 300, description: 'Routine clinical microscopy service.', est_time_minutes: 15, category: 'Laboratory' },
    { name: 'Ultrasound', price: 2800, description: 'Diagnostic ultrasound imaging.', est_time_minutes: 30, category: 'Imaging' },
    { name: 'X-ray', price: 900, description: 'Diagnostic X-ray imaging.', est_time_minutes: 20, category: 'Imaging' },
    { name: '2D Echocardiography', price: 6000, description: '2D echocardiography heart imaging.', est_time_minutes: 45, category: 'Cardiology' },
    { name: 'Venous Duplex Scan', price: 4500, description: 'Venous duplex vascular scan.', est_time_minutes: 45, category: 'Vascular' },
    { name: 'Arterial Duplex Scan', price: 5800, description: 'Arterial duplex vascular scan.', est_time_minutes: 45, category: 'Vascular' },
    { name: 'Carotid Duplex Scan', price: 6000, description: 'Carotid duplex vascular scan.', est_time_minutes: 45, category: 'Vascular' },
    { name: 'Holter Monitoring', price: 6500, description: 'Holter cardiac monitoring service.', est_time_minutes: 30, category: 'Cardiology' },
    { name: '24-Hour Ambulatory BP Monitoring', price: 5000, description: '24-hour ambulatory blood pressure monitoring.', est_time_minutes: 30, category: 'Cardiology' },
    { name: 'ECG / FCG', price: 1300, description: 'Electrocardiogram / FCG service.', est_time_minutes: 20, category: 'Cardiology' },
    { name: 'Blood Chemistry', price: 4500, description: 'Blood chemistry laboratory panel.', est_time_minutes: 25, category: 'Laboratory' },
    { name: 'Serology Exams', price: 2500, description: 'Serology laboratory exams.', est_time_minutes: 25, category: 'Laboratory' },
    { name: 'Drug Testing', price: 900, description: 'Drug testing service.', est_time_minutes: 20, category: 'Screening' },
    { name: 'HIV Screening', price: 1200, description: 'HIV screening test.', est_time_minutes: 20, category: 'Screening' },
    { name: 'Annual Physical Exam', price: 3500, description: 'Annual physical examination package.', est_time_minutes: 45, category: 'Check-up' },
    { name: 'Pre-Employment Medical', price: 3500, description: 'Pre-employment medical examination package.', est_time_minutes: 45, category: 'Check-up' },
    { name: 'Rapid Antibody Test', price: 1500, description: 'Rapid antibody testing service.', est_time_minutes: 20, category: 'Screening' }
];

// One seed account per clinic position, modelled on how a DOH-licensed primary
// clinic / diagnostic centre is actually staffed: a receptionist at the front
// desk, a Registered Medical Technologist (RMT) per laboratory section, a
// Registered Radiologic Technologist (RRT) for imaging, a cardiovascular
// technologist for the cardiac tests, a nurse for vitals, an HIV counsellor
// (required by RA 11166), and physicians who read/interpret results.
//
// `position` is documentation only - it is not a users column. Names are
// sample data for a dev database; change them (and the passwords) before any
// real deployment.
const STAFF_SEEDS = [
    { username: 'owner1', password: 'owner123', role: 'owner', position: 'Owner / Medical Director',
      first_name: 'Ramon', middle_name: 'Bautista', surname: 'Villanueva' },
    { username: 'admin_regular', password: 'admin123', role: 'admin', position: 'Clinic Administrator',
      first_name: 'Teresita', middle_name: 'Mendoza', surname: 'Rosales' },
    { username: 'admin_tech', password: 'admin123', role: 'admintechnical', position: 'Technical / IT Administrator',
      first_name: 'Joel', middle_name: 'Pascual', surname: 'Bautista' },
    { username: 'frontdesk1', password: 'pass123', role: 'frontdesk', position: 'Front Desk Receptionist',
      first_name: 'Angeli', middle_name: 'Cruz', surname: 'Domingo' },
    { username: 'nurse_vitals', password: 'pass123', role: 'laboratory', position: 'Staff Nurse (Vital Signs)',
      first_name: 'Grace', middle_name: 'Padilla', surname: 'Villamor' },
    { username: 'lab_blood', password: 'pass123', role: 'laboratory', position: 'Medical Technologist - Hematology & Clinical Chemistry',
      first_name: 'Marites', middle_name: 'Lopez', surname: 'Saavedra' },
    { username: 'lab_micro', password: 'pass123', role: 'laboratory', position: 'Medical Technologist - Clinical Microscopy',
      first_name: 'Ferdinand', middle_name: 'Reyes', surname: 'Ocampo' },
    { username: 'lab_xray', password: 'pass123', role: 'laboratory', position: 'Radiologic Technologist',
      first_name: 'Dennis', middle_name: 'Alonzo', surname: 'Fabregas' },
    { username: 'lab_ultrasound', password: 'pass123', role: 'laboratory', position: 'Sonographer (Ultrasound & Duplex Scans)',
      first_name: 'Katrina', middle_name: 'Jimenez', surname: 'Escuadro' },
    { username: 'lab_cardio', password: 'pass123', role: 'laboratory', position: 'Cardiovascular Technologist',
      first_name: 'Alvin', middle_name: 'Molina', surname: 'Delos Reyes' },
    { username: 'lab_counselor', password: 'pass123', role: 'laboratory', position: 'HIV Counsellor (RA 11166)',
      first_name: 'Rowena', middle_name: 'Fajardo', surname: 'Lacsamana' },
    { username: 'doctor1', password: 'pass123', role: 'doctor', position: 'Physician - General / Family Medicine',
      first_name: 'Alfredo', middle_name: 'Salazar', surname: 'Mercado' },
    { username: 'doctor_cardio', password: 'pass123', role: 'doctor', position: 'Internist - Cardiology',
      first_name: 'Maria Cristina', middle_name: 'Herrera', surname: 'Aguilar' },
    { username: 'customer_regular', password: 'pass123', role: 'customer', category: 'Regular',
      first_name: 'Miguel', middle_name: 'Torres', surname: 'Panganiban' },
    { username: 'customer_senior', password: 'pass123', role: 'customer', category: 'Senior',
      first_name: 'Rosario', middle_name: 'Guevarra', surname: 'Nazareno' },
    { username: 'customer_pwd', password: 'pass123', role: 'customer', category: 'PWD',
      first_name: 'Elmer', middle_name: 'Dizon', surname: 'Cabrera' },
    { username: 'customer_pregnant', password: 'pass123', role: 'customer', category: 'Pregnant',
      first_name: 'Jocelyn', middle_name: 'Ramos', surname: 'Enriquez' },
    { username: 'customer_senior2', password: 'pass123', role: 'customer', category: 'Senior',
      first_name: 'Consuelo', middle_name: 'Aguilar', surname: 'Macaraeg' },
    { username: 'customer_regular2', password: 'pass123', role: 'customer', category: 'Regular',
      first_name: 'Rogelio', middle_name: 'Santos', surname: 'Dela Cruz' },
    { username: 'customer_pwd2', password: 'pass123', role: 'customer', category: 'PWD',
      first_name: 'Samantha', middle_name: 'Villanueva', surname: 'Reyes' }
];

// Physical stations a ticket can be routed to. The queue engine only knows
// three station types (frontdesk / laboratory / doctor), so every non-desk,
// non-physician stop is a `laboratories` row - including the counselling room.
const LAB_SEEDS = [
    { name: 'Physical', service_type: 'Physical', staff: 'nurse_vitals' },
    { name: 'Blood Test Lab', service_type: 'Blood Test', staff: 'lab_blood' },
    { name: 'Specimen', service_type: 'Handoff (feces and Urine)', staff: 'lab_micro' },
    { name: 'X-Ray Room', service_type: 'X-Ray', staff: 'lab_xray' },
    { name: 'Ultrasound Room', service_type: 'Ultrasound', staff: 'lab_ultrasound' },
    { name: 'Cardiac Diagnostics', service_type: 'ECG / 2D Echo / Holter', staff: 'lab_cardio' },
    { name: 'Counseling Room', service_type: 'HIV Counseling', staff: 'lab_counselor' }
];

const DOCTOR_SEEDS = [
    { name: 'Dr. Alfredo Mercado', specialty: 'General Medicine', staff: 'doctor1', replaces: 'General Physician' },
    { name: 'Dr. Maria Cristina Aguilar', specialty: 'Cardiology', staff: 'doctor_cardio' }
];

// Station sequence per service. Front desk is always step 0 (the queue engine
// prepends it), so these list only what comes after registration.
//
// The ordering follows the standard Philippine out-patient flow - register and
// take vitals at the desk, give specimens, get imaged, then see a physician who
// interprets the results - and these rules:
//   * Blood-drawn tests (CBC, chemistry, serology, HIV, rapid antibody) go to
//     the blood extraction bench.
//   * DOH AO 2007-0027 puts urinalysis and fecalysis under Clinical
//     Microscopy, so those (and urine drug testing) go to the specimen window.
//   * A standalone diagnostic test ends at the station: the radiologist /
//     pathologist reads it offline and the result is released, which is why a
//     P450 CBC has no consultation attached.
//   * Tests a physician must walk the patient through - echocardiography,
//     duplex scans, Holter, 24h ABPM - end at the cardiologist, and the
//     check-up packages end at the general physician.
//   * HIV screening is bracketed by pre-test and post-test counselling, which
//     RA 11166 requires every HIV testing facility to provide.
const SERVICE_STEPS = {
    'Hematology (CBC)':                 { stations: [{ at: 'Blood Test Lab', minutes: 10 }], doctor: null },
    'Clinical Microscopy':              { stations: [{ at: 'Specimen', minutes: 10 }], doctor: null },
    'Blood Chemistry':                  { stations: [{ at: 'Blood Test Lab', minutes: 15 }], doctor: null },
    'Serology Exams':                   { stations: [{ at: 'Blood Test Lab', minutes: 15 }], doctor: null },
    'Rapid Antibody Test':              { stations: [{ at: 'Blood Test Lab', minutes: 15 }], doctor: null },
    'Drug Testing':                     { stations: [{ at: 'Specimen', minutes: 15 }], doctor: null },
    'X-ray':                            { stations: [{ at: 'X-Ray Room', minutes: 15 }], doctor: null },
    'Ultrasound':                       { stations: [{ at: 'Ultrasound Room', minutes: 25 }], doctor: null },
    'ECG / FCG':                        { stations: [{ at: 'Cardiac Diagnostics', minutes: 15 }], doctor: null },

    'HIV Screening':                    { stations: [
                                            { at: 'Counseling Room', minutes: 15 },   // pre-test counselling
                                            { at: 'Blood Test Lab', minutes: 10 },
                                            { at: 'Counseling Room', minutes: 15 }    // post-test counselling
                                          ], doctor: null },

    '2D Echocardiography':              { stations: [{ at: 'Cardiac Diagnostics', minutes: 30 }], doctor: 'Cardiology' },
    'Holter Monitoring':                { stations: [{ at: 'Cardiac Diagnostics', minutes: 20 }], doctor: 'Cardiology' },
    '24-Hour Ambulatory BP Monitoring': { stations: [{ at: 'Cardiac Diagnostics', minutes: 20 }], doctor: 'Cardiology' },
    'Venous Duplex Scan':               { stations: [{ at: 'Ultrasound Room', minutes: 35 }], doctor: 'Cardiology' },
    'Arterial Duplex Scan':             { stations: [{ at: 'Ultrasound Room', minutes: 35 }], doctor: 'Cardiology' },
    'Carotid Duplex Scan':              { stations: [{ at: 'Ultrasound Room', minutes: 35 }], doctor: 'Cardiology' },

    // Comprehensive annual screening: vitals, the primary-category lab panel,
    // chest X-ray, and an ECG, all read out by the physician at the end.
    'Annual Physical Exam':             { stations: [
                                            { at: 'Physical', minutes: 10 },
                                            { at: 'Blood Test Lab', minutes: 10 },
                                            { at: 'Specimen', minutes: 10 },
                                            { at: 'X-Ray Room', minutes: 15 },
                                            { at: 'Cardiac Diagnostics', minutes: 15 }
                                          ], doctor: 'General Medicine' },

    // Standard PEME battery - physical exam, CBC, urinalysis/fecalysis, chest
    // X-ray, drug test - then the physician who signs the fit-to-work
    // certificate. No ECG: that is an add-on, not part of the basic panel.
    'Pre-Employment Medical':           { stations: [
                                            { at: 'Physical', minutes: 10 },
                                            { at: 'Blood Test Lab', minutes: 10 },
                                            { at: 'Specimen', minutes: 15 },
                                            { at: 'X-Ray Room', minutes: 15 }
                                          ], doctor: 'General Medicine' }
};

async function addColumnIfMissing(table, column, definition) {
    try {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (err) {
        if (err.code !== 'ER_DUP_FIELDNAME') throw err;
    }
}

async function addIndexIfMissing(table, indexName, definition) {
    try {
        await pool.query(`ALTER TABLE ${table} ADD INDEX ${indexName} ${definition}`);
    } catch (err) {
        if (err.code !== 'ER_DUP_KEYNAME') throw err;
    }
}

async function initDB() {
    try {
        // Connects without a database selected so the schema can be created on a
        // fresh server, and waits for the server to come up - see
        // connectWithRetry above for why that matters in a container.
        const connection = await connectWithRetry({
            host: DB_CONFIG.host, port: DB_CONFIG.port,
            user: DB_CONFIG.user, password: DB_CONFIG.password,
            ...(DB_SSL ? { ssl: DB_SSL } : {})
        });

        try {
            // Backtick-quoted: a database name from the environment may contain
            // characters that need quoting, and it never comes from user input.
            await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\`;`);
        } catch (err) {
            // A managed provider hands you one database and withholds CREATE.
            // MySQL checks the privilege *before* it checks IF NOT EXISTS, so
            // this throws even when the database is already there and every
            // statement after it would have succeeded - which used to stop the
            // app booting against a perfectly good hosted database.
            if (err.errno === 1044 || err.errno === 1227) {
                console.log(`[DB] No CREATE DATABASE grant - assuming "${DB_CONFIG.database}" already exists.`);
            } else {
                await connection.end().catch(() => {});
                throw err;
            }
        }
        await connection.end();

        console.log(`[DB] Database ${DB_CONFIG.database} ready on ${DB_CONFIG.host}:${DB_CONFIG.port}.`);

        // Users
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role ENUM('admintechnical','admin','customer','frontdesk','laboratory','owner','doctor') NOT NULL DEFAULT 'customer',
                customer_category ENUM('Regular','Senior','PWD','Pregnant') DEFAULT NULL,
                customer_uid VARCHAR(30) DEFAULT NULL UNIQUE,
                full_name VARCHAR(255) DEFAULT '',
                surname VARCHAR(100) DEFAULT '',
                first_name VARCHAR(100) DEFAULT '',
                middle_name VARCHAR(100) DEFAULT '',
                no_middle_name BOOLEAN DEFAULT false,
                email VARCHAR(255) DEFAULT '',
                birthday DATE DEFAULT NULL,
                gender ENUM('Male','Female','Other') DEFAULT NULL,
                verification_method ENUM('id','guardian') DEFAULT 'id',
                is_underage BOOLEAN DEFAULT false,
                guardian_name VARCHAR(255) DEFAULT '',
                guardian_contact VARCHAR(100) DEFAULT '',
                guardian_relationship VARCHAR(100) DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                reset_token VARCHAR(255),
                reset_expiry DATETIME,
                reset_otp VARCHAR(10) DEFAULT NULL,
                reset_otp_attempts INT DEFAULT 0,
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL
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
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL,
                FOREIGN KEY (assigned_staff_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Doctors
        await pool.query(`
            CREATE TABLE IF NOT EXISTS doctors (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                specialty VARCHAR(100) DEFAULT '',
                assigned_staff_id INT DEFAULT NULL,
                is_open BOOLEAN DEFAULT true,
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL,
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
                category VARCHAR(60) NOT NULL DEFAULT 'General',
                doctor_id INT DEFAULT NULL,
                is_active BOOLEAN DEFAULT true,
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL
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
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL,
                FOREIGN KEY (package_id) REFERENCES service_packages(id) ON DELETE CASCADE,
                FOREIGN KEY (laboratory_id) REFERENCES laboratories(id) ON DELETE CASCADE
            )
        `);

        // Queue table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS queue (
                id VARCHAR(100) PRIMARY KEY,
                station_type ENUM('frontdesk','laboratory','doctor') NOT NULL DEFAULT 'frontdesk',
                station_id INT DEFAULT NULL,
                number VARCHAR(30) NOT NULL,
                type VARCHAR(10) NOT NULL,
                status ENUM('waiting','serving','on-hold','completed','cancelled') NOT NULL DEFAULT 'waiting',
                customer_id INT DEFAULT NULL,
                sequence_id INT DEFAULT NULL,
                step_index INT DEFAULT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL,
                FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Medical test structures: the shape of the result form for a kind of
        // test. These used to be a hardcoded object in public/laboratory.js,
        // which meant only a developer could add a test or correct a reference
        // range. input_mode 'freeform' is the "Other Diagnostics" case - no
        // fields at all, just the rich text notepad.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS test_structures (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(120) NOT NULL,
                description VARCHAR(255) DEFAULT NULL,
                input_mode ENUM('structured','freeform') NOT NULL DEFAULT 'structured',
                is_active BOOLEAN DEFAULT true,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL,
                UNIQUE KEY uniq_test_structure_name (name)
            )
        `);

        // One measured parameter of a structured test: what to type in, what
        // unit it is in, and what counts as normal.
        await pool.query(`
            CREATE TABLE IF NOT EXISTS test_structure_fields (
                id INT AUTO_INCREMENT PRIMARY KEY,
                structure_id INT NOT NULL,
                label VARCHAR(120) NOT NULL,
                unit VARCHAR(40) DEFAULT NULL,
                reference_range VARCHAR(120) DEFAULT NULL,
                field_type ENUM('number','text','select') NOT NULL DEFAULT 'number',
                options VARCHAR(500) DEFAULT NULL,
                default_value VARCHAR(120) DEFAULT NULL,
                sort_order INT DEFAULT 0,
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL,
                FOREIGN KEY (structure_id) REFERENCES test_structures(id) ON DELETE CASCADE
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
                status ENUM('in_progress','completed','unfinished','cancelled') DEFAULT 'in_progress',
                started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME DEFAULT NULL,
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL,
                FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (package_id) REFERENCES service_packages(id) ON DELETE CASCADE
            )
        `);

        // Queue Logs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS queue_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                station_type ENUM('frontdesk','laboratory','doctor') DEFAULT 'frontdesk',
                station_id INT DEFAULT NULL,
                ticket_number VARCHAR(30),
                type VARCHAR(10),
                customer_id INT DEFAULT NULL,
                sequence_id INT DEFAULT NULL,
                package_name VARCHAR(150) DEFAULT '',
                price DECIMAL(10,2) DEFAULT 0,
                join_time DATETIME,
                serve_time DATETIME DEFAULT NULL,
                complete_time DATETIME DEFAULT NULL,
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL
            )
        `);

        // Appointments
        //
        // `notes` carries no DEFAULT on purpose. MySQL forbids a default on a
        // TEXT column and rejects the entire CREATE TABLE for it under
        // STRICT_TRANS_TABLES; MariaDB has allowed it since 10.2, which is why
        // `notes TEXT DEFAULT ''` sat here unnoticed on the XAMPP install this
        // was written against and then stopped the app booting the first time it
        // met a real MySQL server. Nothing depended on the default - the only
        // writer, POST /appointments in routes/admin.js, always passes a string.
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
                notes TEXT,
                qr_token VARCHAR(120) DEFAULT NULL,
                checked_in_at DATETIME DEFAULT NULL,
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL,
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
                house_number VARCHAR(100) DEFAULT '',
                street VARCHAR(255) DEFAULT '',
                barangay VARCHAR(255) DEFAULT '',
                city VARCHAR(255) DEFAULT '',
                province VARCHAR(255) DEFAULT '',
                phone VARCHAR(50) DEFAULT '',
                status VARCHAR(50) DEFAULT '',
                occupation VARCHAR(100) DEFAULT '',
                retiree BOOLEAN DEFAULT false,
                emergency_contact VARCHAR(255) DEFAULT '',
                current_health TEXT,
                past_conditions TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL,
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
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL,
                FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Clinical Records
        await pool.query(`
            CREATE TABLE IF NOT EXISTS clinical_records (
                id INT AUTO_INCREMENT PRIMARY KEY,
                customer_id INT NOT NULL,
                sequence_id INT DEFAULT NULL,
                record_type ENUM('lab_result','examination','diagnostic','prescription') NOT NULL,
                data JSON DEFAULT NULL,
                notes TEXT DEFAULT NULL,
                staff_id INT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                archived BOOLEAN DEFAULT false,
                archived_at DATETIME DEFAULT NULL,
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
                navbar_color VARCHAR(50) DEFAULT '#24303A',
                background_image VARCHAR(255) DEFAULT ''
            )
        `);
        await pool.query(`INSERT IGNORE INTO settings (id) VALUES (1)`);

        // Added after the table shipped, so it goes through the helper rather
        // than the CREATE above - an existing install picks it up on next boot.
        // Bounds live in session_activity.js; this default matches its own.
        await addColumnIfMissing('settings', 'idle_timeout_minutes', 'INT DEFAULT 15');

        // navbar_color drives the sidebar background (--bg-sidebar in shared.css),
        // which the design paints #24303A. The original schema default was #ffffff -
        // written for a top navbar that never shipped, and never applied to anything
        // until the Customize page started taking effect. Correct the untouched
        // default so existing installs don't come back with a white sidebar; a
        // colour an admin actually picked is left alone.
        await pool.query(
            `UPDATE settings SET navbar_color='#24303A'
             WHERE id=1 AND (navbar_color IS NULL OR navbar_color='' OR navbar_color='#ffffff')`
        );

        // Audit Logs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                action VARCHAR(100) NOT NULL,
                entity_type VARCHAR(50),
                entity_id INT DEFAULT NULL,
                details TEXT,
                summary VARCHAR(255) DEFAULT '',
                reason TEXT,
                before_snapshot JSON DEFAULT NULL,
                after_snapshot JSON DEFAULT NULL,
                performed_by INT DEFAULT NULL,
                actor_name VARCHAR(255) DEFAULT '',
                actor_role VARCHAR(40) DEFAULT '',
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
                last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
                logout_time DATETIME DEFAULT NULL,
                end_reason VARCHAR(30) DEFAULT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Account Deletion Logs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS account_deletion_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                account_id INT NOT NULL,
                account_name VARCHAR(255),
                deleted_by INT,
                deleted_by_name VARCHAR(255),
                reason TEXT,
                deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Pricing FAQs / service price reference
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pricing_faqs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                service_name VARCHAR(150) NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                description TEXT
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS archived_records (
                id INT AUTO_INCREMENT PRIMARY KEY,
                entity_type VARCHAR(60) NOT NULL,
                entity_id VARCHAR(100) NOT NULL,
                snapshot JSON DEFAULT NULL,
                label VARCHAR(255) DEFAULT '',
                reason TEXT,
                archived_by INT DEFAULT NULL,
                archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                restored_at DATETIME DEFAULT NULL,
                permanently_deleted_at DATETIME DEFAULT NULL,
                INDEX idx_archive_entity (entity_type, entity_id),
                FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // Ticket counters (atomic per-day-per-station numbering)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ticket_counters (
                counter_date DATE NOT NULL,
                station_type VARCHAR(20) NOT NULL,
                station_id INT NOT NULL DEFAULT 0,
                count INT NOT NULL DEFAULT 0,
                PRIMARY KEY (counter_date, station_type, station_id)
            )
        `);

        // AI feature toggles + logs (used by ai_services.js)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_settings (
                id INT PRIMARY KEY DEFAULT 1,
                ocr_enabled BOOLEAN DEFAULT true,
                anomaly_enabled BOOLEAN DEFAULT true,
                announcement_enabled BOOLEAN DEFAULT true,
                cutoff_enabled BOOLEAN DEFAULT true,
                estimation_enabled BOOLEAN DEFAULT true,
                performance_enabled BOOLEAN DEFAULT true,
                feedback_enabled BOOLEAN DEFAULT true,
                report_enabled BOOLEAN DEFAULT true,
                prediction_enabled BOOLEAN DEFAULT true,
                assistant_enabled BOOLEAN DEFAULT true
            )
        `);
        await pool.query(`INSERT IGNORE INTO ai_settings (id) VALUES (1)`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                feature VARCHAR(100) DEFAULT '',
                input_data JSON DEFAULT NULL,
                output_data JSON DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Pending registrations (multi-step signup with email/OTP verification)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pending_registrations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                token VARCHAR(64) UNIQUE NOT NULL,
                username VARCHAR(50) NOT NULL,
                email VARCHAR(255) NOT NULL,
                password_hash VARCHAR(255) DEFAULT NULL,
                verification_method ENUM('id','guardian') NOT NULL DEFAULT 'id',
                is_underage BOOLEAN DEFAULT false,
                guardian_name VARCHAR(255) DEFAULT '',
                guardian_contact VARCHAR(100) DEFAULT '',
                guardian_relationship VARCHAR(100) DEFAULT '',
                front_id_path VARCHAR(255) DEFAULT NULL,
                back_id_path VARCHAR(255) DEFAULT NULL,
                detected_category VARCHAR(20) DEFAULT 'Regular',
                detected_name VARCHAR(255) DEFAULT '',
                detected_birthday DATE DEFAULT NULL,
                detected_gender VARCHAR(20) DEFAULT NULL,
                otp_code VARCHAR(10) DEFAULT NULL,
                otp_expires_at DATETIME DEFAULT NULL,
                otp_attempts INT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME DEFAULT NULL,
                INDEX idx_token (token),
                INDEX idx_expires (expires_at)
            )
        `);

        // Seed ticket counters from existing logs so numbering continues after an upgrade
        try {
            await pool.query(`
                INSERT INTO ticket_counters (counter_date, station_type, station_id, count)
                SELECT DATE(join_time), station_type, COALESCE(station_id, 0), COUNT(*)
                FROM queue_logs
                WHERE archived = false AND join_time IS NOT NULL
                GROUP BY DATE(join_time), station_type, COALESCE(station_id, 0)
                ON DUPLICATE KEY UPDATE count = GREATEST(ticket_counters.count, VALUES(count))
            `);
        } catch (e) { console.error('[DB] Failed to seed ticket counters:', e.message); }

        const archiveTables = ['users', 'laboratories', 'doctors', 'service_packages', 'package_laboratories', 'queue', 'queue_sequences', 'queue_logs', 'appointments', 'medical_records', 'lab_notes'];
        for (const table of archiveTables) {
            await addColumnIfMissing(table, 'archived', 'BOOLEAN DEFAULT false');
            await addColumnIfMissing(table, 'archived_at', 'DATETIME DEFAULT NULL');
        }
        await addColumnIfMissing('users', 'surname', "VARCHAR(100) DEFAULT ''");
        await addColumnIfMissing('users', 'first_name', "VARCHAR(100) DEFAULT ''");
        await addColumnIfMissing('users', 'middle_name', "VARCHAR(100) DEFAULT ''");
        await addColumnIfMissing('users', 'no_middle_name', 'BOOLEAN DEFAULT false');
        await addColumnIfMissing('users', 'customer_uid', 'VARCHAR(30) DEFAULT NULL UNIQUE');
        await addColumnIfMissing('users', 'verification_method', "ENUM('id','guardian') DEFAULT 'id'");
        await addColumnIfMissing('users', 'is_underage', 'BOOLEAN DEFAULT false');
        await addColumnIfMissing('users', 'guardian_name', "VARCHAR(255) DEFAULT ''");
        await addColumnIfMissing('users', 'guardian_contact', "VARCHAR(100) DEFAULT ''");
        await addColumnIfMissing('users', 'guardian_relationship', "VARCHAR(100) DEFAULT ''");
        await addColumnIfMissing('users', 'reset_otp', 'VARCHAR(10) DEFAULT NULL');
        await addColumnIfMissing('users', 'reset_otp_attempts', 'INT DEFAULT 0');
        await addColumnIfMissing('users', 'terms_accepted_at', 'DATETIME DEFAULT NULL');
        // A patient the front desk registered at the counter because they had no
        // phone to register on. It is an ordinary customer row - that is the
        // point, since queue_sequences.customer_id is a NOT NULL foreign key into
        // this table and every queue mechanism keys off it - but it was created by
        // staff rather than claimed by the person, so it has no usable password
        // and login refuses it outright (see routes/auth.js).
        await addColumnIfMissing('users', 'is_walk_in', 'BOOLEAN DEFAULT false');
        await addColumnIfMissing('users', 'walk_in_created_by', 'INT DEFAULT NULL');
        await addIndexIfMissing('users', 'idx_users_walk_in', '(is_walk_in, archived)');
        // Structured address parts. `medical_records.address` is kept as the
        // composed human-readable string every existing reader already uses
        // (profile card, PDF export, staff views); these columns store the
        // pieces so the cascading dropdowns can be repopulated on reopen.
        await addColumnIfMissing('medical_records', 'house_number', "VARCHAR(100) DEFAULT ''");
        await addColumnIfMissing('medical_records', 'street', "VARCHAR(255) DEFAULT ''");
        await addColumnIfMissing('medical_records', 'barangay', "VARCHAR(255) DEFAULT ''");
        await addColumnIfMissing('medical_records', 'city', "VARCHAR(255) DEFAULT ''");
        await addColumnIfMissing('medical_records', 'province', "VARCHAR(255) DEFAULT ''");
        await addColumnIfMissing('appointments', 'qr_token', 'VARCHAR(120) DEFAULT NULL');
        await addColumnIfMissing('appointments', 'checked_in_at', 'DATETIME DEFAULT NULL');
        await addIndexIfMissing('appointments', 'idx_appointments_qr_token', '(qr_token)');
        await addColumnIfMissing('service_packages', 'doctor_id', 'INT DEFAULT NULL');
        await addColumnIfMissing('ai_settings', 'assistant_enabled', 'BOOLEAN DEFAULT true');
        await addColumnIfMissing('queue_sequences', 'has_doctor_step', 'BOOLEAN DEFAULT false');
        await addColumnIfMissing('queue_sequences', 'doctor_id', 'INT DEFAULT NULL');
        await addColumnIfMissing('queue', 'sample_ready_at', 'DATETIME DEFAULT NULL');
        await addColumnIfMissing('queue', 'priority_boost', 'INT DEFAULT 0');
        await addColumnIfMissing('announcements', 'created_by', 'INT DEFAULT NULL');
        await addColumnIfMissing('announcements', 'archived', 'BOOLEAN DEFAULT false');
        await addColumnIfMissing('announcements', 'archived_at', 'DATETIME DEFAULT NULL');

        // Which step of the visit a queue row belongs to. Previously this was only
        // encoded in the row's id suffix ("..._s2"), which made "is this the final
        // front desk step?" and the call-back rollback guesswork. Backfilled below.
        // Which result form a service expects. The laboratory can still pick a
        // different structure for an individual visit - this is the default the
        // workspace opens on.
        await addColumnIfMissing('service_packages', 'test_structure_id', 'INT DEFAULT NULL');
        await addIndexIfMissing('test_structure_fields', 'idx_tsf_structure', '(structure_id, sort_order)');

        await addColumnIfMissing('queue', 'step_index', 'INT DEFAULT NULL');
        // Front desk re-insertion (line cutting): the 1-based slot this row should
        // occupy in its station's waiting list, overriding priority scoring for
        // this row only. See getNextFromList in queue_automation.js.
        await addColumnIfMissing('queue', 'reinsert_slot', 'INT DEFAULT NULL');
        // The row this one must be called immediately after. Anchoring to a
        // specific neighbour rather than to a rank is what makes a re-insertion a
        // one-time placement: a stored rank would silently re-apply itself as the
        // line drained, so the patient stayed second forever instead of being
        // called once the patient ahead of them was done.
        await addColumnIfMissing('queue', 'reinsert_after', 'VARCHAR(100) DEFAULT NULL');
        await addColumnIfMissing('queue', 'reinserted_at', 'DATETIME DEFAULT NULL');
        await addColumnIfMissing('queue', 'reinserted_by', 'INT DEFAULT NULL');
        // "Parked" is now "On-Hold" everywhere. New columns rather than a rename so
        // the copy below can run before the old ones are dropped.
        await addColumnIfMissing('queue', 'hold_reason', 'VARCHAR(60) DEFAULT NULL');
        await addColumnIfMissing('queue', 'hold_at', 'DATETIME DEFAULT NULL');
        // How the front desk closed the visit, and why. Only the front desk writes
        // these - it is the final gatekeeper for every service route.
        await addColumnIfMissing('queue_sequences', 'outcome', 'VARCHAR(20) DEFAULT NULL');
        await addColumnIfMissing('queue_sequences', 'outcome_reason', 'TEXT');
        await addColumnIfMissing('queue_sequences', 'finalized_by', 'INT DEFAULT NULL');
        await addColumnIfMissing('queue_sequences', 'finalized_at', 'DATETIME DEFAULT NULL');
        // Audit trail: what / who / when / why, plus the before+after snapshots.
        await addColumnIfMissing('audit_logs', 'summary', "VARCHAR(255) DEFAULT ''");
        await addColumnIfMissing('audit_logs', 'reason', 'TEXT');
        await addColumnIfMissing('audit_logs', 'before_snapshot', 'JSON DEFAULT NULL');
        await addColumnIfMissing('audit_logs', 'after_snapshot', 'JSON DEFAULT NULL');
        await addColumnIfMissing('audit_logs', 'actor_name', "VARCHAR(255) DEFAULT ''");
        await addColumnIfMissing('audit_logs', 'actor_role', "VARCHAR(40) DEFAULT ''");
        await addIndexIfMissing('audit_logs', 'idx_audit_created', '(created_at)');
        // Staff idle-session tracking (15-minute inactivity timeout).
        await addColumnIfMissing('staff_sessions', 'last_activity', 'DATETIME DEFAULT NULL');
        await addColumnIfMissing('staff_sessions', 'end_reason', 'VARCHAR(30) DEFAULT NULL');
        await addIndexIfMissing('staff_sessions', 'idx_staff_sessions_open', '(user_id, logout_time)');
        // Archive list: a name a human can recognise, and why it was archived.
        await addColumnIfMissing('archived_records', 'label', "VARCHAR(255) DEFAULT ''");
        await addColumnIfMissing('archived_records', 'reason', 'TEXT');
        // Service catalogue filtering (customer-facing search by category).
        await addColumnIfMissing('service_packages', 'category', "VARCHAR(60) NOT NULL DEFAULT 'General'");
        await addIndexIfMissing('service_packages', 'idx_packages_category', '(category)');

        // Alter ENUMs to include 'doctor' / 'on-hold' safely (ignore if already present)
        try { await pool.query(`ALTER TABLE users MODIFY COLUMN role ENUM('admintechnical','admin','customer','frontdesk','laboratory','owner','doctor') NOT NULL DEFAULT 'customer'`); } catch(e) {}
        try { await pool.query(`ALTER TABLE queue MODIFY COLUMN station_type ENUM('frontdesk','laboratory','doctor') NOT NULL DEFAULT 'frontdesk'`); } catch(e) {}
        try { await pool.query(`ALTER TABLE queue_logs MODIFY COLUMN station_type ENUM('frontdesk','laboratory','doctor') DEFAULT 'frontdesk'`); } catch(e) {}

        // "Parked" -> "On-Hold" migration, in three steps so no row is ever left
        // holding a value the column does not allow: widen the ENUM to accept both
        // spellings, move the data across, then narrow it to the new spelling only.
        try { await pool.query(`ALTER TABLE queue MODIFY COLUMN status ENUM('waiting','serving','parked','on-hold','completed','cancelled') NOT NULL DEFAULT 'waiting'`); } catch(e) {}
        try { await pool.query(`UPDATE queue SET status='on-hold' WHERE status='parked'`); } catch(e) {}
        try { await pool.query(`UPDATE queue SET hold_reason=parked_reason WHERE hold_reason IS NULL AND parked_reason IS NOT NULL`); } catch(e) {}
        try { await pool.query(`UPDATE queue SET hold_at=parked_at WHERE hold_at IS NULL AND parked_at IS NOT NULL`); } catch(e) {}
        try { await pool.query(`ALTER TABLE queue MODIFY COLUMN status ENUM('waiting','serving','on-hold','completed','cancelled') NOT NULL DEFAULT 'waiting'`); } catch(e) {}
        try { await pool.query(`ALTER TABLE queue DROP COLUMN parked_reason`); } catch(e) {}
        try { await pool.query(`ALTER TABLE queue DROP COLUMN parked_at`); } catch(e) {}

        // 'unfinished' is set by the front desk when it closes a visit that did not
        // run to completion (see POST /api/queue/finalize).
        try { await pool.query(`ALTER TABLE queue_sequences MODIFY COLUMN status ENUM('in_progress','completed','unfinished','cancelled') DEFAULT 'in_progress'`); } catch(e) {}

        // Backfill step_index for rows written before the column existed. The id
        // suffix is the only record of the step for those: "cust_7_12" is step 0,
        // "cust_7_12_s2" is step 2.
        try {
            await pool.query("UPDATE queue SET step_index = 0 WHERE step_index IS NULL AND id NOT LIKE '%\\_s%'");
            await pool.query(`UPDATE queue SET step_index = CAST(SUBSTRING_INDEX(id, '_s', -1) AS UNSIGNED)
                              WHERE step_index IS NULL AND id LIKE '%\\_s%'`);
        } catch (e) { console.error('[DB] step_index backfill failed:', e.message); }
        // 'no-show' is set by the missed-appointment sweep in appointment_automation.js
        // when a scheduled slot passes its grace period without a check-in.
        try { await pool.query(`ALTER TABLE appointments MODIFY COLUMN status ENUM('scheduled','checked-in','completed','cancelled','no-show') DEFAULT 'scheduled'`); } catch(e) {}
        await addColumnIfMissing('appointments', 'no_show_at', 'DATETIME DEFAULT NULL');
        // Appointments are paid on site at the front desk and carry a priority
        // surcharge. amount_due is stored rather than recomputed from the package
        // so a later price change never alters what a patient was already quoted.
        await addColumnIfMissing('appointments', 'amount_due', 'DECIMAL(10,2) DEFAULT NULL');
        await addColumnIfMissing('appointments', 'surcharge_pct', 'INT DEFAULT 0');
        // Links a live queue journey back to the appointment that started it, and
        // carries the appointment's priority to every station in the sequence.
        await addColumnIfMissing('queue_sequences', 'appointment_id', 'INT DEFAULT NULL');
        await addColumnIfMissing('queue_sequences', 'priority_boost', 'INT DEFAULT 0');
        // How the visit was started. 'online' is a customer who joined from their
        // own phone, 'appointment' a booking that was checked in, 'walkin' a
        // phone-less patient booked in at the counter. The queue engine treats all
        // three identically - this only records where the row came from, which is
        // what the walk-in dashboards filter on and what decides whether the desk
        // is offered the printed forms.
        await addColumnIfMissing('queue_sequences', 'intake_channel',
            "ENUM('online','appointment','walkin') NOT NULL DEFAULT 'online'");
        await addIndexIfMissing('queue_sequences', 'idx_seq_intake_channel', '(intake_channel, status)');
        // Set when the front desk clears the opening (cashier) step, which is when
        // payment is taken. The Diagnosis Form is printed off the back of it, so it
        // needs a timestamp of its own rather than being inferred from the step
        // counter: a patient sent back to an earlier step rolls current_step
        // backwards, and they have still paid.
        await addColumnIfMissing('queue_sequences', 'paid_at', 'DATETIME DEFAULT NULL');
        // Backfills the channel for visits that predate the column - an
        // appointment-linked sequence is an appointment, and everything else was
        // online, since walk-ins did not exist before this.
        await pool.query(
            `UPDATE queue_sequences SET intake_channel='appointment'
             WHERE appointment_id IS NOT NULL AND intake_channel='online'`
        );
        // The sweep filters on status + date/time; the staff and customer lists
        // then filter on archived.
        await addIndexIfMissing('appointments', 'idx_appt_status_date', '(status, appointment_date)');

        // better-auth owns its own tables (user/session/account/verification) for the
        // customer login-OTP flow; this keeps them self-installing on boot like the rest
        // of this file, rather than requiring a separate manual CLI migration step.
        try {
            await require('./lib/better_auth_bridge').migrateBetterAuth();
        } catch (e) {
            console.error('[DB] better-auth migration failed (login OTP may not work):', e.message);
        }

        console.log('[DB] All tables created successfully.');
    } catch (err) {
        // Rethrown rather than swallowed. Swallowing it meant server.listen()
        // still ran, so the process came up healthy-looking and answered every
        // request with a 500 - the worst possible outcome under a container
        // restart policy or a platform health check, both of which would have
        // been satisfied by a port that was open and an app that did nothing.
        console.error('[DB] Failed to initialize:', err.message);
        throw err;
    }
}

module.exports = { pool, initDB, DEFAULT_SERVICES, DEFAULT_TEST_STRUCTURES, STAFF_SEEDS, LAB_SEEDS, DOCTOR_SEEDS, SERVICE_STEPS };
