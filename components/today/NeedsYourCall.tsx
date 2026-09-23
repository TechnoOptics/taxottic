import { NeedsYourCallRow } from "./NeedsYourCallRow";
import type { OutstandingItem } from "@/lib/tasks/outstanding";

/** Spec 4.3 item 4. */
export function NeedsYourCall({ items, count }: { items: (OutstandingItem & { publicId?: string })[]; count: number }) {
  return (
    <section className="today-section" aria-labelledby="today-call">
      <h2 id="today-call" className="today-section-title">
        Needs your call <span className="figure today-count">{count}</span>
      </h2>
      {items.length === 0 ? (
        <p className="today-empty">Nothing waiting on you.</p>
      ) : (
        <ul className="today-call-list">
          {items.map((it) => (
            <NeedsYourCallRow key={`${it.kind}:${it.id}`} item={it} />
          ))}
        </ul>
      )}
    </section>
  );
}
