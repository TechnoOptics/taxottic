/**
 * Quarterly estimated tax payment dates for a given year.
 * Federal Form 1040-ES due dates: Apr 15, Jun 15, Sep 15, Jan 15 (next year).
 * If a date falls on a weekend or federal holiday, the IRS shifts to the next
 * business day. We do not model holidays here; close enough for in-app reminders.
 */
export function quarterlyDueDates(taxYear: number) {
  return [
    { kind: "q1_payment" as const, due: new Date(Date.UTC(taxYear, 3, 15)), label: `Q1 estimated tax (${taxYear})` },
    { kind: "q2_payment" as const, due: new Date(Date.UTC(taxYear, 5, 15)), label: `Q2 estimated tax (${taxYear})` },
    { kind: "q3_payment" as const, due: new Date(Date.UTC(taxYear, 8, 15)), label: `Q3 estimated tax (${taxYear})` },
    { kind: "q4_payment" as const, due: new Date(Date.UTC(taxYear + 1, 0, 15)), label: `Q4 estimated tax (${taxYear})` },
    { kind: "filing_deadline" as const, due: new Date(Date.UTC(taxYear + 1, 3, 15)), label: `${taxYear} return filing deadline` },
    { kind: "extension_deadline" as const, due: new Date(Date.UTC(taxYear + 1, 9, 15)), label: `${taxYear} extension deadline` },
  ];
}

/**
 * Returns the upcoming due dates (today and forward), most recent first.
 */
export function upcomingDueDates(taxYear: number, asOf = new Date()) {
  return quarterlyDueDates(taxYear)
    .filter((d) => d.due.getTime() >= asOf.getTime())
    .sort((a, b) => a.due.getTime() - b.due.getTime());
}
