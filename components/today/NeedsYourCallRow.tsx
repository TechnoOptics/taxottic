"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { notBusiness } from "@/components/today/today-actions";
import type { OutstandingItem } from "@/lib/tasks/outstanding";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-quiet min-h-11" disabled={pending}>
      {pending ? "Saving" : "Not business"}
    </button>
  );
}

export function NeedsYourCallRow({ item }: { item: OutstandingItem & { publicId?: string } }) {
  const [done, setDone] = useState(false);
  if (done) return null;
  const [date, ...rest] = item.subtitle.split(" · ");
  const canDismiss = item.kind === "bank_transaction" && item.publicId;
  return (
    <li className="today-call-row">
      <div className="min-w-0">
        <div className="today-call-title">{item.title}</div>
        <div className="today-call-sub">
          <span className="figure">{date}</span>
          {rest.length ? <span> · {rest.join(" · ")}</span> : null}
        </div>
      </div>
      <div className="today-call-actions">
        {canDismiss ? (
          <>
            <Link href={item.href} className="btn-primary min-h-11">Business</Link>
            <form action={async (fd) => { await notBusiness(fd); setDone(true); }}>
              <input type="hidden" name="publicId" value={item.publicId} />
              <input type="hidden" name="txId" value={item.id} />
              <Submit />
            </form>
          </>
        ) : (
          <Link href={item.href} className="btn-quiet min-h-11">Open</Link>
        )}
      </div>
    </li>
  );
}
