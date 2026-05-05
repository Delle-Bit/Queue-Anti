# Example Test Accounts

These accounts are seeded automatically when the server starts.

| Username | Password | Role | Category |
|----------|----------|------|----------|
| admin_tech | admin123 | AdminTechnical | — |
| admin_regular | admin123 | Admin | — |
| frontdesk1 | pass123 | Frontdesk | — |
| lab_xray | pass123 | Laboratory | — |
| lab_blood | pass123 | Laboratory | — |
| owner1 | owner123 | Owner | — |
| customer_regular | pass123 | Customer | Regular |
| customer_senior | pass123 | Customer | Senior |
| customer_pwd | pass123 | Customer | PWD |
| customer_pregnant | pass123 | Customer | Pregnant |

## Sample Data

### Laboratories
- **X-Ray Room** — assigned to `lab_xray`
- **Blood Test Lab** — assigned to `lab_blood`

### Service Packages
- **General Check-up** — ₱1,500 — Includes Blood Test + X-Ray (30 min estimated)

## Role Descriptions

| Role | Access |
|------|--------|
| AdminTechnical | Full admin — manage accounts, labs, create admins, customize branding |
| Admin | Same as AdminTechnical but CANNOT create other Admin accounts |
| Frontdesk | Payment queue, service/pricing management, appointments |
| Laboratory | Lab-specific queue, analytics, appointments |
| Customer | Browse services, queue, appointments, chatbot |
| Owner | Revenue dashboard, audit logs, staff tracking |
