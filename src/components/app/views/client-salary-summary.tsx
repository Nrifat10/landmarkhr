'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeDollarSign,
  Building2,
  ChevronRight,
  Download,
  FileBarChart,
  Info,
  Printer,
  Users,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { PageHeader, SectionCard } from '@/components/app/shared/page-header'
import { StatCard } from '@/components/app/shared/stat-card'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { StatusBadge } from '@/components/app/shared/status-badge'
import { printWithPageRule } from '@/components/app/print/print-page-rule'
import { useDebounce } from '@/hooks/use-debounce'
import { api, qs } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatMoney, formatNumber, round2 } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { ClientSalaryGroup, ClientSalarySummaryData } from '@/lib/types'

const STAFF_SCOPE_OPTIONS = [
  // NOTE: the FilterSelect built-in empty item (value "all") IS the default
  // "Active staff only" — so only the non-default option is listed here.
  { value: 'include-inactive', label: 'All staff (incl. inactive)' },
]

/** Stable key for a group (null clientId = the "No Client" bucket) */
function groupKey(g: ClientSalaryGroup): string {
  return g.clientId ?? '_noclient'
}

export function ClientSalarySummaryView() {
  const settings = useAppStore((s) => s.settings)

  const [searchInput, setSearchInput] = useState('')
  const search = useDebounce(searchInput, 350)
  // 'all' = the select's built-in empty item → Active staff only (default)
  const [scope, setScope] = useState('all')

  const [data, setData] = useState<ClientSalarySummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const money = useCallback((n: number) => formatMoney(n, settings.currency), [settings.currency])

  const loadSummary = useCallback(async () => {
    setLoading(true)
    try {
      const query = qs({
        search: search || undefined,
        includeInactive: scope === 'include-inactive' ? 'true' : undefined,
      })
      const res = await api.get<ClientSalarySummaryData>(`/api/clients/salary-summary${query}`)
      setData(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load client salary summary')
    } finally {
      setLoading(false)
    }
  }, [search, scope])

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
        salary: round2(acc.salary + g.totalMonthlySalary),
      }),
      { workers: 0, projects: 0, salary: 0 }
    )
  }, [groups])

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => (prev === key ? null : key))
  }, [])

  const exportCsv = useCallback(() => {
    if (!data) return
    const headers = [
      'Client Company',
      'City',
      'Worker',
      'Iqama ID',
      'Position',
      'Category',
      'Project(s)',
      'Rate/Hr',
      'Original Monthly Salary',
    ]
    const rows: (string | number | null | undefined)[][] = groups.flatMap((g) =>
      g.workers.map((w) => [
        g.clientName,
        g.city,
        w.fullName,
        w.iqamaId,
        w.position,
        w.categoryName,
        w.projectNames.join(' + '),
        w.ratePerHour,
        w.monthlySalary,
      ])
    )
    rows.push(['TOTAL — distinct workers', '', '', '', '', '', '', '', data.cards.totalMonthlySalary])
    downloadCsv(csvFilename('client-salary-summary'), buildCsv(headers, rows))
    toast.success('Client salary summary exported')
  }, [data, groups])

  const scopeLabel = scope === 'include-inactive' ? 'All staff (incl. inactive)' : 'Active staff only'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Client Salary Summary"
        description="Original monthly salary of deployed manpower, grouped by client company"
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
        <FilterBar activeCount={[searchInput, scope !== 'all' ? scope : ''].filter(Boolean).length}>
          <SearchInput
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Search client, worker, iqama, project…"
            className="sm:w-[280px]"
          />
          <FilterSelect
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
        {/* Print-only report heading (company + scope) */}
        <div className="hidden print:block">
          <h1 className="text-lg font-bold uppercase tracking-wide">{settings.companyName}</h1>
          <p className="mt-0.5 text-sm font-semibold">
            Client Salary Summary — Original Monthly Salary by Client Company
          </p>
          <p className="text-[11px] text-neutral-600">
            Staff scope: {scopeLabel} · Clients: {cards?.totalClients ?? 0} · Deployed workers:{' '}
            {cards?.totalWorkers ?? 0} · Original salary: {money(cards?.totalMonthlySalary ?? 0)}/month
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
              tone="blue"
              sublabel="Clients with deployed manpower"
            />
            <StatCard
              title="Deployed Workers"
              value={String(cards.totalWorkers)}
              icon={Users}
              tone="teal"
              sublabel="Distinct staff working at clients"
            />
            <StatCard
              title="Original Salary / Month"
              value={formatNumber(cards.totalMonthlySalary)}
              valuePrefix={settings.currency}
              icon={Wallet}
              tone="violet"
              sublabel="Sum of workers' base monthly salary"
            />
            <StatCard
              title="Average per Worker"
              value={formatNumber(cards.avgMonthlySalary)}
              valuePrefix={settings.currency}
              icon={BadgeDollarSign}
              tone="green"
              sublabel="Original salary ÷ deployed workers"
            />
          </div>
        ) : null}

        {/* Bench + multi-client context notes */}
        {!loading && cards && (cards.benchWorkers > 0 || cards.multiClientWorkers > 0) ? (
          <div className="space-y-1.5 rounded-xl border border-dashed bg-muted/30 px-4 py-2.5 print:px-2 text-xs leading-relaxed text-muted-foreground">
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

        {/* Client-wise original salary breakdown */}
        <SectionCard>
          <div className="border-b px-4 py-3 sm:px-6">
            <h2 className="text-sm font-semibold">Client-wise Original Salary Breakdown</h2>
            <p className="text-xs text-muted-foreground">
              Sorted by monthly salary volume — expand a client to see every worker&apos;s original price
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
                            {g.workerCount} workers · {g.projectCount} project{g.projectCount === 1 ? '' : 's'}
                            {g.city ? ` · ${g.city}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-bold tabular-nums">{money(g.totalMonthlySalary)}</p>
                          <p className="text-[11px] text-muted-foreground">avg {money(g.avgMonthlySalary)}</p>
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
                        <div className="border-t px-3 py-2.5 print:px-1">
                          <ul className="divide-y">
                            {g.workers.map((w) => (
                              <li key={w.id} className="flex items-center justify-between gap-3 py-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{w.fullName}</p>
                                  <p className="truncate text-[11px] text-muted-foreground">
                                    {w.position ?? '—'} · {w.projectNames.join(' + ')}
                                  </p>
                                </div>
                                <p className="shrink-0 text-sm font-semibold tabular-nums">
                                  {money(w.monthlySalary)}
                                </p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
                {/* Totals card */}
                <li className="rounded-xl border bg-muted/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Total — all clients</p>
                    <p className="text-sm font-bold tabular-nums">{money(totals.salary)}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {totals.workers} workers across {groups.length} group{groups.length === 1 ? '' : 's'}
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
                      <TableHead className="h-9 px-4 text-right print:px-2">Projects</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">Workers</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">Original Salary / Month</TableHead>
                      <TableHead className="h-9 px-4 text-right print:px-2">Avg / Worker</TableHead>
                      <TableHead className="h-9 min-w-[160px] px-4 print:min-w-0 print:px-2">Share %</TableHead>
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
                          <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{g.projectCount}</TableCell>
                          <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{g.workerCount}</TableCell>
                          <TableCell className="px-4 py-2.5 text-right font-semibold tabular-nums print:px-2">
                            {money(g.totalMonthlySalary)}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 text-right tabular-nums text-muted-foreground print:px-2">
                            {money(g.avgMonthlySalary)}
                          </TableCell>
                          <TableCell className="px-4 py-2.5 print:px-2">
                            <div className="flex items-center gap-2">
                              <Progress
                                value={g.share}
                                aria-label={`${g.clientName} share of original salary`}
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
                          <TableCell colSpan={7} className="px-4 py-3 sm:px-8 print:px-4">
                            <div className="rounded-lg border bg-background">
                              <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                                <p className="text-xs font-semibold">
                                  Workers deployed at {g.clientName}
                                  <span className="ml-2 font-normal text-muted-foreground">
                                    {g.workerCount} worker{g.workerCount === 1 ? '' : 's'}
                                  </span>
                                </p>
                                <p className="text-xs font-semibold tabular-nums">
                                  Subtotal:{' '}
                                  <span className="text-emerald-700 dark:text-emerald-400">
                                    {money(g.totalMonthlySalary)}
                                  </span>
                                </p>
                              </div>
                              <div className="overflow-x-auto">
                                <Table className="text-xs">
                                  <TableHeader>
                                    <TableRow className="hover:bg-transparent">
                                      <TableHead className="h-8 w-10 px-3 text-right">#</TableHead>
                                      <TableHead className="h-8 min-w-[170px] px-3 print:min-w-0">Worker</TableHead>
                                      <TableHead className="h-8 min-w-[120px] px-3 print:min-w-0">Position</TableHead>
                                      <TableHead className="h-8 min-w-[110px] px-3 print:min-w-0">Category</TableHead>
                                      <TableHead className="h-8 min-w-[150px] px-3 print:min-w-0">Project(s)</TableHead>
                                      <TableHead className="h-8 px-3 text-right">Rate / Hr</TableHead>
                                      <TableHead className="h-8 px-3 text-right">Original Salary</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {g.workers.map((w, i) => (
                                      <TableRow key={w.id}>
                                        <TableCell className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                                          {i + 1}
                                        </TableCell>
                                        <TableCell className="px-3 py-1.5">
                                          <p className="font-medium">{w.fullName}</p>
                                          <p className="text-[10px] text-muted-foreground">IQAMA {w.iqamaId}</p>
                                        </TableCell>
                                        <TableCell className="px-3 py-1.5">{w.position ?? '—'}</TableCell>
                                        <TableCell className="px-3 py-1.5 text-muted-foreground">
                                          {w.categoryName ?? '—'}
                                        </TableCell>
                                        <TableCell className="px-3 py-1.5">{w.projectNames.join(' + ')}</TableCell>
                                        <TableCell className="px-3 py-1.5 text-right tabular-nums">
                                          {formatNumber(w.ratePerHour)}
                                        </TableCell>
                                        <TableCell className="px-3 py-1.5 text-right font-semibold tabular-nums">
                                          {money(w.monthlySalary)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
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
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{totals.projects}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{totals.workers}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums print:px-2">{money(totals.salary)}</TableCell>
                      <TableCell className="px-4 py-2.5 text-right tabular-nums text-muted-foreground print:px-2">
                        {totals.workers > 0 ? money(round2(totals.salary / totals.workers)) : money(0)}
                      </TableCell>
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
    </div>
  )
}
