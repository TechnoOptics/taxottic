import { requireUser } from "@/lib/auth";
import { AppHeader } from "@/components/AppHeader";
import { US_STATES } from "@/data/us-states";
import { NewCompanyWizard } from "./NewCompanyWizard";
import { createCompany } from "./actions";

const ENTITY_TYPES = [
  {
    value: "sole_prop",
    label: "Sole Proprietor",
    sub: "Just me, no separate entity. Schedule C. Most common for freelancers.",
  },
  {
    value: "single_llc",
    label: "Single-Member LLC",
    sub: "An LLC with one owner. Tax-default is the same as sole prop unless I've elected S-corp.",
  },
  {
    value: "multi_llc",
    label: "Multi-Member LLC",
    sub: "Multiple owners on an LLC; files Form 1065 partnership return by default.",
  },
  {
    value: "s_corp",
    label: "S-Corp",
    sub: "Pass-through entity with payroll on owner-employees. I take a reasonable W-2 wage.",
  },
  {
    value: "c_corp",
    label: "C-Corp",
    sub: "Separate taxable entity at a flat 21% federal rate. Less common for small biz.",
  },
  {
    value: "partnership",
    label: "Partnership",
    sub: "General or limited partnership. Files Form 1065.",
  },
  {
    value: "self_employed_1099",
    label: "1099 / Self-Employed",
    sub: "Independent contractor without a formal entity yet.",
  },
];

export default async function NewCompanyPage() {
  const { user } = await requireUser();
  return (
    <main className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <NewCompanyWizard
        entityTypes={ENTITY_TYPES}
        states={US_STATES}
        action={createCompany}
      />
    </main>
  );
}
