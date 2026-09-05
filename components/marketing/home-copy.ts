// components/marketing/home-copy.ts
import type { Audience } from "@/components/AudienceToggle";
import type { PanelSample } from "@/components/HeroInstrument";
import { taxYearRunway } from "@/lib/marketing/tax-year-runway";

/** Fixed sample date so the visual baselines do not drift. Day 248, Q3 in 10 days. */
export const HOME_TAX_YEAR = 2026;
export const HOME_AS_OF = new Date("2026-09-05T00:00:00Z");

export type HeroCopy = {
  head: string;
  lede: string;
  ctaHref: string;
  ctaLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
  fine: string;
};

export const HERO: Record<Audience, HeroCopy> = {
  personal: {
    head: "Your taxes, as of today.",
    lede: "One number, kept current all year: what you will owe, federal and state, from the accounts you already have. You hear two weeks before each payment. Miles and deductions are logged for you.",
    ctaHref: "/example",
    ctaLabel: "See the sample account",
    secondaryHref: "/login",
    secondaryLabel: "Sign in",
    fine: "Free to look. No card.",
  },
  business: {
    head: "Your business's taxes, as of today.",
    lede: "What the business owes, federal and state, from its bank feed, kept current all year. Expenses land on their Schedule C line with the IRS code cited. Every mile is logged as it is driven.",
    ctaHref: "/example",
    ctaLabel: "See the sample account",
    secondaryHref: "/login",
    secondaryLabel: "Sign in",
    fine: "Free to look. No card.",
  },
  firm: {
    head: "Every client's year, as of today.",
    lede: "Every client's number, federal and state, kept current from their own accounts. Engagements move on their own, mileage arrives with a map and a log, bulk export sends the year-end pack. Branded as your firm.",
    ctaHref: "/book?for=firm",
    ctaLabel: "Book a walkthrough",
    secondaryHref: "/pricing#practice",
    secondaryLabel: "See pricing",
    fine: "Per seat or per client.",
  },
};

const r = taxYearRunway(HOME_TAX_YEAR, HOME_AS_OF);
const NEXT = r.next ? `Q${r.next.quarter} · due ${r.next.label} · ${r.daysToNext} days` : "All four quarters paid";

export const PANEL: Record<Audience, PanelSample> = {
  personal: {
    heading: NEXT,
    nextPaymentCents: 342_000,
    setAsideCents: 215_000,
    ledger: [
      { date: "Sep 4", text: "Drive, client site, 22.7 mi", amount: "-$16" },
      { date: "Sep 3", text: "Adobe Creative Cloud, software", amount: "-$22" },
      { date: "Sep 2", text: "Invoice paid, Northwind Co.", amount: "+$410" },
    ],
    foot: "How the number moved this week. Federal and state, in step with your bank.",
  },
  business: {
    heading: NEXT,
    nextPaymentCents: 440_000,
    setAsideCents: 300_000,
    ledger: [
      { date: "Sep 4", text: "Drive, client site, 22.7 mi", amount: "-$16" },
      { date: "Sep 3", text: "AWS, S3 and CloudFront, software", amount: "-$85" },
      { date: "Sep 2", text: "Invoice paid, Northwind Co.", amount: "+$1,240" },
    ],
    foot: "How the number moved this week. Federal and state, in step with the bank feed.",
  },
  firm: {
    heading: `Maple Lane Design Co. · ${NEXT}`,
    nextPaymentCents: 342_000,
    setAsideCents: 215_000,
    ledger: [
      { date: "Sep 4", text: "Q3 vouchers ready", amount: "14 clients" },
      { date: "Sep 3", text: "Engagement letters signed", amount: "3" },
      { date: "Sep 2", text: "Mileage logs received", amount: "9" },
    ],
    foot: "One client's panel. The console shows all of them the same way.",
  },
};

export type MomentKey = "q1" | "q2" | "road" | "q3" | "dec";
export type Moment = {
  key: MomentKey;
  /** ISO date the section is anchored to on the spine. */
  anchor: string;
  date: string;
  tag: string;
  title: string;
  body: string;
  link: string;
  href: string;
};

