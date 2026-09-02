# Running this system in Docker

Everything here assumes you have never used Docker before. If you have, skip to
[Deploying to a hosting platform](#deploying-to-a-hosting-platform).

## Why Docker, and why not Vercel

This app is a **long-running server**, not a set of serverless functions. It
holds Socket.IO connections open so the queue and the lobby board update live,
it keeps the 15-minute staff inactivity clock in memory, and it runs timers that
sweep abandoned registrations and missed appointments. Vercel runs code only for
the length of one HTTP request and then throws the process away, so none of
those survive — the display board would go permanently silent.

Docker doesn't change how the app works. It packages it: one image containing
the exact Node version, the exact dependencies and the code, which runs
identically on your laptop, on a rented server, and on a mini-PC in the clinic.

## What you need

Install **Docker Desktop** (Windows/macOS) or **Docker Engine** (Linux) from
<https://docs.docker.com/get-started/get-docker/>. Nothing else — you do not
need Node or MySQL installed to run it this way.

Check it worked:

```bash
docker --version
```

## First run

**1. Create your `.env`** in the project root, next to `package.json`:

```bash
cp .env.example .env
```

**2. Fill in the three values that have no safe default.** Open `.env` and set:

- `JWT_SECRET` — signs the login sessions. Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

- `DB_PASSWORD` — the password the app uses for its database user. Any strong
  string; you will not type it again.
- `DB_ROOT_PASSWORD` — the database administrator password. Also never typed
  again, but it must be set.

Also set `TZ` to the clinic's timezone (default `Asia/Manila`) and
`DB_TIME_ZONE` to the matching offset. This matters more than it looks —
see [Timezone](#timezone-this-one-actually-matters).

**3. Start it.**

```bash
docker compose up --build
```

The first run takes a few minutes: it downloads Node and MySQL, installs
dependencies and compiles one native module. You will see MySQL initialise,
then the app wait for it, then create every table and seed the demo accounts,
and finally:

```
Server running at http://localhost:3000
```

**4. Open <http://localhost:3000>.** Sign in with any account from
[example_accounts.md](example_accounts.md). The lobby board is at
<http://localhost:3000/display.html>.

Press `Ctrl+C` to stop.

## Day-to-day commands

| What you want | Command |
| --- | --- |
| Start in the background | `docker compose up -d` |
| Stop (keeps all data) | `docker compose down` |
| Watch the app's logs | `docker compose logs -f app` |
| Restart just the app | `docker compose restart app` |
| Rebuild after changing code | `docker compose up -d --build app` |
| **Delete the database** | `docker compose down -v` |

That last one is irreversible. `-v` removes the volume holding every patient
record, ticket and audit entry. `docker compose down` on its own never touches
it.

### Backing up the database

The records live in a Docker volume, not in the project folder, so copying the
project does **not** back them up:

```bash
docker compose exec db mysqldump -u root -p"$DB_ROOT_PASSWORD" clinic_v2 > backup.sql
```

Restore into a running stack with:

```bash
docker compose exec -T db mysql -u root -p"$DB_ROOT_PASSWORD" clinic_v2 < backup.sql
```

## Timezone — this one actually matters

Ticket numbers are minted **per station, per day** (`CURDATE()` in
`nextTicketNumber`), and the walk-in dashboard filters on
`DATE(started_at) = CURDATE()`. Containers default to UTC. For a Philippine
clinic that means the date rolls over at 08:00 local time — so the day's ticket
counters would reset in the middle of the morning session, right as the front
desk opens, and yesterday's tickets would still count as today's until then.

`TZ` (app) and `DB_TIME_ZONE` (database) must agree with each other and with
the clinic. The defaults are `Asia/Manila` and `+08:00`.

## Deploying to a hosting platform

The `Dockerfile` alone is what a platform needs. `docker-compose.yml` is for
running the database yourself; on a platform you attach its managed MySQL
instead.

**Railway** is the recommended target: it runs a real container, supports the
WebSockets Socket.IO needs, and offers MySQL in the same project so the two talk
over a private network. **Render** works the same way — but not its free tier,
which sleeps after ~15 minutes idle, and a lobby board that sleeps is worse than
no lobby board.

### Before you deploy anything

Three things, in order. The first is not optional.

**1. Set `SEED_PASSWORD`.** The seed accounts' passwords are published in
[example_accounts.md](example_accounts.md) in a public repository. On a fresh
deployed database they are created with those exact passwords, so until you
change them `owner1` / `owner123` is a working administrator login for anybody
who finds the URL. `SEED_PASSWORD` replaces them at creation time. Generate one
and keep it somewhere you can find it — it will be the password for *every*
seeded account on first boot:

```bash
node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))"
```

**2. Generate a separate `JWT_SECRET`** for the deployment. Not the one from
your laptop — a leaked development secret lets anyone mint an admin token.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**3. Decide which branch deploys.** The platform watches one branch and rebuilds
when you push to it. Merge to `main` and deploy `main`, or point it at the
branch you actually work on — but know which, or you will push a fix and watch
nothing happen.

### Railway, step by step

1. **Create the project.** Sign in at [railway.app](https://railway.app) with
   GitHub → *New Project* → *Deploy from GitHub repo* → pick this repository.
   It detects the `Dockerfile` and builds it. There is no build command, start
   command or install step to configure; if it asks, leave them empty.

2. **Add the database.** In the same project: *New* → *Database* → *Add MySQL*.
   Keeping it in the same project is what puts it on the private network, so the
   database is never exposed to the internet.

3. **Set the app's variables.** Open the app service → *Variables*. Railway's
   MySQL publishes its own connection details under different names, so these
   are mapped with variable references — type them exactly, including the double
   braces:

   | Variable | Value |
   | --- | --- |
   | `JWT_SECRET` | the one you generated above |
   | `SEED_PASSWORD` | the one you generated above |
   | `TZ` | `Asia/Manila` |
   | `NODE_ENV` | `production` |
   | `DB_HOST` | `${{MySQL.MYSQLHOST}}` |
   | `DB_PORT` | `${{MySQL.MYSQLPORT}}` |
   | `DB_USER` | `${{MySQL.MYSQLUSER}}` |
   | `DB_PASSWORD` | `${{MySQL.MYSQLPASSWORD}}` |
   | `DB_NAME` | `${{MySQL.MYSQLDATABASE}}` |

   Leave `PORT` alone — Railway injects it, and the app reads it.

   Do **not** set `DB_SSL`: the database is reached over the private network,
   where TLS would encrypt a hop that never leaves Railway. Set it to `true`
   only if you point at a database somewhere else.

   Optional AI and email keys are listed in [.env.example](.env.example).
   Without them the app falls back to local logic and still works.

4. **Generate the public URL.** App service → *Settings* → *Networking* →
   *Generate Domain*. That is the address the clinic uses.

5. **Watch the first boot.** Open the *Deploy Logs*. You want, in order:

   ```
   [DB] Database ... ready on ...
   [DB] All tables created successfully.
   [Seed] SEED_PASSWORD is set - new seed accounts will use it ...
   [Server] Seed data created.
   Server running at http://localhost:3000
   ```

   The app creates every table itself on first boot — there is nothing to
   import. If instead it exits with `[Server] Startup failed:`, the message
   names what to check; see [Troubleshooting](#troubleshooting).

6. **Sign in and lock it down.** Go to `https://<your-domain>/index.html` and
   sign in as `owner1` with your `SEED_PASSWORD`. Then, before telling anyone
   the URL:
   - change the password on every account you intend to keep, from
     *Manage Accounts*
   - delete or archive the demo customer accounts you do not need
   - open `/display.html` on the lobby screen and press **Enable sound** once

### What to check once it is up

| Check | How |
| --- | --- |
| App and database both healthy | the public URL loads and you can sign in |
| Live updates work | open the front desk and `/display.html` side by side, call a ticket, and watch the board change |
| The right timezone | register a walk-in and confirm the ticket resets at midnight local, not 08:00 |
| Sessions survive a redeploy | push a change; you should stay signed in, because `JWT_SECRET` is stable |

### Deploying updates afterwards

Push to the branch the platform watches. It rebuilds the image and restarts the
container. Schema changes apply themselves on boot — see
[Changing the database schema](#changing-the-database-schema).

Your data is in the managed database, not the container, so redeploys never
touch it. Take backups from the platform's own database tools.

### If the database user has no `CREATE DATABASE` permission

Common on managed MySQL: you are given one database and cannot make more. The
app handles it — it logs
`[DB] No CREATE DATABASE grant - assuming "..." already exists.` and builds its
tables inside the database you were given. Just make sure `DB_NAME` matches
that database's real name.

### The other option: a VPS you control

If you would rather run the whole thing yourself — or the clinic wants it on its
own machine — the compose file already does this. On any Linux box with Docker
installed:

```bash
git clone https://github.com/Delle-Bit/Queue-Anti.git
cd Queue-Anti
cp .env.example .env      # then fill in JWT_SECRET, DB_PASSWORD, DB_ROOT_PASSWORD, SEED_PASSWORD
docker compose up -d
```

That is the entire deployment. You are then responsible for the things a
platform does for you: a domain, HTTPS (put Caddy or nginx in front — browsers
block the microphone the virtual assistant uses on plain HTTP), backups, and
keeping the host patched. For a clinic that wants the system to keep working
when the internet does not, this is the right answer and the cloud copy is the
demo.

## How the image is built

Two stages, in [Dockerfile](Dockerfile):

- **build** installs dependencies with `npm ci` (exactly the lockfile) and has
  the C++ toolchain `bcrypt` needs when no prebuilt binary matches the platform.
- **runtime** copies in the result and has none of that toolchain, so a compiler
  is not sitting in the image that faces the network. It runs as the unprivileged
  `node` user, not root.

A `HEALTHCHECK` requests `/api/settings` every 30 seconds. That endpoint reads
the database, so a pass means the app *and* its database are working — not just
that the port is open. If the database is unreachable at boot the app waits
(`DB_CONNECT_RETRIES`), then exits non-zero so the restart policy retries,
rather than listening and answering every request with a 500.

`uploads/` is deliberately **not** a volume. A registration writes the uploaded
ID there, reads it for OCR, and deletes it inside the same request — mounting it
would turn a directory that is empty by design into a store of identity
documents.

## Adding features once it is containerised

Docker does not have to be in your edit loop, and mostly should not be.

### Day-to-day: develop outside the container

```bash
npm run dev
```

That is `node --watch server.js` - Node's built-in watcher, no nodemon needed.
It restarts the server when you change a backend file (measured at ~4 seconds
to listening against an existing database), and frontend files need no restart
at all: there is no bundler, so `express.static` re-reads `public/` on every
request and a refresh shows your change.

Keep using your local MySQL for this. It is the fastest loop available, and
Docker's job is reproducible *deployment*, not authoring.

### When you do want to work inside the container

For anything environment-specific - a dependency that behaves differently on
Linux, or checking something before you deploy it:

```bash
npm run docker:dev
```

That overlays [docker-compose.dev.yml](docker-compose.dev.yml), which mounts
your working copy into the container so edits take effect without a rebuild.
`node_modules` and `uploads/` are deliberately masked out of that mount - the
first because your Windows-built `bcrypt` cannot load in Linux, the second
because uploaded IDs should not touch your real disk even briefly.

One caveat: on Windows and macOS, file-change events do not reliably cross a
bind mount, so `--watch` may not notice a backend edit. `docker compose restart
app` takes about two seconds and is the fallback. Frontend edits are unaffected.

### Shipping an update

Locally or on a clinic machine:

```bash
docker compose up -d --build app
```

Only the app is rebuilt; the database container and its volume are untouched,
so no records are lost. On a hosting platform, push to the branch and it
rebuilds the image itself.

### Changing the database schema

There are no migration files to write or order. `initDB()` runs on every boot
and converges the schema, so you add a line and redeploy. Which line depends on
what you are changing:

| Change | What to add in `initDB()` |
| --- | --- |
| New column | `addColumnIfMissing('table', 'col', 'INT DEFAULT NULL')` |
| New index | `addIndexIfMissing('table', 'idx_name', '(col)')` |
| New value in an `ENUM` | `try { await pool.query('ALTER TABLE t MODIFY COLUMN c ENUM(...)') } catch(e) {}` - re-stating the whole list, as the existing ones do |
| Whole new table | `CREATE TABLE IF NOT EXISTS ...` |

**The one that catches people:** editing the body of an existing
`CREATE TABLE IF NOT EXISTS` does nothing to a database that already has that
table. It will work perfectly on a fresh volume and silently do nothing on the
deployed clinic database. Any column added to a `CREATE TABLE` needs a matching
`addColumnIfMissing` line, or it only exists on new installs.

`addColumnIfMissing` is additive only - it cannot rename a column, change a
type, or drop one. Those need an explicit `ALTER TABLE`, written to be safe to
re-run, because it will run on every boot forever.

### Before you deploy a change

```bash
npm test
```

That only syntax-checks every file (`node --check`) - there is no test runner in
this project, so it catches typos, not broken logic. Anything behavioural still
needs exercising by hand, or a throwaway script against a running server.

## MariaDB locally, MySQL in the container

Worth knowing, because it is the source of the only real bug the first build
found. XAMPP ships **MariaDB**, not MySQL, and the two are no longer the same
product:

| | your XAMPP install | the container |
| --- | --- | --- |
| Product | MariaDB 10.4 | MySQL 8.4 |
| `STRICT_TRANS_TABLES` | off | **on** |
| `ONLY_FULL_GROUP_BY` | off | **on** |

MariaDB has allowed a `DEFAULT` on a `TEXT` column since 10.2. MySQL never has,
and under `STRICT_TRANS_TABLES` it rejects the whole `CREATE TABLE` rather than
warning. `appointments.notes TEXT DEFAULT ''` therefore sat in `database.js`
unnoticed for as long as the project only ever met MariaDB, and stopped the app
booting the moment it met a real MySQL. It is fixed, and it would have broken
any managed MySQL deployment in exactly the same way — Docker just found it
first, on your machine, instead of in production.

`ONLY_FULL_GROUP_BY` is the other difference and turned out to be harmless here:
all 13 `GROUP BY` queries either aggregate properly or group by a primary key,
which MySQL accepts because the remaining columns are functionally dependent on
it. Worth re-checking if you add analytics.

If you want to remove the mismatch entirely, you have two options:

- **Develop against the container's MySQL.** Publish its port by adding a `db`
  section to [docker-compose.dev.yml](docker-compose.dev.yml) with
  `ports: ["3307:3306"]`, then point `.env` at `DB_HOST=127.0.0.1`,
  `DB_PORT=3307` and keep using `npm run dev`. 3307 avoids clashing with
  XAMPP's 3306.
- **Run MariaDB in the container** instead, by changing the `db` image to
  `mariadb:11`. Do this only if you also intend to deploy on MariaDB — most
  managed providers offer MySQL, and matching production matters more than
  matching your laptop.

Either way, `mysql2` speaks to both, so no application code changes.

## Troubleshooting

**`port is already allocated`** — something else is on 3000. Set `APP_PORT=3001`
in `.env` and run `docker compose up -d` again. The container still uses 3000
internally.

**App restarts in a loop** — read the reason:

```bash
docker compose logs app | tail -30
```

`[Server] Startup failed:` means it could not reach the database; check the
`DB_*` values. A missing `JWT_SECRET` stops compose before it starts anything,
with a message naming the variable.

**`.env` changes do nothing** — compose reads `.env` when it creates a
container, so recreate them: `docker compose up -d --force-recreate`.

**Database won't start after a crash** — the volume may be mid-write. Try
`docker compose down` then `docker compose up -d`. If it persists, restore from
a backup; `down -v` erases the records.
