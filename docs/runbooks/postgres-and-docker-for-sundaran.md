# Postgres and Docker for Sundaran

A beginner guide for this repo. You know MongoDB and Node well. This maps what you know to what is new.

> **What we will do:** learn the few Postgres and Docker ideas this repo uses.
> **What we get at the end:** you can start the database, look inside it, run migrations, reset it and read logs.
> **What I must keep ready:** Docker Desktop installed and running.

Commands marked **(to be confirmed by the build)** depend on files that were not
finished when this guide was written. The lead checks them at the end.

---

## 1. Postgres vs MongoDB

Postgres is a **relational database**. Data lives in **tables** with fixed **columns**.
MongoDB keeps **documents** in **collections**, and each document can have any shape.

| MongoDB word | Postgres word | Simple meaning |
|---|---|---|
| database | database | Same idea |
| collection | **table** | A list of things of one kind, for example `briefs` |
| document | **row** | One thing, for example one brief |
| field | **column** | One property. Every row has the same columns |
| `_id` (ObjectId) | **primary key** (`id uuid`) | The unique id of a row |
| `ref` + `populate()` | **foreign key** + **JOIN** | A column that points to a row in another table |
| Mongoose schema | **table definition** (Drizzle, in TypeScript) | The shape of the table |
| (no real equal) | **migration** | A SQL file that changes the tables, run once, in order |
| index | index | Same idea: makes search fast |
| embedded array | `text[]` or `jsonb` column, or a child table | Lists inside a row |

### 1.1 Foreign key, a small example

In MongoDB you may write:

```js
// Mongoose
const BriefSchema = new Schema({ productId: { type: ObjectId, ref: 'Product' } });
```

In Postgres the database itself checks the link:

```sql
CREATE TABLE briefs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id),
  title      text NOT NULL
);
```

- `REFERENCES products(id)` is the **foreign key**.
- If you insert a brief with a `product_id` that does not exist, Postgres **refuses** it.
  MongoDB would save it and you find the bug later.

### 1.2 JOIN, a small example

Mongoose `populate()` becomes one SQL query:

```sql
SELECT b.code, b.title, p.name AS product
FROM briefs b
JOIN products p ON p.id = b.product_id
WHERE b.stage = 'frozen';
```

### 1.3 Migration, why we need it

- In MongoDB you change the schema in code, and old documents keep the old shape.
- In Postgres, the table shape is stored in the database. To add a column, you must run SQL:

```sql
ALTER TABLE briefs ADD COLUMN hook text;
```

- A **migration** is a file with that SQL. Every developer and every server runs the same
  files in the same order. So all databases have the same shape.
- In this repo, **drizzle-kit** writes the migration files for you from the TypeScript
  table definitions (ADR 0002). You read them, then commit them.
- Rule: never edit a migration that already ran on a shared database. Make a new one.

---

## 2. What Docker Compose does here

- **Docker** runs a program inside a **container**: a small, isolated box with everything
  the program needs. You do not install Postgres on your Mac.
- **Docker Compose** starts several containers together from one file, `docker-compose.yml`.
- A **volume** is a disk that the container keeps after it stops. Your database data lives there.

The services in this repo (from the build plan):

| Service | What it is | Like in MERN |
|---|---|---|
| `postgres` | PostgreSQL 16 database | Your `mongod` |
| `minio` | Local S3 storage for files (stands in for Cloudflare R2) | A local file bucket |
| `minio-init` | Runs once to create the bucket | A setup script |
| `api` | Express API | Your Express server |
| `worker` | pg-boss job runner (same code base as the API) | A cron or queue worker |
| `web` | The React app, served by nginx | Your built React app |

Root scripts (from `package.json`):

```bash
npm run docker:infra   # starts only postgres + minio + minio-init
npm run docker:up      # starts everything (uses the "app" profile) and builds images
npm run docker:down    # stops everything
```

A **profile** is a tag in the compose file. Services with `profiles: [app]` only start when
you ask for that profile. So `docker compose up -d` alone may start only the infra.

Useful commands:

```bash
docker compose ps                 # which containers run, and their health
docker compose stop               # stop, keep data
docker compose start              # start again
```

---

## 3. Open psql inside the container

`psql` is the Postgres command-line client. Like `mongosh` for MongoDB.

```bash
docker compose exec postgres psql -U <user> -d <database>
```

- `<user>` and `<database>` come from `.env` (for example `POSTGRES_USER`, `POSTGRES_DB`).
  **(to be confirmed by the build)**
- `exec` runs a command inside a running container.

Type `\q` to leave.

## 4. See tables and data

Inside `psql`:

| Command | What it shows | MongoDB equal |
|---|---|---|
| `\dt` | List tables | `show collections` |
| `\d briefs` | Columns, keys and indexes of one table | (look at the schema file) |
| `\dn` | List schemas (you will see `pgboss` for jobs) | (none) |
| `\x` | Toggle wide rows to vertical view | (none) |
| `SELECT * FROM products LIMIT 5;` | First 5 rows | `db.products.find().limit(5)` |
| `SELECT count(*) FROM briefs;` | Count rows | `db.briefs.countDocuments()` |

Remember: SQL ends with `;`. Without it, psql waits for more input.

A GUI is fine too. This repo has Drizzle Studio: `npm run db:studio -w @growth-desk/api`.
TablePlus, DBeaver or pgAdmin also work. Connect to `localhost`, the port from `.env`
(Postgres default is `5432`), with the same user and password.

## 5. Run migrations and seed

From the repo root, with the infra running:

```bash
npm run db:generate   # after you change a table in TypeScript: writes a new SQL migration file
npm run db:migrate    # applies all migrations that have not run yet
npm run db:seed       # loads sample data (development only)
```

- These run inside the `apps/api` workspace (they call `npm run ... -w @growth-desk/api`).
- When you run the full stack in Docker, the API may run migrations on start.
  **(to be confirmed by the build)**
- The seed is **sample data**. It never runs in production.

How to see which migrations ran: drizzle keeps a record table. In psql try `\dt drizzle.*`.
**(to be confirmed by the build)**

## 6. Reset the database

This **deletes all local data**. Only for your laptop.

```bash
docker compose --profile app down -v   # stop all, and -v removes the volumes (the data)
npm run docker:infra                   # start postgres + minio again, empty
npm run db:migrate                     # create the tables again
npm run db:seed                        # load sample data again
```

- `-v` is the key part. Without it, `down` keeps your data.
- It also clears MinIO files (uploaded videos), if MinIO uses a volume.

## 7. Read logs

```bash
docker compose logs -f api          # follow API logs (Ctrl+C to stop following)
docker compose logs -f worker       # job logs: publish, metrics, escalation
docker compose logs --tail 100 postgres
docker compose logs -f              # all services together
```

- API logs are JSON lines (pino). Each request has a request id, so you can find all lines for one request.
- Tip: pipe through `npx pino-pretty` to read them easier:
  `docker compose logs -f api | npx pino-pretty`

## 8. When something goes wrong

| You see | Likely cause | Try |
|---|---|---|
| `connection refused` on port 5432 | Postgres not running | `npm run docker:infra`, then `docker compose ps` |
| `relation "briefs" does not exist` | Migrations not run | `npm run db:migrate` |
| `port is already allocated` | Another Postgres runs on your Mac | Stop it, or change the port in `.env` |
| `violates foreign key constraint` | You point to a row that does not exist | Create the parent row first (for example the product) |
| `duplicate key value violates unique constraint` | Same unique value twice | Use a different value, or update instead of insert |
| Old data after a schema change | Volume kept old tables | Reset (section 6) |
