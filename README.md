# hackathon-catijr
Hackathon da CatiJr — a real-time auction platform.

## Stack

| Package   | What                                                                 |
| --------- | -------------------------------------------------------------------- |
| `client/` | SvelteKit 3 (Svelte 5, SPA mode via `adapter-static`)                |
| `server/` | Fastify 5 + Socket.io 4; data saved as JSON on the VM's disk |
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

On the very first start the server creates some sample auctions and the demo account; after that, data is kept
between restarts (see **Data storage** below). `make reset-data` starts over from the sample data.

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
| `make reset-data` | Delete saved data and uploaded photos (sample data comes back on next start) |
| `make clean`    | Remove build output                                          |
| `make reset`    | Remove build output and every `node_modules`                 |

The Makefile only wraps npm scripts, so `npm run dev`, `npm run build`, etc. still work (e.g. on Windows without `make`).

## How it works

### Business rules

| Rule | How it's enforced |
| ---- | ----------------- |
| **RF01** · Sign up with display name, email and password, then log in. One email = one account. | Emails are trimmed and compared case-insensitively; the duplicate check and the account creation happen in one synchronous step, so it holds even for simultaneous signups (→ `409`). Display names are trimmed, 2–60 chars. The signup form asks for the password twice (compared in the browser). Signing up also logs you in. |
| **RF02** · Protected actions need a valid session; sessions expire. | Server-side sessions (random token, only its SHA-256 is kept). **Every** protected HTTP route and socket event (entering a room, **each bid**) re-checks the session on the server, so expiry and logout apply immediately — even on an already open connection. A sweep every 60 s also removes expired sessions from the rooms they were in. |
| **RF03** · Every user is a buyer; any logged-in user can list items; no administrator. | `POST /api/auctions` is open to any session; there are no roles. Sample listings belong to a regular demo user. |
| **RF04** · Listings are public; entering a room requires login; sellers never bid on their own auction. | Listing endpoints and price updates are public. Bid history, bidder names and bidding only exist inside a socket room, which requires a session. Bids are only accepted from inside the room, and the server rejects bids from the auction's seller. |
| **RF05** · Create an auction with name, description, category, ≥ 3 photos, starting price, start time and duration. | "Anunciar item" form (`/sell`), sent as one multipart request; the server validates every field and photo before saving anything. The start is either "as soon as possible" or a chosen date/time, checked against the **server's** clock. Bids before the start are rejected. |
| **RF08** · The seller cancels their own auction while scheduled or live without bids; nothing is deleted. | "Cancelar leilão" on the auction page (seller only, with a confirmation step). The server re-checks seller, state and bids; a cancelled auction keeps all its data and photos, is marked **Cancelado**, rejects bids and is announced live to listings and rooms. A bid and a cancellation arriving together can't both succeed: they run one after the other, so whichever comes first wins. |
| **RF06** · Limits are easy to change (e.g. a demo auction that opens in 1 minute and lasts 3). | Every limit is in one place, `server/src/config.ts`; the time and photo limits can be overridden in `server/.env` without touching code. The form reads them from `GET /api/auctions/rules`, so it always matches the server. |

**Team decision (RF02):** sessions **renew with use**. A session ends after **2 hours without any authenticated action**,
and in any case **7 days after login**. Both are configurable in `server/.env` (`SESSION_IDLE_MINUTES`, `SESSION_MAX_DAYS`).
When the server ends a session, the client logs out and shows a "session expired" banner.

**Team decisions (accounts and passwords):**

- **Password policy:** 8–128 characters with a lowercase letter, an uppercase letter, a number and a symbol.
  The rules live in `shared/` so the forms show them live, and the server enforces them; a policy is only real if the server checks it.
