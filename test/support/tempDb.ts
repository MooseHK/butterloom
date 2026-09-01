import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * A database of this process's own, chosen before anything opens one.
 *
 * The tests that exercise carts and orders drive the real Hono routes, so they
 * go through src/db/client.ts and whatever `BUTTERLOOM_DB` points at — which by
 * default is var/butterloom.db, the database an operator's own `npm start` is
 * using. Two problems with that, and the second is the one that bites: the
 * suite writes over local data, and `node --test` runs each test file in its
 * own process, so two of them race to run the migrations against one SQLite
 * file. That raced on roughly three runs in five, sometimes taking a whole
 * worker down with it, which reads as a broken feature rather than as a broken
 * test.
 *
 * Importing this first sets the variable before src/db/client.ts is evaluated:
 * ESM initialises a module's dependencies in source order, so the import that
 * opens the database has to come after this one. It is not a *.test.ts file, so
 * the runner does not pick it up as a suite of its own.
 */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'butterloom-test-'))
process.env.BUTTERLOOM_DB = path.join(dir, 'test.db')
