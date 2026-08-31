# Medical Clinic Queueing System

Queue management app for a medical clinic: customers join queues or book appointments, staff call tickets across stations (front desk → laboratory(s) → doctor), with live status updates, priority queuing (Senior/PWD/Pregnant), analytics, and AI-assisted features.

## Stack

- **Backend**: Node.js + Express 5, Socket.IO for live updates
- **Database**: MySQL (via `mysql2`), schema auto-created on first boot
- **Frontend**: Static HTML/CSS/JS served from `public/`
- **Auth**: JWT (8h expiry), role-based access control
- **AI**: Mock AI services with graceful fallback (`ai_services.js`)

## Setup

1. Install **Node.js** and a local **MySQL** server (XAMPP/WAMP/MySQL Installer) running on port 3306.
2. Copy `.env` (or create it) with:

   ```
   PORT=3000
   JWT_SECRET=<random long string>
   GEMINI_API_KEY=   # optional
   API_ALLAROUND=    # optional Hugging Face token
   ```

3. If your MySQL root user has a password, update `database.js` (`user`/`password`).
4. Install and run:

   ```bash
   npm install
   npm start
   ```

   The first run creates the `clinic_v2` database, all tables, and seed accounts automatically.

## Seed accounts (dev only — change before any real deployment)

One account per clinic position. Names are sample data. Defined in `STAFF_SEEDS`
(`database.js`); seeded on boot by `startServer()` in `server.js`.

| Username        | Password | Role           | Position                                             | Name                           |
| --------------- | -------- | -------------- | ---------------------------------------------------- | ------------------------------ |
| owner1          | owner123 | owner          | Owner / Medical Director                             | Ramon Bautista Villanueva      |
| admin_regular   | admin123 | admin          | Clinic Administrator                                 | Teresita Mendoza Rosales       |
| admin_tech      | admin123 | admintechnical | Technical / IT Administrator                         | Joel Pascual Bautista          |
| frontdesk1      | pass123  | frontdesk      | Front Desk Receptionist                              | Angeli Cruz Domingo            |
| nurse_vitals    | pass123  | laboratory     | Staff Nurse (Vital Signs)                            | Grace Padilla Villamor         |
| lab_blood       | pass123  | laboratory     | Medical Technologist — Hematology & Clinical Chemistry | Marites Lopez Saavedra       |
| lab_micro       | pass123  | laboratory     | Medical Technologist — Clinical Microscopy           | Ferdinand Reyes Ocampo         |
| lab_xray        | pass123  | laboratory     | Radiologic Technologist                              | Dennis Alonzo Fabregas         |
| lab_ultrasound  | pass123  | laboratory     | Sonographer (Ultrasound & Duplex Scans)              | Katrina Jimenez Escuadro       |
| lab_cardio      | pass123  | laboratory     | Cardiovascular Technologist                          | Alvin Molina Delos Reyes       |
| lab_counselor   | pass123  | laboratory     | HIV Counsellor (RA 11166)                            | Rowena Fajardo Lacsamana       |
| doctor1         | pass123  | doctor         | Physician — General / Family Medicine                | Alfredo Salazar Mercado        |
| doctor_cardio   | pass123  | doctor         | Internist — Cardiology                               | Maria Cristina Herrera Aguilar |

| Username          | Password | Role     | Category | Name                       |
| ----------------- | -------- | -------- | -------- | -------------------------- |
| customer_regular  | pass123  | customer | Regular  | Miguel Torres Panganiban   |
| customer_senior   | pass123  | customer | Senior   | Rosario Guevarra Nazareno  |
| customer_pwd      | pass123  | customer | PWD      | Elmer Dizon Cabrera        |
| customer_pregnant | pass123  | customer | Pregnant | Jocelyn Ramos Enriquez     |

Seeding never overwrites a name someone actually typed in: an account whose
`full_name` still matches its username (or is blank) gets the seed name, and
anything else is left alone with a `[Seed] Kept existing name …` line in the
server log.

## Stations & service steps

Every ticket starts at the front desk, then walks the stations its service is
wired to, and ends at a physician when the service calls for one. Stations live
in `laboratories`, the per-service order lives in `package_laboratories`, and the
seeded plan is `SERVICE_STEPS` in `database.js`.

