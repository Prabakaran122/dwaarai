# Database migrations

Numbered `.sql` files, applied in filename order by
[`../src/db/migrate.js`](../src/db/migrate.js) and recorded in a
`schema_migrations` table so each runs exactly once.

```bash
export DATABASE_URL=postgresql://cguser:devpass@localhost:5432/communitygate

pnpm --filter api-gateway migrate              # apply everything pending
pnpm --filter api-gateway migrate --dry-run    # list what would run
```

CI applies every migration to a fresh Postgres on each push (the `migrations`
job), then runs it again to confirm a second run is a clean no-op.

## Adopting a database that predates the runner

Databases provisioned before the runner existed have all their tables but no
`schema_migrations` rows. The runner refuses to touch them rather than replay
`001` over live data. Tell it what's already applied, once:

```bash
# Everything up to and including this file is already applied by hand.
pnpm --filter api-gateway migrate --baseline 030_staff_access_windows.sql
```

That records those files as applied **without executing them**; the next run
applies only what's genuinely pending. Use `--baseline latest` only when every
file in the directory is already applied. A genuinely empty database needs no
baseline — it just runs from `001`.

## Adding a migration

Take the next number, keeping the `NNN_short_name.sql` form:

```
031_event_contract.sql
032_your_change.sql
```

- **Never edit a migration that has been applied.** The runner checksums each
  file and stops if one changed, because the database and the repo no longer
  agree. Write a new migration instead. (`--allow-drift` re-records the checksum
  for genuinely cosmetic edits.)
- Each file runs in its own transaction. If a statement can't run inside one —
  `CREATE INDEX CONCURRENTLY`, for example — put `-- migrate:no-transaction` on
  a line in that file. Such a file can leave partial changes behind if it fails,
  so keep it to a single statement.
- Prefer `IF NOT EXISTS` / `IF EXISTS` where it doesn't obscure intent.

## Known upkeep: gate_events partitions

`gate_events` is range-partitioned by month. `002` created partitions through
2026-04 and `006` extended them through **2027-12**. Once that runs out, every
insert fails with "no partition of relation found for row" — this needs either a
new extend-partitions migration or, better, scheduled partition creation
(`src/cron/` already exists and `node-cron` is a dependency).
