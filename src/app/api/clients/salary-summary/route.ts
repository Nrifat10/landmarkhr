// Client Salary Summary API — the ORIGINAL monthly salary (the price at which
// workers are supplied to each client company) of every deployed worker,
// grouped by client. One row per client with a deduped worker list, totals,
// average and share. Bench (unassigned) staff are reported in the cards only.
//   ?search — filter by client / worker / iqama / project / position / category
//   ?includeInactive=true — also count inactive staff (default: active only)
// Permission: payroll.view (salary figures are exposed).
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { ok, serverError, requirePermission, isResponse } from '@/lib/api-helpers'
import type { ClientSalaryGroup, ClientSalarySummaryData, ClientSalaryWorker } from '@/lib/types'

const NO_CLIENT = 'No Client (Unlinked Projects)'

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('payroll.view')
    if (isResponse(auth)) return auth

    const { searchParams } = new URL(req.url)
    const search = (searchParams.get('search') ?? '').trim().toLowerCase()
    const includeInactive = searchParams.get('includeInactive') === 'true'

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
            client: { select: { id: true, name: true, city: true, contactPerson: true, phone: true, status: true } },
          },
        },
      },
    })

    // Bench staff — active, not deleted, zero project assignments (cards context only)
    const bench = await db.staff.findMany({
      where: { deletedAt: null, status: 'active', projects: { none: {} } },
      select: { monthlySalary: true },
    })

    // ---- Group by client; dedupe workers inside each group ----
    const groups = new Map<
      string,
      {
        clientId: string | null
        clientName: string
        city: string | null
        contactPerson: string | null
        phone: string | null
        clientStatus: string
        projectIds: Set<string>
        workers: Map<string, ClientSalaryWorker>
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
          clientStatus: c?.status ?? 'active',
          projectIds: new Set<string>(),
          workers: new Map<string, ClientSalaryWorker>(),
        }
        groups.set(key, g)
      }
      g.projectIds.add(a.project.id)

      let w = g.workers.get(a.staff.id)
      if (!w) {
        w = {
          id: a.staff.id,
          fullName: a.staff.fullName,
          position: a.staff.position,
          iqamaId: a.staff.iqamaId,
          categoryName: a.staff.staffCategory?.name ?? null,
          projectNames: [a.project.name],
          ratePerHour: a.staff.ratePerHour,
          monthlySalary: a.staff.monthlySalary,
          status: a.staff.status as 'active' | 'inactive',
        }
        g.workers.set(a.staff.id, w)
      } else if (!w.projectNames.includes(a.project.name)) {
        // Same worker on another project of the SAME client — list both projects
        w.projectNames.push(a.project.name)
      }

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

    // ---- Build response groups (share = of Σ group totals) ----
    const built = Array.from(groups.values()).map((g) => {
      const workers = Array.from(g.workers.values())
      workers.sort((a, b) => a.fullName.localeCompare(b.fullName))
      const groupTotal = round2(workers.reduce((s, w) => s + w.monthlySalary, 0))
      return {
        clientId: g.clientId,
        clientName: g.clientName,
        city: g.city,
        contactPerson: g.contactPerson,
        phone: g.phone,
        clientStatus: g.clientStatus as 'active' | 'inactive',
        projectCount: g.projectIds.size,
        workers,
        workerCount: workers.length,
        totalMonthlySalary: groupTotal,
        avgMonthlySalary: workers.length > 0 ? round2(groupTotal / workers.length) : 0,
        share: 0, // filled after the denominator is known
      }
    })

    const denominator = built.reduce((s, g) => s + g.totalMonthlySalary, 0)
    for (const g of built) {
      g.share = denominator > 0 ? round2((100 * g.totalMonthlySalary) / denominator) : 0
    }

    // Sort: biggest payroll first; the "No Client" bucket always last
    built.sort((a, b) => {
      const aNone = a.clientId === null ? 1 : 0
      const bNone = b.clientId === null ? 1 : 0
      if (aNone !== bNone) return aNone - bNone
      if (aNone === 1) return a.workerCount - b.workerCount
      if (b.totalMonthlySalary !== a.totalMonthlySalary) return b.totalMonthlySalary - a.totalMonthlySalary
      return a.clientName.localeCompare(b.clientName)
    })

    // ---- Search filter (applied to groups/workers; cards stay global) ----
    let filtered = built
    if (search) {
      filtered = built
        .map((g) => {
          const clientHit = [g.clientName, g.city, g.contactPerson]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(search))
          if (clientHit) return g
          const workers = g.workers.filter((w) =>
            [w.fullName, w.iqamaId, w.position, w.categoryName, ...w.projectNames]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(search))
          )
          if (workers.length === 0) return null
          return { ...g, workers, workerCount: workers.length }
        })
        .filter((g): g is ClientSalaryGroup => g !== null)
    }

    const data: ClientSalarySummaryData = {
      cards: {
        totalClients: built.filter((g) => g.clientId !== null).length,
        totalWorkers,
        totalMonthlySalary: round2(totalMonthlySalary),
        avgMonthlySalary: totalWorkers > 0 ? round2(totalMonthlySalary / totalWorkers) : 0,
        benchWorkers: bench.length,
        benchSalary: round2(bench.reduce((s, b) => s + b.monthlySalary, 0)),
        multiClientWorkers,
      },
      groups: filtered,
    }

    return ok(data)
  } catch {
    return serverError()
  }
}
