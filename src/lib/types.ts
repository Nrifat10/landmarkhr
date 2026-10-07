// Shared TypeScript types for Landmark Inter Gulf system
// Used by both API routes and frontend components

export type Role = {
  id: string
  name: string
  description: string | null
  permissions: string[]
  userCount?: number
  createdAt?: string
}

export type SessionUser = {
  id: string
  name: string
  email: string
  avatar: string | null
  role: { id: string; name: string; permissions: string[] } | null
}

export type ProjectStatus = 'active' | 'inactive' | 'completed'

export type ProjectRow = {
  id: string
  name: string
  managerName: string
  location: string | null
  status: ProjectStatus
  clientId: string | null
  clientName: string | null
  createdAt: string
  staffCount: number
  /** Total linked income transactions (0 when none) */
  income: number
  /** Total linked expense transactions (0 when none) */
  expense: number
  /** income - expense */
  netProfit: number
}

export type Project = ProjectRow & {
  staff?: StaffRow[]
}

/** GET /api/projects/[id]/financials — profitability breakdown */
export type ProjectFinancials = {
  projectId: string
  income: number
  expense: number
  netProfit: number
  /** netProfit / income * 100, null when income is 0 */
  margin: number | null
  transactionCount: number
  /** Sum of expenses linked to payroll payouts (salary disbursements) */
  payrollExpense: number
  /** Last 6 months with any transaction (label e.g. "Apr '26") */
  monthly: { month: string; income: number; expense: number }[]
  /** Top expense categories by amount (max 5) */
  topExpenseCategories: { name: string; amount: number }[]
  /** Most recent transactions (max 8) */
  recentTransactions: {
    id: string
    title: string
    type: TransactionType
    amount: number
    date: string
    category: string | null
    linkedPayroll: boolean
  }[]
}

export type ClientStatus = 'active' | 'inactive'

/** Client company row (GET /api/projects uses the same shape for embedded client info) */
export type ClientRow = {
  id: string
  name: string
  contactPerson: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  crNumber: string | null
  status: ClientStatus
  notes: string | null
  createdAt: string
  projectCount: number
  /** Distinct staff deployed across all of this client's projects */
  deployedWorkers: number
}

/** GET /api/clients/[id] — full client detail with per-project staff */
export type Client = ClientRow & {
  projects: {
    id: string
    name: string
    status: ProjectStatus
    location: string | null
    managerName: string
    staffCount: number
    income: number
    expense: number
  }[]
  /** Distinct workers deployed across all projects (same list, flat) */
  workers: DeployedWorker[]
}

/** A worker entry inside a deployment listing */
export type DeployedWorker = {
  id: string
  fullName: string
  position: string | null
  iqamaId: string
  status: StaffStatus
  profilePhoto: string | null
  ratePerHour: number
  monthlySalary: number
  categoryName: string | null
  projectId: string | null
  projectName: string | null
  clientId: string | null
  clientName: string | null
}

/** Deployment KPI totals returned by /api/deployments (flat mode) */
export type DeploymentTotals = {
  assignments: number
  distinctWorkers: number
  unassignedActive: number
  clientCount: number
}

/** GET /api/deployments?mode=grouped — per-client grouping with workers */
export type ClientDeploymentGroup = {
  client: {
    id: string
    name: string
    city: string | null
    status: ClientStatus
    contactPerson: string | null
    phone: string | null
  }
  totalWorkers: number
  activeProjects: number
  projects: {
    id: string
    name: string
    status: ProjectStatus
    location: string | null
    workers: DeployedWorker[]
  }[]
}

export type StaffCategory = {
  id: string
  name: string
  description: string | null
  staffCount?: number
}

/** Worker entry inside a client salary group (deduped per client) */
export type ClientSalaryWorker = {
  id: string
  fullName: string
  position: string | null
  iqamaId: string
  categoryName: string | null
  projectNames: string[]
  ratePerHour: number
  monthlySalary: number
  status: StaffStatus
}

/** One client company's original-salary roll-up (GET /api/clients/salary-summary) */
export type ClientSalaryGroup = {
  clientId: string | null
  clientName: string
  city: string | null
  contactPerson: string | null
  phone: string | null
  clientStatus: ClientStatus
  projectCount: number
  workers: ClientSalaryWorker[]
  workerCount: number
  totalMonthlySalary: number
  avgMonthlySalary: number
  /** Share of the sum of all group totals (workers on 2 clients count in both) */
  share: number
}

export type ClientSalarySummaryData = {
  cards: {
    totalClients: number
    /** Distinct deployed workers (a worker on 2 clients counts once) */
    totalWorkers: number
    /** Σ monthlySalary of distinct deployed workers */
    totalMonthlySalary: number
    avgMonthlySalary: number
    /** Active staff with no project assignment at all */
    benchWorkers: number
    benchSalary: number
    /** Workers deployed under 2+ different clients */
    multiClientWorkers: number
  }
  groups: ClientSalaryGroup[]
}

