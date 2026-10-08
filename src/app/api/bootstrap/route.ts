// Self-healing bootstrap: detects an empty database (e.g. after a schema push
// wiped all rows) and lets anyone standing at the login screen re-initialize
// the demo dataset with one click. Only works while the DB has NO users —
// once initialized the POST endpoint refuses (409), so it can never be used
// to wipe a live system.
import { db } from '@/lib/db'
import { runSeed } from '@/lib/seed-data'
import { ok, conflict, serverError } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const userCount = await db.user.count()
    return ok({ needsBootstrap: userCount === 0, userCount })
  } catch (err) {
    console.error('[api/bootstrap GET]', err)
    return serverError()
  }
}

export async function POST() {
  try {
    const userCount = await db.user.count()
    if (userCount > 0) {
      return conflict('Database is already initialized — bootstrap is only available on an empty database')
    }
    const summary = await runSeed(db)
    console.log('[api/bootstrap] demo data initialized', summary)
    return ok({ initialized: true, summary })
  } catch (err) {
    console.error('[api/bootstrap POST]', err)
    return serverError('Failed to initialize demo data')
  }
}
