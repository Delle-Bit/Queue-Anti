# Medical Clinic Queueing System - Local Setup Instructions

This guide will help you run the application on your local machine using a local MySQL database.

## 1. Prerequisites
- **Node.js** installed on your machine.
- A local **MySQL Server** installed and running on port `3306` (e.g. via **XAMPP**, **WAMP**, or the standalone **MySQL Installer** for Windows).

## 2. MySQL Setup
1. Open your control panel (e.g., XAMPP Control Panel) or Services manager and ensure the **MySQL module is running**.
2. **No manual tables are required.** The app auto-creates the `clinic_v2` database, all ~20 tables, seed accounts, seed labs/doctors, and default service packages the first time it starts (`initDB()` in `database.js`). Schema changes on later runs are auto-migrated too — nothing to run by hand.

*Note: connection settings come from `.env` (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`) — see step 3. With no `.env` they default to a stock local install: `localhost:3306`, user `root`, empty password, database `clinic_v2`.*

## 3. Running the Application Locally
1. **Configure environment**: copy `.env.example` to `.env` and fill it in — it
   documents every variable. At minimum:
   ```
   PORT=3000
   JWT_SECRET=<any long random string>

   # Database — omit these to use a stock local MySQL (localhost:3306, root, no password)
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=
   DB_NAME=clinic_v2
   GEMINI_API_KEY=          # optional - enables Gemini for AI features
   API_ALLAROUND=           # optional - Hugging Face fallback
   NVIDIA_API_KEY=          # optional - enables the NVIDIA Nemotron VA/AI fallback
   # Password-reset emails (template needs `to_email`, `reset_link`)
   EMAILJS_SERVICE_ID=       # optional - defaults to a shared service ID if unset
   EMAILJS_TEMPLATE_ID=      # optional
   EMAILJS_PUBLIC_KEY=       # required alongside EMAILJS_TEMPLATE_ID for real email delivery
   EMAILJS_PRIVATE_KEY=      # required alongside EMAILJS_TEMPLATE_ID for real email delivery

   # OTP emails: registration verification + login (template needs `to_email`, `otp_code`)
   # Deliberately separate EmailJS service/template/keys from the reset-password ones above.
   EMAILJS_OTP_SERVICE_ID=   # optional
   EMAILJS_OTP_TEMPLATE_ID=  # optional
   EMAILJS_OTP_PUBLIC_KEY=   # required alongside EMAILJS_OTP_TEMPLATE_ID for real email delivery
   EMAILJS_OTP_PRIVATE_KEY=  # required alongside EMAILJS_OTP_TEMPLATE_ID for real email delivery
   ```
   All AI features (OCR-assisted registration, the Virtual Assistant, analytics helpers) degrade gracefully to local mock logic if no keys are set — nothing is required to run the app. Likewise, without EmailJS configured, OTP codes and password-reset links are only logged to the server console (`[MOCK EMAIL TO ...]`) instead of actually emailed — set the EmailJS vars above (each pointing at its own EmailJS template) to send real emails.

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

## 4. Philippine address dataset (PSGC)

The customer medical form's address section uses cascading **Province → City/Municipality → Barangay** dropdowns backed by real PSGC (Philippine Standard Geographic Code) data committed under `public/data/ph/`:

| File | Contents | Size |
| --- | --- | --- |
| `provinces.json` | `[{ c: code, n: name }]` — 81 provinces + 3 synthetic entries for province-less cities (NCR, and the independent cities of Isabela and Cotabato) | ~3KB |
| `cities.json` | `[{ c: code, n: name, p: provinceCode }]` — 1,634 cities/municipalities | ~79KB |
| `barangays/<provinceCode>.json` | `[{ c: code, n: name, m: cityOrMunicipalityCode }]` — 42,046 barangays, sharded by province | ~15–93KB each |

Barangays are sharded per province so the browser downloads only the province the user actually picks (~35KB for Laguna) instead of the full 11MB national list. All three levels are memoized client-side, so switching back and forth re-fetches nothing.

To refresh the data (PSGC renames, merges, and creates barangays over time):

```bash
node scripts/build-psgc-data.js
```

That re-downloads from the [PSGC API](https://psgc.gitlab.io/api/) and regenerates every file above. It fails loudly if any barangay references an unknown province or any city has no resolvable parent.

`medical_records` stores the five parts (`house_number`, `street`, `barangay`, `city`, `province`) **and** keeps the original `address` column as a composed one-line string, so the profile card, staff views, and PDF export continue reading `address` unchanged. `house_number` is optional — many rural addresses have none.

## 5. Features
- **Customer Dashboard**: join a service-package queue (front desk → lab(s) → doctor), book an appointment with a calendar/time-slot picker, check in via a QR code, and talk to the **Virtual Nurse Assistant** (a voice-driven widget — service FAQs, quick calculations, and voice-initiated queue join).
- **Priority queueing**: Senior, PWD, and Pregnant customers get a scored head start over Regular customers (see `queue_automation.js`); tickets are prefixed `S`/`D`/`P`/`Q` respectively.
- **Live updates**: the dashboard and staff views update in real time over Socket.IO (`queueUpdate` events) — no polling.
- **Staff dashboards**: front desk, laboratory, and doctor each call their own queue, log notes/clinical records, and hand off to the next station automatically via the package's configured sequence.
- **Admin/Owner**: staff, services, labs, and doctors CRUD, analytics, and (owner-only) reports.
- **Customize** (admin/owner → Customize): site name, logo path/URL, light/dark theme, navbar colour, and a background image, stored in the single-row `settings` table. `applySiteSettings()` in `public/shared.js` pulls `GET /api/settings` (public) on every page load and applies them; saving also broadcasts a `settingsUpdate` socket event so open pages re-brand without a reload. Name and logo apply everywhere including the exported medical-record PDF; theme and background image are scoped to the dashboard shell, since the landing page carries its own palette in `index.css`. Sidebar text and hover shades are derived from the chosen navbar colour, so a light colour still reads.