export type StaffStatus = 'active' | 'inactive'

/** GET /api/staff/[id]/profile — employment & pay summary for the staff dialog */
export type StaffProfileStats = {
  staffId: string
  /** null when the caller lacks payroll.view */
  payroll: {
    totalNetPaid: number
    pendingCount: number
    totalEntries: number
    /** Newest first, max 6 */
    recent: {
      id: string
      month: number
      year: number
      netPay: number
      status: PayrollStatus
      project: string | null
    }[]
  } | null
  /** null when the caller lacks attendance.view */
  attendance: {
    monthMinutes: number
    totalSessions: number
    avgHoursPerSession: number | null
  } | null
  monthsEmployed: number | null
}

export type StaffRow = {
  id: string
  fullName: string
  phone: string | null
  position: string | null
  iqamaId: string
  iqamaExpiry: string | null
  passportExpiry: string | null
  joiningDate: string | null
  ratePerHour: number
  overtimeRate: number
  monthlySalary: number
  profilePhoto: string | null
  residentialAddress: string | null
  status: StaffStatus
  staffCategory: { id: string; name: string } | null
  projects: { id: string; name: string }[]
}

export type AttendanceRow = {
  id: string
  staff: { id: string; fullName: string; iqamaId: string }
  project: { id: string; name: string } | null
  checkIn: string
  checkOut: string | null
  durationMinutes: number | null
}

export type PayrollStatus = 'pending' | 'paid'
export type PayType = 'bank_transfer' | 'cash' | 'cheque'
export type DeductionType = 'fixed' | 'percent'

export type PayrollRow = {
  id: string
  month: number
  year: number
  totalHours: number
  hourlyRateSnapshot: number
  overtimeHours: number
  overtimeRateSnapshot: number
  otherEarnings: number
  advance: number
  absentPenalty: number
  ptAmount: number
  unionFees: number
  otherDeductionValue: number
  otherDeductionType: DeductionType
  grossPay: number
  totalDeductions: number
  netPay: number
  status: PayrollStatus
  payDate: string | null
  payType: PayType
  taxCode: string | null
  staff: { id: string; fullName: string; iqamaId: string; staffCategory: { id: string; name: string } | null }
  project: { id: string; name: string; clientName: string | null } | null
}

export type PayrollInput = {
  staffId: string
  projectId?: string | null
  month: number
  year: number
  totalHours: number
  hourlyRate: number
  overtimeHours: number
  overtimeRate: number
  otherEarnings: number
  advance: number
  absentPenalty: number
  ptAmount: number
  unionFees: number
  otherDeductionValue: number
  otherDeductionType: DeductionType
  status: PayrollStatus
  payDate?: string | null
  payType: PayType
  taxCode?: string | null
}

export type TransactionType = 'income' | 'expense'

// ---------------------------------------------------------------------------
// Worker advances
// ---------------------------------------------------------------------------

export type AdvanceStatus = 'pending' | 'partially_deducted' | 'deducted'
export type AdvancePaymentMethod = 'cash' | 'bank_transfer'

/** Advance row (GET /api/advances) — remaining is derived client-side. */
export type AdvanceRow = {
  id: string
  amount: number
  givenDate: string
  paymentMethod: AdvancePaymentMethod
  reference: string | null
  deductionMonth: number
  deductionYear: number
  installments: number
  deductedAmount: number
  status: AdvanceStatus
  createdAt: string
  /** true when a finalized (paid) payroll already deducted from it → edit/delete blocked */
  locked?: boolean
  staff: { id: string; fullName: string; iqamaId: string; position?: string | null }
}

export type AdvanceListTotals = {
  count: number
  given: number
  deducted: number
  outstanding: number
}

/** GET /api/advances/summary — header cards + monthly given totals */
export type AdvanceSummaryData = {
  totals: AdvanceListTotals & { workers: number; pendingCount: number }
  monthly: { label: string; month: number; year: number; given: number; count: number }[]
}

/** GET /api/advances/ledger?staffId — per-worker advance ledger */
export type AdvanceLedgerData = {
  staff: {
    id: string
    fullName: string
    iqamaId: string
    position: string | null
    monthlySalary: number
    status: StaffStatus
  }
  advances: AdvanceRow[]
  deductions: {
    id: string
    advanceId: string
    amount: number
    month: number
    year: number
    payrollStatus: PayrollStatus
    recovered: boolean
    createdAt: string
  }[]
  totals: { given: number; deducted: number; outstanding: number }
}

