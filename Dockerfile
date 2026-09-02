# syntax=docker/dockerfile:1

# ── Medical clinic queue management system ──────────────────────────────────
# A long-running Node process, not a serverless function: it holds Socket.IO
# connections open, keeps the staff-inactivity clock in memory, and runs timed
# sweeps for abandoned registrations and missed appointments. Anything that runs
# a container will host it - Railway, Render, Fly, a VPS, or a mini-PC in the
# clinic itself.
#
# Two stages, because bcrypt is a native addon. If no prebuilt binary matches
# the platform it is compiled from source, which needs python3/make/g++ - and
# none of that has any business being in the image that faces the network.

# ── build ───────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copied before the source so this layer is cached: editing a route does not
# reinstall node_modules.
COPY package.json package-lock.json ./

# `npm ci` installs exactly what the lockfile pins, and fails rather than
# silently resolving something newer. --omit=dev is a no-op right now (this
# project has no devDependencies) and keeps being correct if any are added.
RUN npm ci --omit=dev

COPY . .

# ── runtime ─────────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS runtime

# Ticket numbers are minted per station per *day* (`CURDATE()` in
# nextTicketNumber), and the walk-in dashboard filters on
# `DATE(started_at) = CURDATE()`. A container defaults to UTC, which for a
# Philippine clinic rolls the date over at 08:00 local - so the day's ticket
# counters would reset in the middle of the morning session, right as the desk
# opens. Set this to the clinic's own zone, and set the database's to match
# (see docker-compose.yml).
ENV TZ=Asia/Manila \
    NODE_ENV=production \
    PORT=3000

WORKDIR /app

# tzdata is what makes TZ above mean anything; the slim image ships without it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app /app

# Registration writes an uploaded ID here, reads it for OCR, and deletes it
# inside the same request - so this never needs to be a volume, and deliberately
# is not one: a mount would turn a directory that is empty by design into a
# store of identity documents. It only has to exist and be writable, because
# multer creates it relative to the working directory.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

# Drops root. The `node` user ships with the base image as uid 1000.
USER node

EXPOSE 3000

# Hits a public endpoint that reads the database, so a pass means the app is up
# *and* its database is reachable - not merely that the port is open. Uses the
# runtime's own fetch rather than installing curl for one request.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/settings').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so the process receives SIGTERM directly and the graceful shutdown
# in server.js runs. The shell form would put /bin/sh at PID 1 and swallow it.
CMD ["node", "server.js"]
