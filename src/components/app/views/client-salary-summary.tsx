'use client'

// Client Salary Summary — monthly MANPOWER BILLING grouped by client company.
// For the chosen month every deployed worker's attendance hours are billed at
// the project's client rate (what we charge the client, e.g. 20 SAR/hour —
// distinct from the worker's own payroll rate, e.g. 15 SAR/hour). Each client
// group carries hours + rate + line amounts + Subtotal + 15% VAT + Grand Total
// and can be PRINTED and DOWNLOADED separately as its own company summary.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeDollarSign,
  Building2,
  Check,
  ChevronRight,
  Download,
  FileBarChart,
  FolderKanban,
  Info,
  Pencil,
  Printer,
  Users,
  Wallet,
  X as XIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PageHeader, SectionCard } from '@/components/app/shared/page-header'
import { StatCard } from '@/components/app/shared/stat-card'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { StatusBadge } from '@/components/app/shared/status-badge'
import { printWithPageRule } from '@/components/app/print/print-page-rule'
import { ClientSummaryPrintDialog } from '@/components/app/print/client-summary-print'
import { useDebounce } from '@/hooks/use-debounce'
import { api, qs } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatMoney, formatNumber, monthName, round2 } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type {
  ClientBillingLine,
  ClientSalaryGroup,
  ClientSalarySummaryData,
  ProjectRow,
} from '@/lib/types'

const STAFF_SCOPE_OPTIONS = [
  // NOTE: the FilterSelect built-in empty item (value "all") IS the default
  // "Active staff only" — so only the non-default option is listed here.
  { value: 'include-inactive', label: 'All staff (incl. inactive)' },
]

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: monthName(i + 1),
}))

const YEAR_OPTIONS = (() => {
  const y = new Date().getFullYear()
  return Array.from({ length: 6 }, (_, i) => ({ value: String(y - 4 + i), label: String(y - 4 + i) }))
})()

/** Stable key for a group (null clientId = the "No Client" bucket) */
function groupKey(g: ClientSalaryGroup): string {
  return g.clientId ?? '_noclient'
}

/** Filesystem-safe client name fragment for download filenames */
function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'client'
  )
}

/** "212" | "212.5" — integers stay clean, fractions keep 2dp */
function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : formatNumber(n, 2)
}

type ProjectBucket = {
  projectId: string
  projectName: string
  rate: number
  rateSource: 'project' | 'worker'
  rows: ClientBillingLine[]
  hours: number
  subtotal: number
}

/** Group a client's billing lines by project (each project has one client rate) */
function bucketByProject(rows: ClientBillingLine[]): ProjectBucket[] {
  const map = new Map<string, ProjectBucket>()
  for (const r of rows) {
    let b = map.get(r.projectId)
    if (!b) {
      b = {
        projectId: r.projectId,
        projectName: r.projectName,
        rate: r.clientRate,
        rateSource: r.rateSource,
        rows: [],
        hours: 0,
        subtotal: 0,
      }
      map.set(r.projectId, b)
    }
    b.rows.push(r)
    b.hours = round2(b.hours + r.hours)
    b.subtotal = round2(b.subtotal + r.amount)
  }
  return Array.from(map.values()).sort((a, b) => b.subtotal - a.subtotal || a.projectName.localeCompare(b.projectName))
}

