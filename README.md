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

| Username           | Password   | Role            |
| ------------------ | ---------- | --------------- |
| admin_tech         | admin123   | admintechnical  |
| admin_regular      | admin123   | admin           |
| frontdesk1         | pass123    | frontdesk       |
| lab_xray           | pass123    | laboratory      |
| lab_blood          | pass123    | laboratory      |
| owner1             | owner123   | owner           |
| doctor1            | pass123    | doctor          |
| customer_regular   | pass123    | customer        |
| customer_senior    | pass123    | customer        |
| customer_pwd       | pass123    | customer        |
| customer_pregnant  | pass123    | customer        |

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