/** GET /api/advances/payroll-preview — what the auto-deduction would apply */
export type AdvancePayrollPreview = {
  items: {
    advanceId: string
    reference: string
    scheduled: number
    remaining: number
    installmentNo: number
    installments: number
  }[]
  total: number
}

/** GET /api/advances/stale-payrolls — payrolls whose advance column is out of date */
export type AdvanceStalePayroll = {
  payrollId: string
  staffName: string
  month: number
  year: number
  stored: number
  expected: number
}

export type TransactionCategoryRow = {
  id: string
  name: string
  type: TransactionType
  transactionCount?: number
}

export type TransactionRow = {
  id: string
  type: TransactionType
  title: string
  amount: number
  transactionDate: string
  description: string | null
  category: { id: string; name: string; type: TransactionType }
  project: { id: string; name: string } | null
  operator: { id: string; name: string } | null
  payrollId: string | null
}

export type UserRow = {
  id: string
  name: string
  email: string
  avatar: string | null
  isActive: boolean
  createdAt: string
  role: { id: string; name: string } | null
}

export type AppSettings = {
  companyName: string
  address: string
  phone: string
  email: string
  logo: string | null
  currency: string
  defaultPayType: PayType
  authorizedSignatory: string
  signatoryTitle: string
}

export type ActivityRow = {
  id: string
  userName: string | null
  action: string
  module: string
  description: string
  amount: number | null
  createdAt: string
}

export type DashboardData = {
  stats: {
    totalStaff: number
    totalUsers: number
    totalIncome: number
    totalExpense: number
    netBalance: number
    salaryPaid: number
    /** Outstanding worker-advance balance (null without advances.view) */
    advanceOutstanding: number | null
  }
  payrollStatus: {
    month: string
    pendingCount: number
    paidCount: number
    pendingAmount: number
    paidAmount: number
    pending: { id: string; staffId: string; staffName: string; netPay: number }[]
  } | null
  chart: { month: string; income: number; expense: number }[]
  recentActivity: ActivityRow[]
  /** IQAMA document compliance alerts (null when the caller lacks staff.view) */
  documentAlerts: {
    expired: DocumentAlert[]
    expiring: DocumentAlert[]
  } | null
  /** Client deployment overview (null when the caller lacks clients.view) */
  clientDeployment: {
    clientCount: number
    activeClients: number
    deployedWorkers: number
    topClients: { id: string; name: string; city: string | null; workers: number }[]
  } | null
}

export type DocumentAlert = {
  staffId: string
  fullName: string
  iqamaId: string
  iqamaExpiry: string
  /** whole days from today (negative = already expired) */
  daysLeft: number
}

export type SheetTotals = {
  count: number
  gross: number
  deductions: number
  net: number
}

export type SheetRow = PayrollRow & {
  basicPay: number
  otPay: number
  penaltyPt: number
  unionOther: number
}

export type CategoryBreakdown = {
  categoryId: string | null
  name: string
  manpower: number
  totalHours: number
  grossPay: number
  deductions: number
  totalAmount: number
}

export type Paginated<T> = {
  data: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  totals?: Record<string, number>
}

/** Global record search results (command palette) */
export type PaletteSearchResults = {
  staff: {
    id: string
    fullName: string
    iqamaId: string
    position: string | null
    status: string
  }[]
  projects: {
    id: string
    name: string
    managerName: string | null
    location: string | null
    status: string
  }[]
  transactions: {
    id: string
    type: 'income' | 'expense'
    title: string
    amount: number
    transactionDate: string
    categoryName: string
  }[]
  payrolls: {
    id: string
    staffId: string
    staffName: string
    month: number
    year: number
    netPay: number
    status: 'pending' | 'paid'
  }[]
  clients: {
    id: string
    name: string
    city: string | null
    contactPerson: string | null
    status: string
  }[]
}

/** Monthly attendance KPIs (attendance view header) */
export type AttendanceStats = {
  month: number
  year: number
  label: string
  totalSessions: number
  openSessions: number
  totalMinutes: number
  totalHours: number
  distinctStaff: number
  avgSessionMinutes: number
}

export type ViewKey =
  | 'dashboard'
  | 'projects'
  | 'clients'
  | 'deployments'
  | 'staff-list'
  | 'staff-categories'
  | 'attendance'
  | 'payroll'
  | 'advances'
  | 'salary-sheet'
  | 'salary-summary'
  | 'client-salary-summary'
  | 'income-list'
  | 'expense-list'
  | 'accounts-summary'
  | 'transaction-categories'
  | 'roles'
  | 'users'
  | 'settings'
  | 'activity-log'

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export const PAY_TYPE_LABELS: Record<PayType, string> = {
  bank_transfer: 'Bank Transfer',
  cash: 'Cash',
  cheque: 'Cheque',
}
