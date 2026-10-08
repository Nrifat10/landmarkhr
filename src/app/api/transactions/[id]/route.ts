// Transaction [id] API — PUT / DELETE
// Payroll-linked transactions cannot be edited or deleted here (409 → use Payroll module).
import { NextRequest } from 'next/server'
import type { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import type { TransactionRow, TransactionType } from '@/lib/types'
import {
  ok,
  badRequest,
  conflict,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  parseDate,
  logActivity,
} from '@/lib/api-helpers'

const PAYROLL_LINKED_MSG =
  'This transaction is linked to a payroll and must be managed from the Payroll module.'

const txInclude = {
  transactionCategory: { select: { id: true, name: true, type: true } },
  project: { select: { id: true, name: true } },
  operator: { select: { id: true, name: true } },
} satisfies Prisma.TransactionInclude

type TxWithRelations = Prisma.TransactionGetPayload<{ include: typeof txInclude }>

function mapTransaction(tx: TxWithRelations): TransactionRow {
  return {
    id: tx.id,
    type: tx.type as TransactionType,
    title: tx.title,
    amount: round2(tx.amount),
    transactionDate: tx.transactionDate.toISOString(),
    description: tx.description,
    category: {
      id: tx.transactionCategory.id,
      name: tx.transactionCategory.name,
      type: tx.transactionCategory.type as TransactionType,
    },
    project: tx.project ? { id: tx.project.id, name: tx.project.name } : null,
    operator: tx.operator ? { id: tx.operator.id, name: tx.operator.name } : null,
    payrollId: tx.payrollId,
  }
}

const transactionSchema = z.object({
  type: z.enum(['income', 'expense']),
  title: z.string().min(1, 'Title is required'),
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  transactionCategoryId: z.string().min(1, 'Category is required'),
  projectId: z.string().nullable().optional(),
  operatorUserId: z.string().nullable().optional(),
  transactionDate: z.string().min(1, 'Transaction date is required'),
  description: z.string().nullable().optional(),
})

type TransactionInput = z.infer<typeof transactionSchema>

type ValidatedTransaction = {
  type: TransactionType
  title: string
  amount: number
  transactionCategoryId: string
  projectId: string | null
  operatorUserId: string
  transactionDate: Date
  description: string | null
}

/** Shared body validation — returns clean values or an error response. */
async function validateTransactionBody(
  body: TransactionInput,
  sessionUserId: string
): Promise<ValidatedTransaction | NextResponse> {
  const title = body.title.trim()
  if (!title) return badRequest('Title is required')

  const category = await db.transactionCategory.findUnique({
    where: { id: body.transactionCategoryId },
  })
  if (!category) return badRequest('Selected category does not exist')
  if (category.type !== body.type) return badRequest('Category type mismatch')

  let projectId: string | null = null
  if (body.projectId) {
    const project = await db.project.findUnique({ where: { id: body.projectId } })
    if (!project) return badRequest('Selected project does not exist')
    projectId = body.projectId
  }

  let operatorUserId = sessionUserId
  if (body.operatorUserId) {
    const operator = await db.user.findUnique({ where: { id: body.operatorUserId } })
    if (!operator) return badRequest('Selected operator does not exist')
    operatorUserId = body.operatorUserId
  }

  const transactionDate = parseDate(body.transactionDate)
  if (!transactionDate) return badRequest('Invalid transaction date')

  return {
    type: body.type,
    title,
    amount: round2(body.amount),
    transactionCategoryId: body.transactionCategoryId,
    projectId,
    operatorUserId,
    transactionDate,
    description: body.description?.trim() || null,
  }
}

// GET /api/transactions/[id] — fetch a single transaction (accounts.view).
// Used by the command palette record search to deep-open a transaction in its list.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('accounts.view')
    if (isResponse(auth)) return auth

    const { id } = await params
    const tx = await db.transaction.findUnique({ where: { id }, include: txInclude })
    if (!tx) return notFound('Transaction not found')
    return ok(mapTransaction(tx))
  } catch {
    return serverError()
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('accounts.edit')
    if (isResponse(auth)) return auth

    const { id } = await params
    const existing = await db.transaction.findUnique({ where: { id } })
    if (!existing) return notFound('Transaction not found')
    if (existing.payrollId) return conflict(PAYROLL_LINKED_MSG)

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = transactionSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    // any payrollId in the body is intentionally ignored (payroll module owns that link)

    const values = await validateTransactionBody(parsed.data, auth.id)
    if (isResponse(values)) return values

    const updated = await db.transaction.update({
      where: { id },
      data: values,
      include: txInclude,
    })
    await logActivity({
      user: auth,
      action: 'updated',
      module: 'transaction',
      description: `${values.type === 'income' ? 'Income' : 'Expense'}: ${values.title}`,
      amount: values.amount,
    })
    return ok(mapTransaction(updated))
  } catch {
    return serverError()
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requirePermission('accounts.delete')
    if (isResponse(auth)) return auth

    const { id } = await params
    const existing = await db.transaction.findUnique({ where: { id } })
    if (!existing) return notFound('Transaction not found')
    if (existing.payrollId) return conflict(PAYROLL_LINKED_MSG)

    await db.transaction.delete({ where: { id } })
    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'transaction',
      description: `${existing.type === 'income' ? 'Income' : 'Expense'}: ${existing.title}`,
      amount: round2(existing.amount),
    })
    return ok({ success: true })
  } catch {
    return serverError()
  }
}
