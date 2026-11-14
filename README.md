# hackathon-catijr
Hackathon da CatiJr — a real-time auction platform.

## Stack

| Package   | What                                                                 |
| --------- | -------------------------------------------------------------------- |
| `client/` | SvelteKit 3 (Svelte 5, SPA mode via `adapter-static`)                |
| `server/` | Fastify 5 + Socket.io 4; all data kept in the server's memory |
| `shared/` | Types, socket event contracts and bid rules used by both sides       |

npm workspaces tie them together. Requires **Node 22.12+**.

## Getting started

```bash
make dev
```

That's it: it checks your Node version, installs dependencies (only when they changed),
creates the `.env` files from the examples, makes sure the ports are free and starts everything.

- Client: http://localhost:5173
- API: http://localhost:3333 (Vite proxies `/api` and `/socket.io` to it in dev)

Every time the server starts it loads some sample auctions into memory (see **Data storage** below).

Config lives in `server/.env` and `client/.env` (created from the `.env.example` files).
Session duration is configured there too (see **Business rules** below).

## Commands

Run `make` to list them all.

| Command         | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| `make dev`      | Server (watch mode) and client together                      |
| `make server`   | Only the API server                                          |
| `make client`   | Only the web client                                          |
| `make check`    | Type-check server and client                                 |
| `make build`    | Build server (`server/dist`) and client (`client/build`)     |
| `make start`    | Build and run the production build locally                   |
| `make clean`    | Remove build output                                          |
| `make reset`    | Remove build output and every `node_modules`                 |

The Makefile only wraps npm scripts, so `npm run dev`, `npm run build`, etc. still work (e.g. on Windows without `make`).

## How it works

### Business rules

| Rule | How it's enforced |
| ---- | ----------------- |
| **RF01** · Sign up with display name, email and password, then log in. One email = one account. | Emails are trimmed and compared case-insensitively; the duplicate check and the account creation happen in one synchronous step, so it holds even for simultaneous signups (→ `409`). Display names are trimmed, 2–60 chars. Signing up also logs you in. |
| **RF02** · Protected actions need a valid session; sessions expire. | Server-side sessions (random token, only its SHA-256 is kept). **Every** protected HTTP route and socket event (entering a room, **each bid**) re-checks the session on the server, so expiry and logout apply immediately — even on an already open connection. A sweep every 60 s also removes expired sessions from the rooms they were in. |
| **RF03** · Every user is a buyer; any logged-in user can list items; no administrator. | `POST /api/auctions` is open to any session; there are no roles. Sample listings belong to a regular demo user. |
| **RF04** · Listings are public; entering a room requires login; sellers never bid on their own auction. | Listing endpoints and price updates are public. Bid history, bidder names and bidding only exist inside a socket room, which requires a session. Bids are only accepted from inside the room, and the server rejects bids from the auction's seller. |

**Team decision (RF02):** sessions **renew with use**. A session ends after **2 hours without any authenticated action**,
and in any case **7 days after login**. Both are configurable in `server/.env` (`SESSION_IDLE_MINUTES`, `SESSION_MAX_DAYS`).
When the server ends a session, the client logs out and shows a "session expired" banner.

**Demo account** (owns the sample listings, useful to see the seller's view): `demo@arremate.dev` / `demo12345`.

### REST API (`/api`)

| Method | Path                | Session | Description                                |
| ------ | ------------------- | ------- | ------------------------------------------ |
| POST   | `/auth/signup`      |         | `{ name, email, password }` → `{ token, user }` |
| POST   | `/auth/login`       |         | `{ email, password }` → `{ token, user }`  |
| POST   | `/auth/logout`      | ✔       | Ends the session (also on its open sockets) |
| GET    | `/auth/me`          | ✔       | Current user                               |
| GET    | `/auctions?q=`      |         | List or search listings (live ones first)  |
| GET    | `/auctions/:id`     |         | One listing (no bids: those are in the room) |
| POST   | `/auctions`         | ✔       | List an item: `{ title, description, category, imageUrl?, startingPrice, minIncrement, durationMinutes }` |

The session token is sent as `Authorization: Bearer <token>`. An invalid or expired session gets
`401 { code: "SESSION_INVALID" }`. Passwords are hashed with scrypt.

### Real time (Socket.io)

Anyone can connect (to receive public listing updates). Send the session token in the handshake
(`auth: { token }`) to enter rooms and bid.

| Direction            | Event             | Payload                                                    |
| -------------------- | ----------------- | ---------------------------------------------------------- |
| client → server      | `room:join`       | `auctionId`, ack → `{ ok, auction }` with recent bids (session required) |
| client → server      | `room:leave`      | `auctionId`                                                |
| client → server      | `bid:place`       | `{ auctionId, amount }`, ack → `{ ok }` or `{ ok: false, error, code? }` (session + room required) |
| server → everyone    | `auction:created` | new listing                                                |
| server → everyone    | `auction:updated` | listing after a bid (price, bid count — no bidder)         |
| server → room        | `room:bid`        | `{ auction, bid }` with the bidder's name                  |
| server → connection  | `session:expired` | the session ended; the connection was removed from all rooms |

The event types live in `shared/src/index.ts`, so both ends are type-checked against the same contract.
All money values are **integers in cents**.

### Data storage

By rule, data is **not** stored in a database or cloud storage: it lives only in the memory of the
machine running the server (`server/src/store.ts`, plain `Map`s). Nothing is written to disk.

- **Restarting the server erases everything**: accounts, sessions, listings and bids. Logged-in users
  are logged out (the client notices and clears its session). In development, `make dev` restarts the
  server whenever a server file is saved, so the data resets then too.
- On start, the server loads the sample listings and the demo account again.
- Run a **single** server process: each process has its own memory, so two instances wouldn't see each other's data.
- Node runs the JavaScript on one thread and every check-then-update in `server/src/services/` is synchronous,
  so two bids (or two signups with the same email) can never interleave.

The only thing the browser keeps is the session token (in `localStorage`), so a page refresh stays logged in.

### Client structure

```
client/src/
├── lib/                    (imported as #lib/...)
│   ├── api.ts              fetch wrapper
│   ├── auth.svelte.ts      session state (login/signup/logout/expiry)
│   ├── socket.svelte.ts    shared Socket.io connection
│   ├── room.svelte.ts      AuctionRoom: joining an auction's live room
│   ├── clock.svelte.ts     one ticking clock for all countdowns
│   └── components/         Header, AuctionHero, AuctionCard, BidForm, ...
└── routes/
    ├── +page.svelte        featured auction carousel + grid of all auctions/search results
    ├── auctions/[id]/      listing (public) + live room (logged in)
    ├── sell/               list an item
    ├── login/
    └── signup/
```
