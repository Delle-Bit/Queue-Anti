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
- **Customer Dashboard**: search the service catalogue by ID, name or category, join a service-package queue, book an appointment with a calendar/time-slot picker, check in via a QR code, and talk to the **Virtual Nurse Assistant** (a voice-driven widget — service FAQs, quick calculations, and voice-initiated queue join).
- **Front-desk-to-front-desk routing**: every service starts at the front desk (the cashier) and ends back at it. The closing step is where the front desk records the official outcome — **Completed** or **Unfinished** (with a reason) — and no other station can end a visit. The customer's queue track shows both stops, so nobody leaves thinking a finished laboratory step was the end of their visit.
- **Priority queueing**: Senior, PWD, and Pregnant customers get a scored head start over Regular customers (see `queue_automation.js`); tickets are prefixed `S`/`D`/`P`/`Q` respectively. A ticket is issued once and follows the patient through every station.
- **Queue re-insertion**: the front desk can put a patient who missed their turn — or came back with an unfinished process — back into any station's line, exactly two positions behind the ticket being served: the patient in process finishes, one more regular patient is called, then the re-inserted one.
- **Mis-click protection**: "Call Next" always asks for confirmation, and **Call Back** undoes the last advance — the patient at the counter returns to the front of the line and the ticket completed just before them is recalled, including the queue row that advance created downstream. Closing a transaction is a separate, collapsed danger-zone action rather than a button beside the queue controls.
- **On-Hold**: a patient who needs time (for example, to produce a sample) is put On-Hold, the next patient is called automatically, and resuming returns them to a defined position rather than to the head of the line.
- **Live updates**: the dashboard and staff views update in real time over Socket.IO (`queueUpdate` events) — no polling.
- **Staff dashboards**: front desk, laboratory, and doctor each call their own queue in the order it will actually be called (priority and re-insertions included), log notes/clinical records, and hand off to the next station via the package's configured sequence.
- **Staff inactivity timeout**: a staff terminal left alone for 15 minutes warns at one minute out, then signs the account out and returns it to the sign-in page. Enforced on the server too, so a closed laptop cannot leave a usable session behind.
- **Audit log** (admin/owner): every configuration and data change records what changed (with before/after values), who changed it, when, and **why** — the reason is required, and the endpoints reject a change without one. Searchable and filterable by action, record type and free text.
- **Recoverable archives**: nothing is deleted outright. Accounts, services, laboratories, doctors, announcements and records are archived with a snapshot, a readable label and the reason, and any of them can be restored with one action. Permanent deletion is available separately and keeps its snapshot on the audit trail.
- **Admin/Owner**: staff, services, labs, and doctors CRUD with searchable, filterable lists (by user ID, patient ID, name, username, role, category), analytics, and (owner-only) reports.
- **Customize** (admin/owner → Customize): site name, logo path/URL, light/dark theme, navbar colour, and a background image, stored in the single-row `settings` table. `applySiteSettings()` in `public/shared.js` pulls `GET /api/settings` (public) on every page load and applies them; saving also broadcasts a `settingsUpdate` socket event so open pages re-brand without a reload. Name and logo apply everywhere including the exported medical-record PDF; theme and background image are scoped to the dashboard shell, since the landing page carries its own palette in `index.css`. Sidebar text and hover shades are derived from the chosen navbar colour, so a light colour still reads.
