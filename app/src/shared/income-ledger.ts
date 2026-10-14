import type {
  BusinessLedgerEntry,
  IncomeLedgerSummary,
  IncomeLedgerTotals,
  OtherIncomeRecord
} from './domain'

const emptyTotals = (): IncomeLedgerTotals => ({
  totalIncomeCents: 0,
  actualNetIncomeCents: 0,
  actualNetKnownCount: 0,
  actualNetEligibleCount: 0,
  expectedIncomeCents: 0,
  expectedNetKnownCount: 0,
  expectedNetEligibleCount: 0,
  receivedCents: 0,
  pendingCents: 0,
  recordCount: 0
})

export function calculateIncomeLedgerSummary(
  businessEntries: BusinessLedgerEntry[],
  otherEntries: OtherIncomeRecord[]
): IncomeLedgerSummary {
  const business = businessEntries.reduce((totals, entry) => {
    if (entry.trashedAt || entry.lifecycleStatus === 'canceled') return totals
    totals.expectedNetEligibleCount += 1
    if (entry.expectedIncomeCents != null) {
      totals.expectedIncomeCents += entry.expectedIncomeCents
      totals.expectedNetKnownCount += 1
    }
    totals.recordCount += 1
    if (entry.lifecycleStatus === 'agreed_pending_order') return totals
    const gross = entry.platformOrderAmountCents ?? 0
    totals.totalIncomeCents += gross
    if (entry.paymentStatus === 'received') {
      totals.receivedCents += gross
      totals.actualNetEligibleCount += 1
      if (entry.expectedIncomeCents != null) {
        totals.actualNetIncomeCents += entry.expectedIncomeCents
        totals.actualNetKnownCount += 1
      }
    }
    else totals.pendingCents += gross
    return totals
  }, emptyTotals())

  const other = otherEntries.reduce((totals, entry) => {
    if (entry.trashedAt || entry.status === 'canceled' || entry.currency !== 'CNY') return totals
    totals.totalIncomeCents += entry.amountCents
    totals.expectedIncomeCents += entry.expectedIncomeCents
    totals.expectedNetKnownCount += 1
    totals.expectedNetEligibleCount += 1
    if (entry.paymentStatus === 'received') {
      totals.receivedCents += entry.amountCents
      totals.actualNetIncomeCents += entry.expectedIncomeCents
      totals.actualNetKnownCount += 1
      totals.actualNetEligibleCount += 1
    }
    else totals.pendingCents += entry.amountCents
    totals.recordCount += 1
    return totals
  }, emptyTotals())

  return {
    business,
    other,
    combined: {
      totalIncomeCents: business.totalIncomeCents + other.totalIncomeCents,
      actualNetIncomeCents: business.actualNetIncomeCents + other.actualNetIncomeCents,
      actualNetKnownCount: business.actualNetKnownCount + other.actualNetKnownCount,
      actualNetEligibleCount: business.actualNetEligibleCount + other.actualNetEligibleCount,
      expectedIncomeCents: business.expectedIncomeCents + other.expectedIncomeCents,
      expectedNetKnownCount: business.expectedNetKnownCount + other.expectedNetKnownCount,
      expectedNetEligibleCount: business.expectedNetEligibleCount + other.expectedNetEligibleCount,
      receivedCents: business.receivedCents + other.receivedCents,
      pendingCents: business.pendingCents + other.pendingCents,
      recordCount: business.recordCount + other.recordCount
    }
  }
}
