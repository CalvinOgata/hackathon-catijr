# hackathon-catijr
Hackathon da CatiJr — a real-time auction platform.

**Sistema publicado:** _(endereço da VM — preencher após a publicação, ver **Publishing on the VM**)_

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

## Publishing on the VM (RNF01, RNF03)

One Node process serves everything on one port: the built web app, the API and the WebSocket
connection, plus the job that opens and closes auctions. Data and photos stay on the VM's disk
(`server/data/`). A systemd service keeps it running (starts on boot, restarts if it stops);
a reverse proxy in front is optional.

From scratch on an Ubuntu/Debian VM:

```bash
# 1. Node 22 LTS, git and make
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git make

# 2. The code
git clone https://github.com/CalvinOgata/hackathon-catijr.git
cd hackathon-catijr

# 3. Build and install the service (installs dependencies and creates server/.env on the first run)
make service
```

The site is then at `http://<VM address>:3333` (open the port in the VM's firewall, or change `PORT`
in `server/.env`). To serve it on port 80, or with HTTPS on a domain, install [Caddy](https://caddyserver.com)
and use `deploy/Caddyfile` (WebSockets work through it as is).

| On the VM | |
| --------- | --- |
| `make update` | Pull the latest code, rebuild and restart |
| `make logs` | Follow the logs: requests, auctions opening and closing, errors |
| `sudo systemctl restart arremate` | Restart (data, logins and auctions survive it, RF18) |
| `make reset-data && sudo systemctl restart arremate` | Start over from the sample data |

## Commands

Run `make` to list them all.

| Command         | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| `make dev`      | Server (watch mode) and client together                      |
| `make server`   | Only the API server                                          |
| `make client`   | Only the web client                                          |
| `make check`    | Type-check server and client                                 |
| `make build`    | Build server (`server/dist`) and client (`client/build`)     |
| `make start`    | Build and run the production build (site + API on port 3333) |
| `make service`  | On the VM: build and install/restart the systemd service     |
| `make update`   | On the VM: pull, rebuild and restart the service             |
| `make logs`     | On the VM: follow the service's logs                         |
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
| **RF09** · Live auction room with real-time updates and masked leader identity. | Socket.io room broadcasts every bid instantly (`room:bid`, `auction:updated`); the room shows the last 10 bids. Bidders are shown by a masked name (`maskBidderName`, e.g. "Carlos S.", "C***n"; deleted accounts as "Conta excluída") and told apart by a `bidderTag` that is different in every auction, never by their user id: ids also appear on seller data, where full names are public, so they would reveal who is bidding. Who bid and who leads is only sent to the room; public listings carry no bidder data. When over, participants see "Vendido" (with winner and amount) or "Encerrado sem lances". |
| **RF10** · Bid acceptance rules. | Bids require: valid session, membership in the auction room, live state (`startsAt <= now < endsAt`), author not seller or current leader, and amount $\ge$ current minimum bid. Every refusal returns the reason, a code (`SESSION_INVALID`, `NOT_IN_ROOM`, `NOT_IN_PROGRESS`, `SELF_BID`, `ALREADY_LEADER`, `BELOW_MINIMUM`, `RATE_LIMITED`, `INVALID_BID`) and the current minimum bid (`currentMinBid`, whenever the auction exists). Bids are irrevocable. |
| **RF11** · Bid concurrency and atomic recording. | In-memory read-check-write runs synchronously on Node's single thread. The state is flushed to disk (`saveStore()`) before any broadcast or response is sent. If that write fails, the bid is undone in memory and the bidder is told it failed, so it can't be saved later by another change (cancellations work the same way). |
| **RF12** · Bid idempotency. | The client creates one `idempotencyKey` per bid intent (auction + amount) and reuses it when it re-sends that bid after getting no definitive answer (timeout, dropped connection, server error, expired session; the key is kept in `sessionStorage`, so it survives logging in again). The key is saved with the bid in `store.json`, so a re-sent bid returns the original one, even after the auction moved on or the server restarted, and never creates a second bid. |
| **RF13** · Bid rate limiting. | At least 500 ms between bid attempts of the same user. Every attempt counts, refused ones too, so a user can't flood the server with bids that fail. A re-send of the same bid (RF12, same key) is never rate limited, attempts refused by the limit don't restart the timer, and each user has their own timer, so nobody slows down anyone else. The bid button also waits 500 ms after each attempt. |
| **RF14** · Dynamic minimum bid calculation. | The reference table: the increment depends only on the current price (R$ 1,00 up to R$ 99,99 … R$ 500,00 from R$ 25.000,00); the first bid may equal the starting price. Sellers don't choose an increment. The server computes the minimum next bid and sends it with every auction (`minBid`, `minIncrement`); the screens only display it. |
| **RF15** · A last-second bid can't win without a chance to answer; auctions can't go on forever. | **Team decision:** the reference rule. A bid leaving **less than 2 minutes** moves the end to **2 minutes after the bid**, up to **30 minutes** past the original end in all (`BID_EXTENSION_WINDOW_MINUTES`, `BID_EXTENSION_MAX_MINUTES`). Applied in the same step that accepts the bid, so the end can't pass in between; the new end reaches every room and listing with the bid, and the auction page shows "Prorrogado" with the original time. 2 minutes is enough to see the bid and answer; the cap guarantees an end. |
| **RF16** · The server's clock is the one that counts. | Every bid is checked against the server's clock when it's processed. Browsers sync their countdowns to the server's time (`clock:sync`), so screens are right even when a computer's clock is wrong, but the countdown is only visual. |
| **RF17 / RF18** · Auctions open and close by themselves, also across restarts; closing twice never duplicates anything; no bid after the close. | **Team decision:** an auction's state is always **computed from its times, bids and cancellation**, never stored as a flag that a job has to flip. So it's right at any moment, after any restart, and no bid can land after the end (it's checked in the same step that records the bid, which can't interleave with anything). A **lifecycle job** (`server/src/lifecycle.ts`, every second and on start) announces each opening and closing to everyone and records it once (`openedAt`, `closedAt`), so it runs exactly once even if the server was down at the time. We chose this over a job that changes states because there's no window in which the stored state is wrong. |
| **RF19** · No rounding errors; times right in every timezone. | Money is always whole cents (integers). Times are stored as instants and sent as ISO 8601 UTC; the screens show them in the viewer's own timezone. |
| **RF20** · A public page lists scheduled and live auctions and leads to each one's page and room. | **Team decision:** the home page shows **only open auctions** (ended and cancelled ones keep their page, by link): **live first, ending soonest on top** (they need attention now), **then scheduled, starting soonest**. With many auctions it loads **12 at a time** ("Carregar mais"), filtered by search and category on the server; auctions that close or are cancelled leave the page live, and new ones appear in their place. |
| **RF25** · Spectators and headcount. | Everyone enters a room as a spectator, the seller included: spectators see everything live but can't bid. "Participar do leilão" makes them a participant without leaving the room (`room:upgrade`); the seller can only watch their own auction. The room shows how many participants and spectators are in it, counting people rather than connections (someone watching in one tab and bidding in another is a participant) and updating when anyone joins, upgrades, leaves, closes the tab or logs out. A participant who reconnects comes back as a participant. |
| **RNF01 / RNF03** · Everything runs on the VM and can be recreated from this README. | **Team decision:** one Node process (site + API + WebSocket + lifecycle job) under systemd, data on the VM's disk; see **Publishing on the VM**. One process keeps the in-memory guarantees simple (RF11) and there's nothing else to install. |
| **RNF04** · Demo data. | See **Demo data** below. |

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

**Demo data** (RNF04), created on the first start (and again after `make reset-data`): the accounts below and
16 auctions in every state: live with and without bids, scheduled, sold (with winners), ended without bids and
cancelled. Past bids are placed through the normal bid rules, as if at their time, so the sample data can't break them.
Their photos are illustrations shipped in `server/seed-photos/` and copied into the data folder like uploads, so the demo
depends on nothing outside the VM (RNF01). Replace those files with real photos (same names) to change them.

**Demo accounts** (RNF04: ao menos 1 comitente e 3 compradores com dados de demonstração):
- **Comitente / Seller:** `demo@arremate.dev` / `Demo@12345` (possui os leilões de exemplo; acesse para ver a visão de vendedor)
- **Compradores / Buyers:**
  - `comprador1@arremate.dev` / `Demo@12345` (Bernardo Lima)
  - `comprador2@arremate.dev` / `Demo@12345` (Camila Rocha)
  - `comprador3@arremate.dev` / `Demo@12345` (Daniel Souza)

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
| GET    | `/auctions?q=&category=&offset=&limit=` | | Public listing (RF20): scheduled and live auctions only, live ending soonest first, then scheduled starting soonest; `{ auctions, total }`, 12 per page by default (max 50) |
| GET    | `/auctions/featured` |        | Featured open auctions, for the home carousel |
| GET    | `/auctions/rules`   |         | The limits for creating an auction (RF06) and the extension rule (RF15) |
| GET    | `/auctions/:id`     |         | One listing (no bids: those are in the room) |
| POST   | `/auctions`         | ✔       | Create an auction: multipart with `title, description, category, startingPrice, durationMinutes, startsAt?` and the files in `photos` |
| POST   | `/auctions/:id/cancel` | ✔    | Cancel your own auction (RF08): `409` if it has bids, ended or was already cancelled |
| GET    | `/photos/:name`     |         | An uploaded photo |

The session token is sent as `Authorization: Bearer <token>`. An invalid or expired session gets
`401 { code: "SESSION_INVALID" }`. Passwords are hashed with scrypt.

### Real time (Socket.io)

Anyone can connect (to receive public listing updates). Send the session token in the handshake
(`auth: { token }`) to enter rooms and bid.

| Direction            | Event             | Payload                                                    |
| -------------------- | ----------------- | ---------------------------------------------------------- |
| client → server      | `clock:sync`      | ack → the server's time (epoch ms); anyone. The client measures the difference to its own clock on every connect and every 10 minutes, so countdowns and statuses follow the server's clock (RF16) even when the browser's is wrong |
| client → server      | `room:join`       | `auctionId, mode` (`'participant'` or `'spectator'`), ack → `{ ok, auction, mode, viewerTag }` with recent bids; `mode` is the role given (a seller always watches their own auction), `viewerTag` is your `bidderTag` in this auction (session required). Joining again moves the connection to the new mode's room |
| client → server      | `room:upgrade`    | `auctionId`, ack like `room:join`: a spectator becomes a participant without leaving the room (RF25) |
| client → server      | `room:leave`      | `auctionId` (whichever the mode)                            |
| client → server      | `bid:place`       | `{ auctionId, amount, idempotencyKey? }`, ack → `{ ok: true, auction, bid }` or `{ ok: false, error, code?, currentMinBid? }` (session + room required) |
| server → everyone    | `auction:created` | new listing                                                |
| server → everyone    | `auction:updated` | listing after a bid (price, bid count — no bidder)         |
| server → room        | `room:bid`        | `{ auction, bid }` with the bidder's masked name and tag, to participants and spectators |
| server → room        | `room:presence`   | `{ auctionId, participants, spectators }`: people (not tabs) in the room, sent whenever someone joins, upgrades, leaves, disconnects or logs out (RF25) |
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
| Starting price | R$ 1,00 – R$ 100.000.000,00 | — | Whole cents only, so money is never rounded (RF19). |
| Start | 1 minute to 30 days ahead | `LISTING_MIN_LEAD_MINUTES`, `LISTING_MAX_LEAD_DAYS` | A minimum lead keeps "Agendado" a real state (RN01); 30 days keeps the listing page current. |
| Duration | 3 minutes to 7 days | `LISTING_MIN_DURATION_MINUTES`, `LISTING_MAX_DURATION_DAYS` | 3 minutes makes the demo possible; a week is the longest that still feels "live". |
| Extension (RF15) | 2 minutes, at most 30 in all | `BID_EXTENSION_WINDOW_MINUTES`, `BID_EXTENSION_MAX_MINUTES` | The reference rule; see RF15 above. |

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
- Each auction also records when it opened and closed (`openedAt`, `closedAt`), written by the lifecycle job (RF17).
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
│   ├── clock.svelte.ts     one ticking clock for all countdowns, synced with the server's
│   ├── rules.ts            the server's limits and rules, fetched once
│   └── components/         Header, AuctionHero, AuctionCard, BidForm, PasswordChecklist, ...
└── routes/
    ├── +page.svelte        featured auction carousel + open auctions (search, categories, "load more")
    ├── auctions/[id]/      listing (public) + live room (logged in)
    ├── sell/               list an item
    ├── account/            my account (name, password, delete account)
    ├── login/
    └── signup/
```
