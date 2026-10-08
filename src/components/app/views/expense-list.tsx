'use client'

// Expense List view — reuses the shared TransactionsListView
// implemented (and exported) in income-list.tsx.
import { TransactionsListView } from './income-list'

export function ExpenseListView() {
  return <TransactionsListView type="expense" viewKey="expense-list" />
}