/** Inline editor for a project's client rate (PUT /api/projects/:id). */
function ProjectRateEditor({
  projectId,
  rate,
  currency,
  onSaved,
}: {
  projectId: string
  rate: number
  currency: string
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(rate > 0 ? String(rate) : '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving) return // guard against double submits (Enter + button click)
    const n = value.trim() === '' ? 0 : Number(value)
    if (!Number.isFinite(n) || n < 0 || n > 100000) {
      toast.error('Enter a valid client rate (0 or more)')
      return
    }
    setSaving(true)
    try {
      // PUT needs the full project payload — fetch it, then merge the new rate
      const project = await api.get<ProjectRow>(`/api/projects/${projectId}`)
      await api.put(`/api/projects/${projectId}`, {
        name: project.name,
        managerName: project.managerName,
        location: project.location ?? '',
        status: project.status,
        clientId: project.clientId ?? '',
        clientRatePerHour: n,
      })
      toast.success(
        n > 0 ? `Client rate set to ${formatNumber(n)} ${currency}/hour` : 'Client rate cleared'
      )
      setEditing(false)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the client rate')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <span
        className="inline-flex items-center gap-0.5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Input
          autoFocus
          type="number"
          inputMode="decimal"
          min={0}
          step="0.25"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void save()
            } else if (e.key === 'Escape') {
              setEditing(false)
              setValue(rate > 0 ? String(rate) : '')
            }
          }}
          className="h-7 w-24 px-2 py-0 text-right text-xs tabular-nums"
          aria-label="Client rate per hour"
          disabled={saving}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => void save()}
          disabled={saving}
          aria-label="Save client rate"
        >
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            setEditing(false)
            setValue(rate > 0 ? String(rate) : '')
          }}
          disabled={saving}
          aria-label="Cancel editing"
        >
          <XIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </span>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setValue(rate > 0 ? String(rate) : '')
            setEditing(true)
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Edit client rate (currently ${formatNumber(rate)} ${currency} per hour)`}
        >
          {formatNumber(rate)} {currency}/h
          <Pencil className="h-3 w-3 text-muted-foreground" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>Edit the client rate billed for this project</TooltipContent>
    </Tooltip>
  )
}

export function ClientSalarySummaryView() {
  const settings = useAppStore((s) => s.settings)
  const user = useAppStore((s) => s.user)

  const [searchInput, setSearchInput] = useState('')
  const search = useDebounce(searchInput, 350)
  // 'all' = the select's built-in empty item → Active staff only (default)
  const [scope, setScope] = useState('all')
  const now = new Date()
  const [month, setMonth] = useState(String(now.getMonth() + 1))
  const [year, setYear] = useState(String(now.getFullYear()))

  const [data, setData] = useState<ClientSalarySummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [printGroup, setPrintGroup] = useState<ClientSalaryGroup | null>(null)

  const money = useCallback((n: number) => formatMoney(n, settings.currency), [settings.currency])
  const vatPercent = data ? Math.round(data.vatRate * 100) : 15
  const canEditRate = can(user, 'projects.edit')

  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      const query = qs({
        search: search || undefined,
        includeInactive: scope === 'include-inactive' ? 'true' : undefined,
        month,
        year,
      })
      const res = await api.get<ClientSalarySummaryData>(`/api/clients/salary-summary${query}`)
      setData(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load client salary summary')
    } finally {
      setLoading(false)
    }
  }, [search, scope, month, year])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const cards = data?.cards
  const groups = data?.groups ?? []

  // Footer totals over the (server-filtered) groups
  const totals = useMemo(() => {
    return groups.reduce(
      (acc, g) => ({
        workers: acc.workers + g.workerCount,
        projects: acc.projects + g.projectCount,
        hours: round2(acc.hours + g.hours),
        billed: round2(acc.billed + g.billedAmount),
        vat: round2(acc.vat + g.vatAmount),
        grand: round2(acc.grand + g.grandTotal),
      }),
      { workers: 0, projects: 0, hours: 0, billed: 0, vat: 0, grand: 0 }
    )
  }, [groups])

  // Projects billing lines with hours but no negotiated client rate (fallback warning)
  const fallbackProjects = useMemo(() => {
    if (!data) return []
    const names = new Set<string>()
    for (const g of data.groups) {
      for (const r of g.rows) {
        if (r.rateSource === 'worker' && r.hours > 0) names.add(r.projectName)
      }
    }
    return Array.from(names).sort()
  }, [data])

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => (prev === key ? null : key))
  }, [])

  const periodLabel = `${monthName(Number(month))} ${year}`

  /** One company's summary as CSV (worker lines + Subtotal / VAT / Grand Total) */
  const exportClientCsv = useCallback(
    (g: ClientSalaryGroup) => {
      const headers = [
        'Worker',
        'Iqama ID',
        'Position',
        'Category',
        'Project',
        'Hours',
        `Rate/Hr (${settings.currency})`,
        `Amount (${settings.currency})`,
      ]
      const rows: (string | number | null | undefined)[][] = g.rows.map((r) => [
        r.fullName,
        r.iqamaId,
        r.position,
        r.categoryName,
        r.projectName,
        r.hours,
        r.clientRate,
        r.amount,
      ])
      rows.push([
        `SUBTOTAL — ${g.workerCount} worker${g.workerCount === 1 ? '' : 's'}`,
        '',
        '',
        '',
        '',
        g.hours,
        '',
        g.billedAmount,
      ])
      rows.push([`VAT ${vatPercent}%`, '', '', '', '', '', '', g.vatAmount])
      rows.push(['GRAND TOTAL (incl. VAT)', '', '', '', '', '', '', g.grandTotal])
      downloadCsv(
        csvFilename('client-summary', `${slug(g.clientName)}-${slug(periodLabel)}`),
        buildCsv(headers, rows)
      )
      toast.success(`${g.clientName} summary downloaded`)
    },
    [settings.currency, vatPercent, periodLabel]
  )

  /** All clients in one CSV, with per-client subtotal rows + global totals */
  const exportCsv = useCallback(() => {
    if (!data) return
    const headers = [
      'Client Company',
      'City',
      'Worker',
      'Iqama ID',
      'Position',
      'Category',
      'Project',
      'Hours',
      `Rate/Hr (${settings.currency})`,
      `Amount (${settings.currency})`,
    ]
    const rows: (string | number | null | undefined)[][] = groups.flatMap((g) => [
      ...g.rows.map((r) => [
        g.clientName,
        g.city,
        r.fullName,
        r.iqamaId,
        r.position,
        r.categoryName,
        r.projectName,
        r.hours,
        r.clientRate,
        r.amount,
      ]),
      [
        `${g.clientName} — SUBTOTAL`,
        '',
        `${g.workerCount} workers`,
        '',
        '',
        '',
        '',
        g.hours,
        '',
        g.billedAmount,
      ],
    ])
    rows.push(['TOTAL BILLED (excl. VAT)', '', '', '', '', '', '', data.cards.billedHours, '', data.cards.billedAmount])
    rows.push([`VAT ${vatPercent}%`, '', '', '', '', '', '', '', '', data.cards.vatAmount])
    rows.push(['GRAND TOTAL (incl. VAT)', '', '', '', '', '', '', '', '', data.cards.grandTotal])
    downloadCsv(csvFilename('client-salary-summary', slug(periodLabel)), buildCsv(headers, rows))
    toast.success('Client salary summary exported')
  }, [data, groups, settings.currency, vatPercent, periodLabel])

  const scopeLabel = scope === 'include-inactive' ? 'All staff (incl. inactive)' : 'Active staff only'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Client Salary Summary"
        description={`Monthly manpower billing per client company — hours × client rate + ${vatPercent}% VAT`}
      >
        <Button
          variant="outline"
          className="print-hidden"
          onClick={exportCsv}
          disabled={!data || groups.length === 0}
        >
          <Download className="h-4 w-4" />
          CSV
        </Button>
        <Button
          className="print-hidden"
          onClick={() => printWithPageRule('size: A4 landscape; margin: 8mm;')}
          disabled={!data || groups.length === 0}
        >
          <Printer className="h-4 w-4" />
          Print
        </Button>
      </PageHeader>

      {/* Filters */}
      <div className="print-hidden">
        <FilterBar
          activeCount={[searchInput, scope !== 'all' ? scope : ''].filter(Boolean).length}
          search={
            <SearchInput
              value={searchInput}
              onChange={setSearchInput}
              placeholder="Search client, worker, iqama, project…"
              className="sm:w-[260px]"
            />
          }
        >
          <FilterSelect
            key="month"
            value={month}
            onChange={(v) => {
              setMonth(v)
              setExpanded(null)
            }}
            options={MONTH_OPTIONS}
            placeholder="Month"
            allowEmpty={false}
            className="sm:w-[150px]"
          />
          <FilterSelect
            key="year"
            value={year}
            onChange={(v) => {
              setYear(v)
              setExpanded(null)
            }}
            options={YEAR_OPTIONS}
            placeholder="Year"
            allowEmpty={false}
            className="sm:w-[110px]"
          />
          <FilterSelect
            key="scope"
            value={scope}
            onChange={setScope}
            placeholder="Staff scope"
            emptyLabel="Active staff only"
            options={STAFF_SCOPE_OPTIONS}
            className="sm:w-[210px]"
          />
        </FilterBar>
      </div>

      {/* Printable report content */}
      <div className="print-area print-landscape space-y-6">
        {/* Print-only report heading (company + period) */}
        <div className="hidden print:block">
          <h1 className="text-lg font-bold uppercase tracking-wide">{settings.companyName}</h1>
          <p className="mt-0.5 text-sm font-semibold">
            Client Salary Summary — Manpower Billing · {periodLabel}
          </p>
          <p className="text-[11px] text-neutral-600">
            Staff scope: {scopeLabel} · Clients: {cards?.totalClients ?? 0} · Deployed workers:{' '}
            {cards?.totalWorkers ?? 0} · Billed (excl. VAT): {money(cards?.billedAmount ?? 0)} ·
            Grand total (incl. {vatPercent}% VAT): {money(cards?.grandTotal ?? 0)}
          </p>
        </div>

        {/* Top stat cards */}
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[108px] animate-pulse rounded-xl border bg-muted/40"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        ) : cards ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Client Companies"
              value={String(cards.totalClients)}
              icon={Building2}
              tone="navy"
              sublabel="Clients with deployed manpower"
            />
            <StatCard
              title="Deployed Workers"
              value={String(cards.totalWorkers)}
              icon={Users}
              tone="teal"
              sublabel={`Distinct staff working at clients`}
            />
            <StatCard
              title={`Billed Amount — ${periodLabel}`}
              value={formatNumber(cards.billedAmount)}
              valuePrefix={settings.currency}
              icon={Wallet}
              tone="violet"
              sublabel={`${fmtHours(cards.billedHours)} hours × client rate (excl. VAT)`}
            />
            <StatCard
              title="Grand Total (incl. VAT)"
              value={formatNumber(cards.grandTotal)}
              valuePrefix={settings.currency}
              icon={BadgeDollarSign}
              tone="gold"
              sublabel={`incl. ${money(cards.vatAmount)} VAT (${vatPercent}%)`}
            />
          </div>
        ) : null}

        {/* Bench + multi-client + rate-fallback context notes */}
        {!loading && cards && (cards.benchWorkers > 0 || cards.multiClientWorkers > 0) ? (
          <div className="space-y-1.5 rounded-xl border border-dashed bg-muted/30 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground print:px-2">
            {cards.benchWorkers > 0 && (
              <p className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="font-semibold text-foreground">{cards.benchWorkers}</span> active staff are
                  not deployed to any project (bench) —{' '}
                  <span className="font-semibold text-foreground">{money(cards.benchSalary)}</span>/month is
                  not included in the client totals.
                </span>
              </p>
            )}
            {cards.multiClientWorkers > 0 && (
              <p className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="font-semibold text-foreground">{cards.multiClientWorkers}</span> workers are
                  deployed under more than one client and appear in each client&apos;s list; the cards above
                  count them once.
                </span>
              </p>
            )}
          </div>
        ) : null}

        {!loading && fallbackProjects.length > 0 ? (
          <div className="print-hidden flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              <span className="font-semibold">
                {fallbackProjects.length} project{fallbackProjects.length === 1 ? '' : 's'}
              </span>{' '}
              ({fallbackProjects.join(', ')}) ha{fallbackProjects.length === 1 ? 's' : 've'} no client
              rate set — those hours are billed at each worker&apos;s own payroll rate.
              {canEditRate
                ? ' Set the client rate (✎) inside a client group, or in Project Management, to bill the agreed company price.'
                : ' Ask an admin/accountant to set the client rate in Project Management.'}
            </span>
          </div>
        ) : null}

        {/* Client-wise billing breakdown */}
        <SectionCard>
          <div className="border-b px-4 py-3 sm:px-6">
            <h2 className="text-sm font-semibold">Client-wise Billing Breakdown</h2>
            <p className="text-xs text-muted-foreground">
              {periodLabel} · sorted by grand total — expand a client to see every worker&apos;s hours,
              rate and amount, then print or download that company&apos;s summary
            </p>
          </div>

          {loading ? (
            <TableSkeleton rows={5} cols={7} />
          ) : groups.length === 0 ? (
            <EmptyState
              icon={FileBarChart}
              title={search ? 'No matches for the current search' : 'No deployed workers found'}
              description={
                search
                  ? 'Try a different client, worker, iqama or project name.'
                  : 'Assign workers to client projects (Worker Deployment) to see the client salary summary.'
              }
            />
          ) : (
            <>
              {/* Mobile: stacked expandable cards */}
              <ul className="space-y-3 p-4 sm:p-6 md:hidden print:hidden">
                {groups.map((g) => {
                  const key = groupKey(g)
                  const open = expanded === key
                  return (
                    <li key={key} className="rounded-xl border bg-card shadow-sm">
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        aria-expanded={open}
                        className="flex w-full items-start justify-between gap-3 p-3 text-left"
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate font-medium">
                            <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="truncate">{g.clientName}</span>
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {g.workerCount} workers · {fmtHours(g.hours)} h
                            {g.city ? ` · ${g.city}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold tabular-nums">{money(g.grandTotal)}</p>
                          <p className="text-[11px] text-muted-foreground">incl. {money(g.vatAmount)} VAT</p>
                        </div>
                        <ChevronRight
                          className={cn(
                            'mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                            open && 'rotate-90'
                          )}
                          aria-hidden
                        />
                      </button>
                      {open ? (
                        <div className="border-t px-3 py-2.5">
                          <ul className="divide-y">
                            {g.rows.map((r) => (
                              <li key={`${r.staffId}-${r.projectId}`} className="flex items-center justify-between gap-3 py-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{r.fullName}</p>
                                  <p className="truncate text-[11px] text-muted-foreground">
                                    {r.projectName} · {fmtHours(r.hours)} h × {formatNumber(r.clientRate)}
                                  </p>
                                </div>
                                <p className="shrink-0 text-sm font-semibold tabular-nums">
                                  {money(r.amount)}
                                </p>
                              </li>
                            ))}
                          </ul>
                          <div className="mt-2 space-y-1 border-t pt-2 text-xs">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Subtotal (excl. VAT)</span>
                              <span className="font-semibold tabular-nums">{money(g.billedAmount)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">VAT ({vatPercent}%)</span>
                              <span className="font-semibold tabular-nums">{money(g.vatAmount)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="font-bold">Grand Total</span>
                              <span className="font-bold tabular-nums">{money(g.grandTotal)}</span>
                            </div>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <Button size="sm" variant="outline" className="flex-1" onClick={() => setPrintGroup(g)}>
                              <Printer className="h-3.5 w-3.5" />
                              Print
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1" onClick={() => exportClientCsv(g)}>
                              <Download className="h-3.5 w-3.5" />
                              CSV
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
                {/* Totals card */}
                <li className="rounded-xl border bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Total — all clients</p>
                    <p className="text-sm font-bold tabular-nums">{money(totals.grand)}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {totals.workers} workers · {fmtHours(totals.hours)} hours · incl.{' '}
                    {money(totals.vat)} VAT
                  </p>
                </li>
              </ul>

              {/* Desktop: expandable table */}
              <div className="hidden overflow-x-auto md:block print:block print:overflow-visible">
                <Table className="print-fit-cells text-sm">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-9 w-10 px-3 print:px-1" aria-label="Expand" />
                      <TableHead className="h-9 min-w-[200px] px-4 print:min-w-0 print:px-2">Client Company</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">Workers</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">Hours</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">Subtotal (excl. VAT)</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">VAT ({vatPercent}%)</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">Grand Total</TableHead>
                      <TableHead className="h-9 min-w-[150px] px-4 print:min-w-0 print:px-2">Share %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groups.map((g) => {
                      const key = groupKey(g)
                      const open = expanded === key
                      return [
                        <TableRow
                          key={key}
                          className={cn('cursor-pointer transition-colors', open && 'bg-muted/40')}
                          onClick={() => toggle(key)}
                        >
                          <TableCell className="px-3 py-2.5 print:px-1">
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-label={`${open ? 'Collapse' : 'Expand'} ${g.clientName} workers`}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggle(key)
                              }}
                              className="rounded-md p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <ChevronRight
                                className={cn('h-4 w-4 transition-transform', open && 'rotate-90')}
                                aria-hidden
                              />
                            </button>
                          </TableCell>
                          <TableCell className="px-4 py-2.5 print:px-2">
                            <div className="flex items-center gap-2">
                              <Building2
                                className={cn(
                                  'h-4 w-4 shrink-0',
                                  g.clientId ? 'text-muted-foreground' : 'text-muted-foreground/60'
                                )}
                                aria-hidden
                              />
                              <div className="min-w-0">
                                <p className="flex flex-wrap items-center gap-2 font-medium">
                                  <span className="truncate print:whitespace-normal">{g.clientName}</span>
                                  {g.clientStatus === 'inactive' && (
                                    <StatusBadge kind="inactive" className="px-1.5 py-0 text-[10px]" />
                                  )}
                                </p>
                                <p className="truncate text-xs text-muted-foreground print:whitespace-normal">
                                  {[
                                    g.city,
                                    g.contactPerson ? `Attn: ${g.contactPerson}` : null,
                                    g.phone,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ') || '—'}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{g.workerCount}</TableCell>
                          <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{fmtHours(g.hours)}</TableCell>
                          <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">
                            {money(g.billedAmount)}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-right tabular-nums text-muted-foreground print:px-2">
                            {money(g.vatAmount)}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-right font-semibold tabular-nums print:px-2">
                            {money(g.grandTotal)}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 print:px-2">
                            <div className="flex items-center gap-2">
                              <Progress
                                value={g.share}
                                aria-label={`${g.clientName} share of grand total billing`}
                                className="h-2 w-16 sm:w-24"
                              />
                              <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                                {formatNumber(g.share)}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>,
                        <TableRow
                          key={`${key}-detail`}
                          className={cn('bg-muted/20 hover:bg-muted/20', open ? '' : 'hidden print:table-row')}
                        >
                          <TableCell colSpan={8} className="px-4 py-3 sm:px-8 print:px-4">
                            <div className="rounded-lg border bg-background">
                              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-3 py-2">
                                <p className="text-xs font-semibold">
                                  Workers deployed at {g.clientName}
                                  <span className="ml-2 font-normal text-muted-foreground">
                                    {g.workerCount} worker{g.workerCount === 1 ? '' : 's'} ·{' '}
                                    {g.workersWithHours} with hours this month
                                  </span>
                                </p>
                                <div className="print-hidden flex items-center gap-2">
                                  <Button size="sm" variant="outline" onClick={() => setPrintGroup(g)}>
                                    <Printer className="h-3.5 w-3.5" />
                                    Print Summary
                                  </Button>
                                  <Button size="sm" variant="outline" onClick={() => exportClientCsv(g)}>
                                    <Download className="h-3.5 w-3.5" />
                                    CSV
                                  </Button>
                                </div>
                              </div>

                              {/* One section per project — each carries its own client rate */}
                              {bucketByProject(g.rows).map((p) => (
                                <div key={p.projectId} className="break-inside-avoid">
                                  <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/30 px-3 py-1.5">
                                    <p className="flex items-center gap-1.5 text-xs font-semibold">
                                      <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                                      {p.projectName}
                                      <span className="font-normal text-muted-foreground">
                                        · {p.rows.length} worker{p.rows.length === 1 ? '' : 's'} ·{' '}
                                        {fmtHours(p.hours)} h
                                      </span>
                                    </p>
                                    <p className="flex items-center gap-2">
                                      {canEditRate ? (
                                        <span className="print-hidden">
                                          <ProjectRateEditor
                                            projectId={p.projectId}
                                            rate={p.rate}
                                            currency={settings.currency}
                                            onSaved={() => void loadSummary()}
                                          />
                                        </span>
                                      ) : (
                                        <span className="text-xs font-semibold tabular-nums">
                                          {formatNumber(p.rate)} {settings.currency}/h
                                        </span>
                                      )}
                                      {p.rateSource === 'worker' && (
                                        <span className="print-hidden inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-medium text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
                                          worker rate fallback
                                        </span>
                                      )}
                                      <span className="text-xs font-bold tabular-nums">
                                        {money(p.subtotal)}
                                      </span>
                                    </p>
                                  </div>
                                  <div className="overflow-x-auto">
                                    <Table className="text-xs">
                                      <TableHeader>
                                        <TableRow className="hover:bg-transparent">
                                          <TableHead className="h-8 w-10 px-3 text-right">#</TableHead>
                                          <TableHead className="h-8 min-w-[170px] px-3 print:min-w-0">Worker</TableHead>
                                          <TableHead className="h-8 min-w-[110px] px-3 print:min-w-0">Position</TableHead>
                                          <TableHead className="h-8 min-w-[100px] px-3 print:min-w-0">Category</TableHead>
                                          <TableHead className="h-8 px-3 text-right">Hours</TableHead>
                                          <TableHead className="h-8 px-3 text-right">Rate / Hr</TableHead>
                                          <TableHead className="h-8 px-3 text-right">Amount</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {p.rows.map((r, i) => (
                                          <TableRow
                                            key={`${r.staffId}-${r.projectId}`}
                                            className={r.hours === 0 ? 'text-muted-foreground/70' : undefined}
                                          >
                                            <TableCell className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                              {i + 1}
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5">
                                              <p className="font-medium">{r.fullName}</p>
                                              <p className="text-[10px] text-muted-foreground">IQAMA {r.iqamaId}</p>
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5">{r.position ?? '—'}</TableCell>
                                            <TableCell className="px-3 py-1.5 text-muted-foreground">
                                              {r.categoryName ?? '—'}
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                                              {fmtHours(r.hours)}
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                                              {formatNumber(r.clientRate)}
                                              {r.rateSource === 'worker' ? (
                                                <span
                                                  className="ml-1 align-middle text-[9px] text-amber-600 dark:text-amber-400"
                                                  title="Using the worker's own rate — set this project's client rate"
                                                  aria-label="Worker rate fallback"
                                                >
                                                  ⚠
                                                </span>
                                              ) : null}
                                            </TableCell>
                                            <TableCell className="px-3 py-1.5 text-right font-semibold tabular-nums">
                                              {money(r.amount)}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              ))}

                              {/* Client totals */}
                              <div className="space-y-1 border-t px-3 py-2.5 text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">
                                    Subtotal — {g.workerCount} worker{g.workerCount === 1 ? '' : 's'} (excl. VAT)
                                  </span>
                                  <span className="font-semibold tabular-nums">{money(g.billedAmount)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">VAT ({vatPercent}%)</span>
                                  <span className="font-semibold tabular-nums">{money(g.vatAmount)}</span>
                                </div>
                                <div className="flex items-center justify-between border-t pt-1.5 text-sm">
                                  <span className="font-bold">Grand Total (incl. VAT)</span>
                                  <span className="font-bold tabular-nums">{money(g.grandTotal)}</span>
                                </div>
                                <p className="print-hidden pt-1 text-[11px] text-muted-foreground">
                                  Worker payroll cost (hours × worker rate): {money(g.workerCost)} ·
                                  Estimated margin before VAT:{' '}
                                  <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                                    {money(g.margin)}
                                  </span>
                                </p>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>,
                      ]
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                      <TableCell className="px-3 py-2.5 print:px-1" />
                      <TableCell className="px-4 py-2.5 print:px-2">Total</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{totals.workers}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{fmtHours(totals.hours)}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{money(totals.billed)}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{money(totals.vat)}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{money(totals.grand)}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">100%</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </>
          )}
        </SectionCard>

        {/* Print footer note */}
        <p className="hidden text-center text-[9px] text-neutral-400 print:block">
          Computer-generated summary — {settings.companyName} Workforce, Payroll &amp; Accounts System
        </p>
      </div>

      {/* Per-client printable billing statement */}
      <ClientSummaryPrintDialog
        open={printGroup !== null}
        onOpenChange={(o) => {
          if (!o) setPrintGroup(null)
        }}
        group={printGroup}
        month={Number(month)}
        year={Number(year)}
        vatRate={data?.vatRate ?? 0.15}
      />
    </div>
  )
}

// HMR bump
