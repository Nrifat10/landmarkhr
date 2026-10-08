'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertTriangle,
  ArrowRight,
  DatabaseZap,
  Loader2,
  Lock,
  LogIn,
  Mail,
  ShieldCheck,
} from 'lucide-react'
import { api } from '@/lib/api-client'
import { useAppStore } from '@/lib/store'
import type { SessionUser } from '@/lib/types'
import { cn } from '@/lib/utils'

const DEMO_ACCOUNTS: { label: string; email: string; hint: string }[] = [
  { label: 'Admin', email: 'admin@example.com', hint: 'full access' },
  { label: 'Accountant', email: 'accountant@example.com', hint: 'accounts + payroll' },
  { label: 'HR', email: 'hr@example.com', hint: 'staff + attendance' },
  { label: 'Viewer', email: 'viewer@example.com', hint: 'read-only' },
]

type BootstrapState =
  | { status: 'checking' }
  | { status: 'ready' }
  | { status: 'empty' }
  | { status: 'initializing' }

export function LoginScreen() {
  const { settings, setUser, setSettings } = useAppStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorShake, setErrorShake] = useState(0)
  const [loading, setLoading] = useState(false)
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ status: 'checking' })

  // Detect an empty database (e.g. after a schema push wiped all rows) so the
  // user can recover with one click instead of being locked out with 401s.
  useEffect(() => {
    let cancelled = false
    api
      .get<{ needsBootstrap: boolean }>('/api/bootstrap')
      .then((res) => {
        if (!cancelled) setBootstrap({ status: res.needsBootstrap ? 'empty' : 'ready' })
      })
      .catch(() => {
        if (!cancelled) setBootstrap({ status: 'ready' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleInitialize() {
    setBootstrap({ status: 'initializing' })
    try {
      await api.post('/api/bootstrap', {})
      // Refresh branding (company name/address/phone) that was seeded just now
      api
        .get<{ settings: typeof settings }>('/api/settings')
        .then((res) => setSettings(res.settings))
        .catch(() => {})
      toast.success('Demo data initialized', {
        description: 'Demo accounts are ready — sign in with the credentials below.',
      })
      setEmail('admin@example.com')
      setPassword('password')
      setBootstrap({ status: 'ready' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to initialize demo data')
      setBootstrap({ status: 'empty' })
    }
  }

  function trackCapsLock(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.getModifierState) setCapsLockOn(e.getModifierState('CapsLock'))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await api.post<{ user: SessionUser }>('/api/auth/login', { email, password })
      setUser(res.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      setErrorShake((n) => n + 1) // retrigger shake animation
    } finally {
      setLoading(false)
    }
  }

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail)
    setPassword('password')
    setError(null)
  }

  const cardContent = (
    <>
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>Enter your credentials to access the admin system</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="admin@example.com"
                className="pl-8"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                className={cn('pl-8 pr-10', capsLockOn && 'border-amber-400/70 dark:border-amber-500/50')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={trackCapsLock}
                onKeyUp={trackCapsLock}
                required
                aria-describedby={capsLockOn ? 'capslock-warning' : undefined}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" x2="22" y1="2" y2="22" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {capsLockOn ? (
              <p
                id="capslock-warning"
                className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400"
                role="status"
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                Caps Lock is on
              </p>
            ) : null}
          </div>

          {error ? (
            <motion.p
              key={errorShake}
              initial={{ x: 0 }}
              animate={errorShake > 0 ? { x: [0, -7, 7, -4, 4, 0] } : {}}
              transition={{ duration: 0.4, ease: 'easeInOut' }}
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
              aria-live="assertive"
            >
              {error}
            </motion.p>
          ) : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <LogIn className="mr-2 h-4 w-4" />
            )}
            Sign in
          </Button>

          <div className="space-y-2.5 rounded-md border bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-foreground">Demo credentials</p>
              <p className="tabular-nums">password for all</p>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {DEMO_ACCOUNTS.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => fillDemo(d.email)}
                  title={`${d.email} — ${d.hint}`}
                  className={cn(
                    'group flex items-center justify-between gap-1 rounded-md border bg-background px-2 py-1.5 text-left transition-colors',
                    email === d.email
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border hover:border-primary/40 hover:bg-primary/5'
                  )}
                >
                  <span className="truncate font-medium text-foreground/90">{d.label}</span>
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </button>
              ))}
            </div>
            <p className="text-center text-[11px] text-muted-foreground">
              Click an account to fill the form instantly
            </p>
          </div>
        </form>
      </CardContent>
    </>
  )

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-[#0B1832] via-[#0F1F3D] to-[#0A1226] p-4">
      {/* decorative grid — gold threads */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(rgba(212,175,55,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,0.07) 1px, transparent 1px)',
          backgroundSize: '44px 44px',
        }}
      />
      {/* soft corner glows — gold + navy */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#D4AF37]/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[#2A4A8C]/20 blur-3xl"
      />

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative grid w-full max-w-4xl gap-8 md:grid-cols-2"
      >
        {/* Brand panel (desktop) */}
        <div className="hidden flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-8 backdrop-blur md:flex">
          <div>
            {/* Full logo lockup on a white card so the brand prints true */}
            <div className="rounded-2xl bg-white p-6 shadow-2xl shadow-black/40">
              <Image
                src="/logo.png"
                alt={`${settings.companyName} — LANDMARK INTER GULF LLC`}
                width={480}
                height={322}
                priority
                className="h-auto w-full"
                unoptimized
              />
            </div>
            {/* gold-ruled tagline, echoing the logo's flanking lines */}
            <p className="mt-5 flex items-center justify-center gap-3 text-[11px] font-semibold uppercase tracking-[0.32em] text-[#D4AF37]">
              <span className="h-px w-10 bg-gradient-to-r from-transparent to-[#D4AF37]/70" aria-hidden />
              Workforce · Payroll · Accounts
              <span className="h-px w-10 bg-gradient-to-l from-transparent to-[#D4AF37]/70" aria-hidden />
            </p>
          </div>
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#D4AF37]" />
              <p className="text-sm leading-relaxed text-[#E9E6DC]/85">
                Complete manpower management: projects, staff, attendance, monthly payroll,
                salary sheets and company accounting — in SAR.
              </p>
            </div>
          </div>
          <p className="text-xs text-[#E9E6DC]/60">
            {settings.address} · {settings.phone}
          </p>
        </div>

        {/* Mobile brand header */}
        <div className="flex items-center gap-3 md:hidden">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/10">
            <Image
              src={settings.logo ?? '/logo-mark.png'}
              alt={settings.companyName}
              width={48}
              height={48}
              className="h-full w-full object-contain p-1"
              unoptimized
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-bold leading-tight text-white">{settings.companyName}</p>
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-[#D4AF37]">
              Workforce · Payroll · Accounts
            </p>
          </div>
        </div>

        {/* Login form / bootstrap state */}
        {bootstrap.status === 'empty' ? (
          <Card className="border-amber-200/60 bg-white/95 shadow-2xl backdrop-blur dark:bg-card/95">
            <CardHeader>
              <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
                <DatabaseZap className="h-5 w-5" />
              </div>
              <CardTitle className="text-xl">Database is empty</CardTitle>
              <CardDescription>
                No user accounts exist yet (the database may have been reset). Initialize the
                demo dataset to create sign-in accounts and sample records.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                  4 users with roles (admin, accountant, HR, viewer)
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                  6 projects · 40 staff · attendance &amp; payroll history
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                  Income &amp; expense transactions with categories
                </li>
              </ul>
              <Button onClick={() => void handleInitialize()} className="w-full" size="lg">
                <DatabaseZap className="mr-2 h-4 w-4" />
                Initialize demo data
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Takes a few seconds · all demo passwords are{' '}
                <span className="font-mono font-medium text-foreground">password</span>
              </p>
            </CardContent>
          </Card>
        ) : bootstrap.status === 'initializing' ? (
          <Card className="border-white/10 bg-white/95 shadow-2xl backdrop-blur dark:bg-card/95">
            <CardContent className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Initializing demo data…</p>
              <p className="text-xs text-muted-foreground">Creating users, projects, staff and payroll history</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-white/10 bg-white/95 shadow-2xl backdrop-blur dark:bg-card/95">
            {cardContent}
          </Card>
        )}
      </motion.div>
    </div>
  )
}
