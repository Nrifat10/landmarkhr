// POST /api/auth/logout — destroy session + clear cookie (no auth required)
import { NextRequest } from 'next/server'
import { destroySession, SESSION_COOKIE } from '@/lib/auth'
import { ok, serverError } from '@/lib/api-helpers'

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value
    if (token) {
      try {
        await destroySession(token)
      } catch {
        // clearing the cookie below is enough even if the row is already gone
      }
    }
    const res = ok({ success: true })
    res.cookies.set(SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
    return res
  } catch (err) {
    console.error('[api/auth/logout]', err)
    return serverError()
  }
}
