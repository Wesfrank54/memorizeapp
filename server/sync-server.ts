import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { PushBody } from '../src/core/sync-protocol.ts'
import type { DB } from './storage.ts'
import { pullDB, pushDB } from './storage.ts'

function cors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
}

function json(res: ServerResponse, code: number, body: unknown): void {
  cors(res)
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

/**
 * The sync server — stand-in for "Postgres as source of truth" fronted by
 * PowerSync.
 *
 * Phase 5 migration target:
 * This HTTP shape (push + pull with cursor + userId) was intentionally
 * modeled after PowerSync so the client-side export/apply logic can stay
 * almost identical.
 *
 * Real production will use:
 * - PowerSync SDK on client (instead of these fetch calls)
 * - SupabaseConnector (see spike/db/connector.ts)
 * - Postgres + auth for user_id
 *
 * Two endpoints mirror PowerSync's upload queue + bucket streaming:
 *   POST /sync/push   union a device's writes
 *   GET  /sync/pull   stream rows newer than the device's cursor
 * `onChange` lets the entry point persist after every write.
 */
export function createSyncServer(db: DB, onChange?: () => void): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (req.method === 'OPTIONS') {
      cors(res)
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true })
      return
    }
    if (req.method === 'POST' && url.pathname === '/sync/push') {
      try {
        const body = JSON.parse(await readBody(req)) as PushBody
        pushDB(db, body.userId, body.events ?? [], body.content ?? [], body.tombstones ?? [])
        onChange?.()
        json(res, 200, { ok: true })
      } catch (e) {
        json(res, 400, { error: String(e) })
      }
      return
    }
    if (req.method === 'GET' && url.pathname === '/sync/pull') {
      const userId = url.searchParams.get('userId') ?? ''
      const cursor = Number(url.searchParams.get('cursor') ?? '0') || 0
      json(res, 200, pullDB(db, userId, cursor))
      return
    }
    json(res, 404, { error: 'not found' })
  })
}
