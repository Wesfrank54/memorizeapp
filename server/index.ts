import { createSyncServer } from './sync-server.ts'
import { loadDB, saveDB } from './storage.ts'

/**
 * Development / toy sync server.
 *
 * Phase 5: This is a stand-in for the real production backend.
 * See:
 *   - ../memorize-spike/db/postgres-schema.sql
 *   - ../memorize-spike/db/powersync-sync-rules.yaml
 *   - ../memorize-spike/db/connector.ts  (Supabase + PowerSync example)
 *   - SYNC.md in the app for the migration steps
 *
 * The client protocol (push + pull with cursor) was designed to be compatible
 * with PowerSync's upload queue + bucket streaming.
 *
 * In production you will:
 *   1. Run Postgres + PowerSync (Supabase or self-hosted)
 *   2. Apply the schema + rules
 *   3. Replace the custom pushSync/pullSync calls with PowerSync SDK
 *   4. Get userId from authenticated session
 */

const PORT = Number(process.env.PORT ?? 8787)
const DB_PATH = process.env.SYNC_DB ?? './data/sync-db.json'

const db = loadDB(DB_PATH)
const server = createSyncServer(db, () => saveDB(DB_PATH, db))

server.listen(PORT, () => {
  console.log(`[DEV] sync server listening on http://localhost:${PORT}  (db: ${DB_PATH})`)
  console.log('[DEV] This is the toy server. See Phase 5 docs for PowerSync migration.')
})
