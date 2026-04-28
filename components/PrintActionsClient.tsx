"use client";

export function PrintActionsClient() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-primary text-sm h-10 px-4"
    >
      Save as PDF / Print
    </button>
  );
}
