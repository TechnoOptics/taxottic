import { describe, expect, it } from "vitest";
import { spineNotes } from "./spine-notes";

describe("spine notes", () => {
  it("names each quarter tick by what happened", () => {
    expect(
      spineNotes({
        quarters: [
          { quarter: 1, dueDate: "2026-04-15", isPast: true },
          { quarter: 2, dueDate: "2026-06-15", isPast: true },
          { quarter: 3, dueDate: "2026-09-15", isPast: false },
          { quarter: 4, dueDate: "2027-01-15", isPast: false },
        ],
        doneDueDates: ["2026-04-15"],
      }),
    ).toEqual(["Q1 · done", "Q2 · past", "Q3 · due", "Q4"]);
  });
  it("orders by due date whatever order the quarters arrive in", () => {
    const notes = spineNotes({
      quarters: [
        { quarter: 4, dueDate: "2027-01-15", isPast: false },
        { quarter: 1, dueDate: "2026-04-15", isPast: true },
      ],
      doneDueDates: [],
    });
    expect(notes).toEqual(["Q1 · past", "Q4 · due"]);
  });
});