| Station             | Handles                                        | Staff          |
| ------------------- | ---------------------------------------------- | -------------- |
| Physical            | Vitals, height/weight/BMI                      | nurse_vitals   |
| Blood Test Lab      | Blood extraction — CBC, chemistry, serology    | lab_blood      |
| Specimen            | Urinalysis, fecalysis, urine drug test         | lab_micro      |
| X-Ray Room          | Chest and other plain radiographs              | lab_xray       |
| Ultrasound Room     | Ultrasound and the duplex scans                | lab_ultrasound |
| Cardiac Diagnostics | ECG, 2D echo, Holter, 24-hour ABPM             | lab_cardio     |
| Counseling Room     | HIV pre-test and post-test counselling         | lab_counselor  |

Sequences follow the standard Philippine out-patient flow — register and pay at
the desk, give specimens, get imaged, then see the physician who interprets the
results:

| Service                            | After the front desk                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| Hematology (CBC)                   | Blood Test Lab                                                                  |
| Blood Chemistry                    | Blood Test Lab                                                                  |
| Serology Exams                     | Blood Test Lab                                                                  |
| Rapid Antibody Test                | Blood Test Lab                                                                  |
| Clinical Microscopy                | Specimen                                                                        |
| Drug Testing                       | Specimen                                                                        |
| X-ray                              | X-Ray Room                                                                      |
| Ultrasound                         | Ultrasound Room                                                                 |
| ECG / FCG                          | Cardiac Diagnostics                                                             |
| HIV Screening                      | Counseling Room → Blood Test Lab → Counseling Room                              |
| 2D Echocardiography                | Cardiac Diagnostics → Cardiology                                                |
| Holter Monitoring                  | Cardiac Diagnostics → Cardiology                                                |
| 24-Hour Ambulatory BP Monitoring   | Cardiac Diagnostics → Cardiology                                                |
| Venous / Arterial / Carotid Duplex | Ultrasound Room → Cardiology                                                    |
| Annual Physical Exam               | Physical → Blood Test Lab → Specimen → X-Ray Room → Cardiac Diagnostics → GP    |
| Pre-Employment Medical             | Physical → Blood Test Lab → Specimen → X-Ray Room → GP                          |

Why these shapes:

- A standalone diagnostic test ends at the station — the radiologist or
  pathologist reads it offline and the result is released, which is why a ₱450
  CBC carries no consultation.
- DOH AO 2007-0027 files urinalysis and fecalysis under Clinical Microscopy, so
  those (and urine drug testing) go to the specimen window rather than the blood
  bench.
- Tests a physician has to walk the patient through — echocardiography, duplex
  scans, Holter, 24-hour ABPM — end at the cardiologist; the check-up packages
  end at the general physician who signs the clearance.
- HIV screening is bracketed by pre-test and post-test counselling, which
  RA 11166 requires of every HIV testing facility.
- PEME is the standard battery (physical exam, CBC, urinalysis/fecalysis, chest
  X-ray, drug test) with no ECG; the APE adds one as comprehensive screening.

A service is only wired if it has no stations **and** no doctor yet, so a
sequence edited in the admin UI survives every reboot. Services with no steps at
all report "This service is currently unavailable" and cannot be queued or
booked.

## Roles & access

- **customer** — join queue, book appointments, own medical/clinical records
- **frontdesk** — manage queue, call next, book/QR appointments, edit patient records
- **laboratory** — own station queue + analytics, lab notes, clinical records
- **doctor** — doctor station queue, clinical records
- **admin / admintechnical** — staff, services, labs, doctors, analytics, archives
- **owner** — everything + reports, deletion logs, settings

## Key routes

- `public/` — one HTML/JS pair per role (`frontdesk.html`, `laboratory.html`, `doctor.html`, `admintechnical.html`, `owner.html`, `customer.html`, landing `index.html`)
- `server.js` — app entry, auth middleware, check-in endpoints, seeding
- `routes/` — `auth`, `admin`, `queue`, `packages`, `reports`
- `database.js` — schema + `initDB()` (auto-migrates missing columns)
- `queue_automation.js` — priority scoring + atomic ticket numbering
- `config.js` — JWT secret + role-guard middleware
- `ai_services.js` — AI feature wrappers (fall back to mock logic)

## Scripts

- `npm start` — run the server (default port 3000)
- `npm test` — syntax-check all backend files

## Notes

- Uploaded ID images are deleted after processing and never stored in git (`uploads/` is gitignored).
- The schema is created/modified automatically at boot; no manual migrations needed.
