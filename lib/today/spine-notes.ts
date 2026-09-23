/** One note per quarter tick on Today's spine, in due-date order. */
export function spineNotes(input: {
  quarters: { quarter: 1 | 2 | 3 | 4; dueDate: string; isPast: boolean }[];
  doneDueDates: string[];
}): string[] {
  const sorted = [...input.quarters].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const done = new Set(input.doneDueDates);
  let dueMarked = false;
  return sorted.map((q) => {
    if (done.has(q.dueDate)) return `Q${q.quarter} · done`;
    if (q.isPast) return `Q${q.quarter} · past`;
    if (!dueMarked) {
      dueMarked = true;
      return `Q${q.quarter} · due`;
    }
    return `Q${q.quarter}`;
  });
}