const SHARED: Omit<Moment, "title" | "body">[] = [
  { key: "q1", anchor: "2026-04-15", date: "Apr 15", tag: "Q1 payment · last year's return", link: "See a Schedule C export", href: "/example" },
  { key: "q2", anchor: "2026-06-15", date: "Jun 15", tag: "Q2 payment", link: "How the forecast is built", href: "/guides/quarterly-estimated-taxes-explained" },
  { key: "road", anchor: "2026-08-01", date: "Jul to Sep", tag: "On the road", link: "What a drive record holds", href: "/calculators/mileage-deduction" },
  { key: "q3", anchor: "2026-09-15", date: "Sep 15", tag: "Q3 payment", link: "How reminders are timed", href: "/help" },
  { key: "dec", anchor: "2026-12-01", date: "Dec", tag: "Before the year closes", link: "See the playbook", href: "/example" },
];

function withCopy(copy: Record<MomentKey, { title: string; body: string }>): Moment[] {
  return SHARED.map((m) => ({ ...m, ...copy[m.key] }));
}

export const MOMENTS: Record<Audience, Moment[]> = {
  personal: withCopy({
    q1: {
      title: "The return assembles itself from the year before.",
      body: "Every business transaction from last year is already on its Schedule C line, cited to the IRS publication that allows it. Export it to your preparer or your filing tool. This year's Q1 number is on the same screen.",
    },
    q2: {
      title: "The number moves when your bank does.",
      body: "New transactions land pre-sorted, with the IRC section that makes them deductible and the source one tap away. The forecast recalculates as they clear. Two weeks before June 15 it tells you the amount and where to pay it.",
    },
    road: {
      title: "Every business mile, logged while you drive.",
      body: "The phone records the drive in the background, sorts it business or personal, and prices it at the IRS rate. Each trip keeps its map and its log, the record an audit asks for. Commutes to a W-2 job are left out.",
    },
    q3: {
      title: "Two weeks out, you know the number and what is set aside.",
      body: "Set-aside is measured against the estimate, not guessed at. When the gap is closing, the reminder says so. When it is not, it says how much is still to put away and by when.",
    },
    dec: {
      title: "The moves still worth making, priced.",
      body: "A short list of legitimate ways to lower the bill, each with the dollars it saves at your bracket: retirement room, the HSA, the home office method, invoice timing. Adopt one and the forecast responds.",
    },
  }),
  business: withCopy({
    q1: {
      title: "The Schedule C assembles itself from the year before.",
      body: "Every business transaction from last year is on its Schedule C line, meals at 50%, vehicle split, each cited to the IRS publication. Export the workpaper to your CPA. This year's Q1 number is on the same screen.",
    },
    q2: {
      title: "The books move when the bank does.",
      body: "New transactions sync and land pre-sorted, IRC section cited, source one tap away. Mixed personal and business is a tap to split. Two weeks before June 15 the forecast tells you the amount and where to pay it.",
    },
    road: {
      title: "Every business mile, for every driver.",
      body: "Each phone records its drives in the background, sorts them business or personal, and prices them at the IRS rate. A team shows one driver per colour, each trip with its map and log.",
    },
    q3: {
      title: "Two weeks out, you know the number and what is set aside.",
      body: "Set-aside is measured against the estimate. When the gap is closing, the reminder says so. When it is not, it says how much is still to put away and by when.",
    },
    dec: {
      title: "The moves still worth making, priced.",
      body: "Retirement room, the HSA, the home office method, invoice timing: each with the dollars it saves at the business's bracket. Adopt one and the forecast responds.",
    },
  }),
  firm: withCopy({
    q1: {
      title: "Every client's Schedule C, assembled and cited.",
      body: "Each client's transactions are already on their Schedule C lines with the IRS publication cited. Bulk export sends every year-end pack in one pass, in your firm's name.",
    },
    q2: {
      title: "Their books move. Your console shows it.",
      body: "New transactions land pre-sorted in each client's books. Where a client needs to decide, the console says so, and the follow-up goes out on its own.",
    },
    road: {
      title: "Client mileage that arrives already defensible.",
      body: "Clients' drives are captured by GPS as they happen, sorted, and priced at the IRS rate for the period driven. You receive a contemporaneous log with a map, not a number reconstructed in April.",
    },
    q3: {
      title: "Every client's Q3, two weeks out.",
      body: "The console lists who has set aside enough, who is short, and who has not opened the app. Reminders go out under your firm's name.",
    },
    dec: {
      title: "Year-end moves, priced per client.",
      body: "Each client's playbook shows the moves still worth making at their bracket, with the dollars. Your team reviews, the client adopts, the forecast responds.",
    },
  }),
};
