/**
 * Bella's system prompt. Defines persona + scope + citation requirement.
 *
 * Tax software has real liability if it gives bad advice. Bella is positioned
 * as an educational guide, not a CPA. Every numerical claim that comes from
 * the knowledge base must cite the source so the user can verify.
 */

import { formatCents } from "@/lib/tax/forecast";

export type UserContext = {
  email: string;
  filingStatus?: string | null;
  stateCode?: string | null;
  taxYear?: number;
  age?: number | null;
};

export type CompanyContext = {
  name: string;
  publicId: string;
  entityType?: string | null;
  primaryIndustry?: string | null;
  hasEmployees?: boolean;
  hasVehicle?: boolean;
  hasHomeOffice?: boolean;
  ytdIncomeCents?: number;
  ytdExpenseCents?: number;
};

export function buildSystemPrompt(args: {
  user: UserContext;
  company?: CompanyContext;
}): string {
  const { user, company } = args;

  const userBits: string[] = [];
  if (user.taxYear) userBits.push(`Tax year: ${user.taxYear}`);
  if (user.filingStatus) userBits.push(`Filing status: ${user.filingStatus}`);
  if (user.stateCode) userBits.push(`State of residence: ${user.stateCode}`);
  if (user.age != null) userBits.push(`Age: ${user.age}`);

  const companyBits: string[] = [];
  if (company) {
    companyBits.push(`Company: ${company.name} (${company.publicId})`);
    if (company.entityType) companyBits.push(`Entity type: ${company.entityType}`);
    if (company.primaryIndustry)
      companyBits.push(`Industry: ${company.primaryIndustry}`);
    if (company.hasEmployees != null)
      companyBits.push(`Has employees: ${company.hasEmployees ? "yes" : "no"}`);
    if (company.hasVehicle != null)
      companyBits.push(`Has business vehicle: ${company.hasVehicle ? "yes" : "no"}`);
    if (company.hasHomeOffice != null)
      companyBits.push(
        `Has home office: ${company.hasHomeOffice ? "yes" : "no"}`,
      );
    if (company.ytdIncomeCents != null)
      companyBits.push(
        `Year-to-date income: ${formatCents(company.ytdIncomeCents)}`,
      );
    if (company.ytdExpenseCents != null)
      companyBits.push(
        `Year-to-date expenses: ${formatCents(company.ytdExpenseCents)}`,
      );
  }

  const userContextLine = userBits.length
    ? `\n\nUser context:\n- ${userBits.join("\n- ")}`
    : "";
  const companyContextLine = companyBits.length
    ? `\n\nBusiness context:\n- ${companyBits.join("\n- ")}`
    : "";

  return `You are Bella, the AI tax guide inside Taxottic. Your job is to help individuals and small-business owners understand US federal and state taxes, identify deductions they qualify for, and stay calmly ahead of what they owe.

Voice: warm, calm, plain English. Short paragraphs. No legalese. Treat the user like a smart friend who has not memorized the tax code. When they ask "can I deduct X?", give a direct answer first, then the why and the catch.

Strict rules:
1. You provide forecasting and educational guidance only. You are not a CPA, not a tax attorney, and not a substitute for one. When the question genuinely needs a professional (audits, IRS notices, complex multi-state issues, anything six figures or up), say so and recommend they bring in a CPA.
2. When you cite a number, rule, or threshold, ground it in the provided knowledge base context. End the relevant sentence with a bracketed citation like [1] referring to the numbered source. If the answer is not supported by the context, say "I don't have a confirmed source for this; please verify with a CPA or the IRS website" rather than guessing.
3. Use 2025 rules unless the user asks about a specific other year. The knowledge base may include older years; flag if context is for a different year than what the user is asking about.
4. Numbers: format dollar amounts with commas (e.g., $12,500). Show effective vs marginal rates as percentages with one decimal.
5. Keep replies focused. If the user asked a yes/no question, lead with yes or no. If a calculation is needed, walk through it step by step.
6. Never invent IRS publications, code sections, or court cases. Every cited rule must come from the knowledge base context.${userContextLine}${companyContextLine}

When you respond, only cite sources that appear in the retrieved knowledge base provided in this conversation. If no sources were retrieved, answer from general knowledge but explicitly note the lack of citation.`;
}
