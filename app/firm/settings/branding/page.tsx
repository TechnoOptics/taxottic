import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin } from "@/lib/auth";
import { requireFirmAdmin } from "@/lib/firm/context";
import { updateFirmBranding, uploadFirmLogo } from "./actions";

// /firm/settings/branding — firm-wide identity. Logo, accent color,
// legal name, contact + address. The values flow into every
// invitation email + engagement letter, so they're worth filling
// in early.

export default async function BrandingPage() {
  const { admin, user } = await requireUserWithAdmin();
  const ctx = await requireFirmAdmin();

  const { data: firm } = await admin
    .from("firms")
    .select(
      "name, legal_name, accent_color, phone, email, website, address_line_1, address_city, address_region, address_postal_code, logo_url",
    )
    .eq("id", ctx.firm.id)
    .single();

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/firm/settings"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Settings
          </Link>{" "}
          · Branding
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          How your firm shows up.
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-xl">
          The values here land on every invitation email, engagement
          letter, and invoice. The accent color tints the call-to-
          action buttons in your client emails.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[18rem_1fr]">
          {/* Logo */}
          <section className="card p-5">
            <h2 className="display text-base text-forest-900">Logo</h2>
            <div className="mt-3 grid place-items-center bg-cream-100 rounded-xl p-6 h-32">
              {firm?.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={firm.logo_url}
                  alt="Firm logo"
                  className="max-h-20 max-w-full"
                />
              ) : (
                <div className="display text-2xl text-forest-700">
                  {firm?.name?.slice(0, 2) ?? "FA"}
                </div>
              )}
            </div>
            <form
              action={uploadFirmLogo}
              encType="multipart/form-data"
              className="mt-3 grid gap-2"
            >
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                required
                className="text-xs"
              />
              <button type="submit" className="btn-primary text-xs w-full">
                Upload
              </button>
              <p className="text-[10px] text-ink-muted leading-relaxed">
                PNG / JPG / WebP / SVG, ≤2MB. SVG renders sharpest at
                small sizes (email signatures).
              </p>
            </form>
          </section>

          {/* Brand details */}
          <form
            action={updateFirmBranding}
            className="card p-5 grid gap-4"
          >
            <h2 className="display text-base text-forest-900">
              Firm details
            </h2>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Display name
                </span>
                <input
                  type="text"
                  name="name"
                  required
                  defaultValue={firm?.name ?? ""}
                  className="input text-sm"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Legal name
                </span>
                <input
                  type="text"
                  name="legal_name"
                  placeholder="Smith Allen CPA, LLC"
                  defaultValue={firm?.legal_name ?? ""}
                  className="input text-sm"
                />
              </label>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Phone
                </span>
                <input
                  type="tel"
                  name="phone"
                  placeholder="+1 555 555 0100"
                  defaultValue={firm?.phone ?? ""}
                  className="input text-sm"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-medium text-forest-800">
                  Contact email
                </span>
                <input
                  type="email"
                  name="email"
                  placeholder="hello@smithallen.com"
                  defaultValue={firm?.email ?? ""}
                  className="input text-sm"
                />
              </label>
            </div>

            <label className="grid gap-1">
              <span className="text-xs font-medium text-forest-800">
                Website
              </span>
              <input
                type="url"
                name="website"
                placeholder="https://smithallen.com"
                defaultValue={firm?.website ?? ""}
                className="input text-sm"
              />
            </label>

            <fieldset className="grid gap-3">
              <legend className="text-xs font-medium text-forest-800">
                Address (for engagement letters)
              </legend>
              <input
                type="text"
                name="address_line_1"
                placeholder="123 Main St, Suite 200"
                defaultValue={firm?.address_line_1 ?? ""}
                className="input text-sm"
              />
              <div className="grid grid-cols-[1fr_5rem_6rem] gap-2">
                <input
                  type="text"
                  name="address_city"
                  placeholder="City"
                  defaultValue={firm?.address_city ?? ""}
                  className="input text-sm"
                />
                <input
                  type="text"
                  name="address_region"
                  placeholder="State"
                  maxLength={3}
                  defaultValue={firm?.address_region ?? ""}
                  className="input text-sm uppercase"
                />
                <input
                  type="text"
                  name="address_postal_code"
                  placeholder="ZIP"
                  defaultValue={firm?.address_postal_code ?? ""}
                  className="input text-sm tabular-nums"
                />
              </div>
            </fieldset>

            <label className="grid gap-1">
              <span className="text-xs font-medium text-forest-800">
                Accent color (hex)
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  name="accent_color"
                  placeholder="#1d2843"
                  maxLength={7}
                  defaultValue={firm?.accent_color ?? "#1d2843"}
                  className="input text-sm font-mono flex-1"
                />
                <span
                  className="size-8 rounded-md border border-forest-100 shrink-0"
                  style={{
                    backgroundColor: firm?.accent_color ?? "#1d2843",
                  }}
                />
              </div>
              <span className="text-[10px] text-ink-muted">
                Used on CTA buttons in invitation + invoice emails.
              </span>
            </label>

            <div className="pt-2">
              <button type="submit" className="btn-primary text-sm">
                Save changes
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