- **Password storage:** only a salted **scrypt** hash is kept (N=2¹⁴, r=8, p=5, one of OWASP's recommended settings), in the
  format `scrypt$N$r$p$salt$hash`. Storing the parameters inside each hash lets us raise the cost later without breaking accounts.
- **Login attempts:** after **3 wrong passwords in a row**, logging in to that account is blocked for **15 minutes**
  (`LOGIN_MAX_ATTEMPTS`, `LOGIN_LOCK_MINUTES`). Wrong "current password" on the account page counts too, so a hijacked session can't
  be used to guess it. Attempts reserve their slot before the (slow) hash check, so even simultaneous guesses can't exceed the limit.
  Unknown emails get exactly the same responses and timing, so the login doesn't reveal which emails have accounts.
  Trade-off: someone who knows your email can lock your login for 15 minutes; we accepted that in exchange for stopping password guessing.
- **My account (`/account`):** change the display name and the password. The email can't be changed, because it identifies the account (RF01).
  Changing the password logs out every other device of that account.
- **Deleting an account** (not covered by the requirements, so a team decision): allowed only when nothing is still open —
  none of the user's own auctions is scheduled or live, and they have no bid in a live auction — after retyping the password
  (it counts toward the login-attempt limit) and typing `DELETAR`. The account is **anonymized, not erased**: the name becomes
  "Conta excluída", login stops working, every session ends and the email is released for a future account (RF01 still holds:
  one email, one account at a time). Its auctions, bids, results and photos stay, because RF08 says nothing is deleted and
  results, seller profiles (RF22), "Minhas participações" (RF27) and purchase history (RF31) depend on them.

**Demo account** (owns the sample listings, useful to see the seller's view): `demo@arremate.dev` / `Demo@12345`.

### REST API (`/api`)

| Method | Path                | Session | Description                                |
| ------ | ------------------- | ------- | ------------------------------------------ |
| POST   | `/auth/signup`      |         | `{ name, email, password }` → `{ token, user }` |
| POST   | `/auth/login`       |         | `{ email, password }` → `{ token, user }`  |
| POST   | `/auth/logout`      | ✔       | Ends the session (also on its open sockets) |
| GET    | `/auth/me`          | ✔       | Current user (with `createdAt`)            |
| PATCH  | `/account`          | ✔       | Change display name: `{ name }`            |
| PUT    | `/account/password` | ✔       | `{ currentPassword, newPassword }`; ends the account's other sessions |
| GET    | `/account/deletion-check` | ✔ | What still prevents deleting the account (active auctions, bids in live auctions) |
| POST   | `/account/delete`   | ✔       | `{ password, confirmation: "DELETAR" }`; `409` while something is still open |
| GET    | `/auctions?q=`      |         | List or search listings (live ones first)  |
| GET    | `/auctions/rules`   |         | The limits for creating an auction (RF06) |
| GET    | `/auctions/:id`     |         | One listing (no bids: those are in the room) |
| POST   | `/auctions`         | ✔       | Create an auction: multipart with `title, description, category, startingPrice, minIncrement, durationMinutes, startsAt?` and the files in `photos` |
| POST   | `/auctions/:id/cancel` | ✔    | Cancel your own auction (RF08): `409` if it has bids, ended or was already cancelled |
| GET    | `/photos/:name`     |         | An uploaded photo |

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

**Team decisions (RF05/RF06): auction limits**

| Limit | Default | Override in `server/.env` | Why |
| ----- | ------- | ------------------------- | --- |
| Name | 3–100 characters | — | Enough for "Fusca 1972 totalmente restaurado"; short enough for a card. |
| Description | 10–2000 characters | — | Forces at least a sentence, without becoming a wall of text. |
| Categories | Arte, Colecionáveis, Design, Eletrônicos, Moda, Música, Relógios, Veículos, Outros | — (in `shared/src/index.ts`) | Covers the kinds of goods typically auctioned; "Outros" catches the rest. |
| Photos | 3–8, JPEG/PNG/WebP, ≤ 5 MB each | `LISTING_MIN_PHOTOS` (never below 3), `LISTING_MAX_PHOTOS`, `LISTING_MAX_PHOTO_MB` | 3 is required by RF05; 8 × 5 MB keeps one listing under 40 MB of disk. The type is read from the file's bytes, not its name. |
| Starting price / increment | R$ 1,00 – R$ 100.000.000,00 | — | Whole cents only, so money is never rounded (RF19). |
| Start | 1 minute to 30 days ahead | `LISTING_MIN_LEAD_MINUTES`, `LISTING_MAX_LEAD_DAYS` | A minimum lead keeps "Agendado" a real state (RN01); 30 days keeps the listing page current. |
| Duration | 3 minutes to 7 days | `LISTING_MIN_DURATION_MINUTES`, `LISTING_MAX_DURATION_DAYS` | 3 minutes makes the demo possible; a week is the longest that still feels "live". |

### Data storage

By the organizers' rule there is no database and no cloud storage: everything is kept on the **VM's disk**.

- **Data** (users, sessions, items, auctions, bids) lives in memory while the server runs (`server/src/store.ts`)
  and is saved to `server/data/store.json` **after every change, before the request is answered or anyone is notified**
  (`server/src/persistence.ts`). The file is written to a temporary file, flushed to disk and then renamed over the old
  one, so a crash never leaves it half-written. On start the server loads it back, so **restarts keep everything**,
  including logins. Only passwords' hashes and sessions' token hashes are on disk.
- **Photos** are files in `server/data/photos/` with random names, served by the API at `/api/photos/<name>`.
  Only names the server generated are served, so no other file can be requested.
- `server/data/` is ignored by git. The location can be changed with `DATA_DIR`.
- Run a **single** server process: two processes would each have their own copy in memory.
- Node runs the JavaScript on one thread and every check-then-update in `server/src/services/` is synchronous,
  so two bids (or two signups with the same email) can never interleave.
- Saving rewrites the whole file each time: simple, and fast enough at hackathon scale.

### Client structure

```
client/src/
├── lib/                    (imported as #lib/...)
│   ├── api.ts              fetch wrapper
│   ├── auth.svelte.ts      session state (login/signup/logout/expiry)
│   ├── socket.svelte.ts    shared Socket.io connection
│   ├── room.svelte.ts      AuctionRoom: joining an auction's live room
│   ├── clock.svelte.ts     one ticking clock for all countdowns
│   └── components/         Header, AuctionHero, AuctionCard, BidForm, PasswordChecklist, ...
└── routes/
    ├── +page.svelte        featured auction carousel + grid of all auctions/search results
    ├── auctions/[id]/      listing (public) + live room (logged in)
    ├── sell/               list an item
    ├── account/            my account (name, password, delete account)
    ├── login/
    └── signup/
```
