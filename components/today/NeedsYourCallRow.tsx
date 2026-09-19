"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import { notBusiness } from "@/components/today/today-actions";
import type { OutstandingItem } from "@/lib/tasks/outstanding";

const DATE_SEGMENT = /^[A-Z][a-z]{2} \d{1,2}$/;
const MONEY_SEGMENT = /^-?\$[\d,]+(\.\d\d)?$/;

/**
 * A subtitle is a " · "-joined run of date, money and plain-text segments
 * (e.g. "Sep 2 · $24.50 · Meal with a client?"). Every date or money
 * segment carries `figure`; plain text does not. A subtitle with no
 * separator at all is plain text throughout.
 */
function Subtitle({ text }: { text: string }) {
  const segments = text.split(" · ");
  if (segments.length < 2) return <>{text}</>;
  return (
    <>
      {segments.map((segment, i) => (
        <span key={i}>
          {i > 0 ? " · " : null}
          {DATE_SEGMENT.test(segment) || MONEY_SEGMENT.test(segment) ? (
            <span className="figure">{segment}</span>
          ) : (
            segment
          )}
        </span>
      ))}
    </>
  );
}

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
  const [failed, setFailed] = useState(false);
  if (done) return null;
  const canDismiss = item.kind === "bank_transaction" && item.publicId;
  return (
    <li className="today-call-row" style={failed ? { flexWrap: "wrap" } : undefined}>
      <div className="min-w-0">
        <div className="today-call-title">{item.title}</div>
        <div className="today-call-sub">
          <Subtitle text={item.subtitle} />
        </div>
      </div>
      <div className="today-call-actions">
        {canDismiss ? (
          <>
            <Link href={item.href} className="btn-primary min-h-11">Business</Link>
            <form
              action={async (fd) => {
                try {
                  const changed = await notBusiness(fd);
                  if (changed) {
                    setDone(true);
                  } else {
                    setFailed(true);
                  }
                } catch {
                  setFailed(true);
                }
              }}
            >
              <input type="hidden" name="publicId" value={item.publicId} />
              <input type="hidden" name="txId" value={item.id} />
              <Submit />
            </form>
          </>
        ) : (
          <Link href={item.href} className="btn-quiet min-h-11">Open</Link>
        )}
      </div>
      {failed ? (
        <p className="today-call-sub" style={{ width: "100%", marginTop: 4 }}>
          Could not save this one. Open it instead.
        </p>
      ) : null}
    </li>
  );
}
