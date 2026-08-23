# Medical Clinic Queueing System - Local Setup Instructions

This guide will help you run the application on your local machine using a local MySQL database.

## 1. Prerequisites
- **Node.js** installed on your machine.
- A local **MySQL Server** installed and running on port `3306` (e.g. via **XAMPP**, **WAMP**, or the standalone **MySQL Installer** for Windows).

## 2. MySQL Setup
1. Open your control panel (e.g., XAMPP Control Panel) or Services manager and ensure the **MySQL module is running**.
2. **No manual tables are required.** The app auto-creates the `clinic_v2` database, all ~20 tables, seed accounts, seed labs/doctors, and default service packages the first time it starts (`initDB()` in `database.js`). Schema changes on later runs are auto-migrated too — nothing to run by hand.

*Note: connection settings (host/user/password) come from `.env` — see step 3.*

## 3. Running the Application Locally
1. **Configure environment**: create a `.env` file in the project root with at least:
   ```
   PORT=3000
   JWT_SECRET=<any random string>
   GEMINI_API_KEY=      # optional - enables Gemini for AI features
   API_ALLAROUND=       # optional - Hugging Face fallback
   NVIDIA_API_KEY=      # optional - enables the NVIDIA Nemotron VA/AI fallback
   ```
   All AI features (OCR-assisted registration, the Virtual Assistant, analytics helpers) degrade gracefully to local mock logic if no keys are set — nothing is required to run the app.

2. **Install dependencies**: open a terminal in the project folder and run:
   ```bash
   npm install
   ```
3. **Run the server**:
   ```bash
   npm start
   ```
   *If successful, your console will output `[DB] All tables created successfully.` and `Server running at http://localhost:<PORT>`.*

4. **Access the app**:
   - **Landing page** (login / registration): [http://localhost:3000](http://localhost:3000)
   - There is no separate `admin.html`. Every role logs in from the same landing page and is redirected automatically: customer → `customer.html`, front desk → `frontdesk.html`, laboratory → `laboratory.html`, doctor → `doctor.html`, admin/admintechnical → `admintechnical.html`, owner → `owner.html`.
   - Seed accounts for each role are listed in `README.md`.

## 4. Features
- **Customer Dashboard**: join a service-package queue (front desk → lab(s) → doctor), book an appointment with a calendar/time-slot picker, check in via a QR code, and talk to the **Virtual Nurse Assistant** (a voice-driven widget — service FAQs, quick calculations, and voice-initiated queue join).
- **Priority queueing**: Senior, PWD, and Pregnant customers get a scored head start over Regular customers (see `queue_automation.js`); tickets are prefixed `S`/`D`/`P`/`Q` respectively.
- **Live updates**: the dashboard and staff views update in real time over Socket.IO (`queueUpdate` events) — no polling.
- **Staff dashboards**: front desk, laboratory, and doctor each call their own queue, log notes/clinical records, and hand off to the next station automatically via the package's configured sequence.
- **Admin/Owner**: staff, services, labs, and doctors CRUD, analytics, and (owner-only) reports.
