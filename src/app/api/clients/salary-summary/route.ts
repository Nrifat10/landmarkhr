// Client Salary Summary API — monthly MANPOWER BILLING per client company.
// For the selected month, every deployed worker's attendance hours are billed
// at the project's client rate (the price we charge the client company, e.g.
// 20 SAR/hour) — distinct from the worker's own rate (the payroll salary rate,
// e.g. 15 SAR/hour). Each group carries subtotal + 15% VAT + grand total and a
// per-worker line list (hours, rate, amount) so every company's summary can be
// printed / downloaded separately. Bench (unassigned) staff stay in the cards.
//   ?month=&year=      — billing month (default: current)
//   ?search            — filter by client / worker / iqama / project / position / category
//   ?includeInactive=true — also count inactive staff (default: active only)
// Permission: payroll.view (salary figures are exposed).
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { ok, serverError, requirePermission, isResponse, toInt } from '@/lib/api-helpers'
import type {
  ClientBillingLine,
  ClientSalaryGroup,
  ClientSalarySummaryData,
} from '@/lib/types'

const NO_CLIENT = 'No Client (Unlinked Projects)'
/** Saudi standard VAT */
export const VAT_RATE = 0.15

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('payroll.view')
    if (isResponse(auth)) return auth

    const { searchParams } = new URL(req.url)
    const search = (searchParams.get('search') ?? '').trim().toLowerCase()
    const includeInactive = searchParams.get('includeInactive') === 'true'

    const now = new Date()
    const month = Math.min(12, Math.max(1, toInt(searchParams.get('month'), now.getMonth() + 1)))
    const year = Math.min(2200, Math.max(2000, toInt(searchParams.get('year'), now.getFullYear())))
    const start = new Date(year, month - 1, 1)
    const end = new Date(year, month, 1) // rolls over to the 1st of the next month

    // All deployments (active staff by default), with staff + category + project + client
    const assignments = await db.projectStaff.findMany({
      where: {
        staff: {
          deletedAt: null,
          ...(includeInactive ? {} : { status: 'active' }),
        },
      },
      include: {
        staff: {
          select: {
            id: true,
            fullName: true,
            position: true,
            iqamaId: true,
            status: true,
            ratePerHour: true,
            monthlySalary: true,
            staffCategory: { select: { name: true } },
          },
        },
        project: {
          select: {
            id: true,
            name: true,
            clientRatePerHour: true,
            client: {
              select: {
                id: true,
                name: true,
                city: true,
                contactPerson: true,
                phone: true,
                email: true,
                address: true,
                crNumber: true,
                status: true,
              },
            },
          },
        },
      },
    })

    // Attendance minutes per (staff × project) for the billing month
    const attendanceRows = await db.attendance.groupBy({
      by: ['staffId', 'projectId'],
      where: { checkIn: { gte: start, lt: end }, projectId: { not: null } },
      _sum: { durationMinutes: true },
    })
    const hoursMap = new Map<string, number>()
    for (const r of attendanceRows) {
      if (!r.projectId) continue
      hoursMap.set(`${r.staffId}|${r.projectId}`, round2((r._sum.durationMinutes ?? 0) / 60))
    }

    // Bench staff — active, not deleted, zero project assignments (cards context only)
    const bench = await db.staff.findMany({
      where: { deletedAt: null, status: 'active', projects: { none: {} } },
      select: { monthlySalary: true },
    })

    // ---- Group by client; one billing line per (worker × project) ----
    const groups = new Map<
      string,
      {
        clientId: string | null
        clientName: string
        city: string | null
        contactPerson: string | null
        phone: string | null
        email: string | null
        crNumber: string | null
        address: string | null
        clientStatus: string
        projectIds: Set<string>
        rows: ClientBillingLine[]
        workers: Map<string, { monthlySalary: number }>
      }
    >()
    // staffId → set of client keys (for distinct totals + multi-client count)
    const staffClients = new Map<string, { salary: number; clients: Set<string> }>()

    for (const a of assignments) {
      const c = a.project.client
      const key = c?.id ?? '_none'
      let g = groups.get(key)
      if (!g) {
        g = {
          clientId: c?.id ?? null,
          clientName: c?.name ?? NO_CLIENT,
          city: c?.city ?? null,
          contactPerson: c?.contactPerson ?? null,
          phone: c?.phone ?? null,
          email: c?.email ?? null,
          crNumber: c?.crNumber ?? null,
          address: c?.address ?? null,
          clientStatus: c?.status ?? 'active',
          projectIds: new Set<string>(),
          rows: [],
          workers: new Map(),
        }
        groups.set(key, g)
      }
      g.projectIds.add(a.project.id)
      g.workers.set(a.staff.id, { monthlySalary: a.staff.monthlySalary })

      const hours = hoursMap.get(`${a.staff.id}|${a.project.id}`) ?? 0
      // Billed rate: the project's negotiated client rate; when unset (0),
      // fall back to the worker's own hourly rate and flag the source.
      const hasProjectRate = a.project.clientRatePerHour > 0
      const clientRate = hasProjectRate ? a.project.clientRatePerHour : a.staff.ratePerHour
      g.rows.push({
        projectId: a.project.id,
        projectName: a.project.name,
        staffId: a.staff.id,
        fullName: a.staff.fullName,
        iqamaId: a.staff.iqamaId,
        position: a.staff.position,
        categoryName: a.staff.staffCategory?.name ?? null,
        hours,
        clientRate,
        rateSource: hasProjectRate ? 'project' : 'worker',
        amount: round2(hours * clientRate),
        workerRate: a.staff.ratePerHour,
        workerCost: round2(hours * a.staff.ratePerHour),
        monthlySalary: a.staff.monthlySalary,
        status: a.staff.status as 'active' | 'inactive',
      })

      let sc = staffClients.get(a.staff.id)
      if (!sc) {
        sc = { salary: a.staff.monthlySalary, clients: new Set<string>() }
        staffClients.set(a.staff.id, sc)
      }
      sc.clients.add(key)
    }

    // ---- Distinct-worker cards (a worker on 2 clients counts ONCE) ----
    let totalWorkers = 0
    let totalMonthlySalary = 0
    let multiClientWorkers = 0
    for (const sc of staffClients.values()) {
      totalWorkers += 1
      totalMonthlySalary += sc.salary
      if (sc.clients.size > 1) multiClientWorkers += 1
    }

    // ---- Build response groups with billing aggregates ----
    const built = Array.from(groups.values()).map((g) => {
      g.rows.sort(
        (a, b) =>
          a.projectName.localeCompare(b.projectName) || a.fullName.localeCompare(b.fullName)
      )
      const hours = round2(g.rows.reduce((s, r) => s + r.hours, 0))
      const billedAmount = round2(g.rows.reduce((s, r) => s + r.amount, 0))
      const vatAmount = round2(billedAmount * VAT_RATE)
      const workerCost = round2(g.rows.reduce((s, r) => s + r.workerCost, 0))
      const groupSalary = round2(
        Array.from(g.workers.values()).reduce((s, w) => s + w.monthlySalary, 0)
      )
      return {
        clientId: g.clientId,
        clientName: g.clientName,
        city: g.city,
        contactPerson: g.contactPerson,
        phone: g.phone,
        email: g.email,
        crNumber: g.crNumber,
        address: g.address,
        clientStatus: g.clientStatus as 'active' | 'inactive',
        projectCount: g.projectIds.size,
        workerCount: g.workers.size,
        workersWithHours: new Set(g.rows.filter((r) => r.hours > 0).map((r) => r.staffId)).size,
        rows: g.rows,
        hours,
        billedAmount,
        vatAmount,
        grandTotal: round2(billedAmount + vatAmount),
        workerCost,
        margin: round2(billedAmount - workerCost),
        totalMonthlySalary: groupSalary,
        avgMonthlySalary: g.workers.size > 0 ? round2(groupSalary / g.workers.size) : 0,
        share: 0, // filled after the denominator is known
      }
    })

    const denominator = built.reduce((s, g) => s + g.grandTotal, 0)
    for (const g of built) {
      g.share = denominator > 0 ? round2((100 * g.grandTotal) / denominator) : 0
    }

    // Sort: biggest billing first; the "No Client" bucket always last
    built.sort((a, b) => {
      const aNone = a.clientId === null ? 1 : 0
      const bNone = b.clientId === null ? 1 : 0
      if (aNone !== bNone) return aNone - bNone
      if (aNone === 1) return a.workerCount - b.workerCount
      if (b.grandTotal !== a.grandTotal) return b.grandTotal - a.grandTotal
      return a.clientName.localeCompare(b.clientName)
    })

    // ---- Search filter (applied to groups/rows; cards stay global) ----
    let filtered = built
    if (search) {
      filtered = built
        .map((g) => {
          const clientHit = [g.clientName, g.city, g.contactPerson]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(search))
          if (clientHit) return g
          const rows = g.rows.filter((r) =>
            [r.fullName, r.iqamaId, r.position, r.categoryName, r.projectName]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(search))
          )
          if (rows.length === 0) return null
          return { ...g, rows }
        })
        .filter((g): g is ClientSalaryGroup => g !== null)
    }

    // ---- Billing cards over ALL groups (not the search-filtered subset) ----
    const cardsBilling = built.reduce(
      (acc, g) => ({
        billedHours: round2(acc.billedHours + g.hours),
        billedAmount: round2(acc.billedAmount + g.billedAmount),
        vatAmount: round2(acc.vatAmount + g.vatAmount),
        grandTotal: round2(acc.grandTotal + g.grandTotal),
        workerCost: round2(acc.workerCost + g.workerCost),
        margin: round2(acc.margin + g.margin),
      }),
      { billedHours: 0, billedAmount: 0, vatAmount: 0, grandTotal: 0, workerCost: 0, margin: 0 }
    )

    const data: ClientSalarySummaryData = {
      month,
      year,
      vatRate: VAT_RATE,
      cards: {
        totalClients: built.filter((g) => g.clientId !== null).length,
        totalWorkers,
        totalMonthlySalary: round2(totalMonthlySalary),
        avgMonthlySalary: totalWorkers > 0 ? round2(totalMonthlySalary / totalWorkers) : 0,
        benchWorkers: bench.length,
        benchSalary: round2(bench.reduce((s, b) => s + b.monthlySalary, 0)),
        multiClientWorkers,
        ...cardsBilling,
      },
      groups: filtered,
    }

    return ok(data)
  } catch (err) {
    console.error('[api/clients/salary-summary GET]', err)
    return serverError()
  }
}
