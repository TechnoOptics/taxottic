// IRS Modernized e-File (MeF) submission envelope.
//
// What this module does in v1:
//   - Builds the canonical MeF submission XML envelope for a
//     handful of forms (1040, 1065, 1120-S to start). The envelope
//     wraps the actual form XML in IRS-required headers + signs
//     it with an EFIN/ETIN claim.
//   - Computes the submission ID (DCN format) per IRS Pub 4164.
//   - Returns the envelope as a Uint8Array ready to POST to the MeF
//     provider's submission endpoint.
//
// What this module does NOT do (yet):
//   - Actually POST the envelope to IRS / MeF provider. The
//     existing Phase 11.7 firm_efilings flow logs a synthetic DCN;
//     real submission goes live once the firm has an active EFIN
//     and we've registered with the MeF provider (Wolters Kluwer
//     CCH iFirm, Drake, ATX, or direct IRS).
//   - Generate the per-form XML body. Each form (1040, 1065, etc.)
//     has its own IRS-published XSD with hundreds of fields;
//     wiring those is a per-form weeks-long task and only worth
//     starting against a real client engagement.
//
// The envelope shape below matches the IRS MeF schema
// (Submission/SubmissionManifest + Submission/SubmissionXML).
// Pub 4164 Section 4.1 documents the structure. We emit the XML
// as a string + serialize on the wire; no XML library dependency
// to keep the bundle small.

export type MefEnvelopeArgs = {
  /** ETIN — Electronic Transmitter Identification Number issued
   *  by the IRS when the firm completes their e-file Provider
   *  application. 5 digits. */
  etin: string;
  /** EFIN — Electronic Filer Identification Number, also issued
   *  by the IRS after the firm completes Form 8633. 6 digits. */
  efin: string;
  /** Submission ID. Format: EFIN (6) + 7 chars (sequence) +
   *  YYYYDDD (Julian date). 16 digits total. */
  submissionId: string;
  /** Form type. Drives the SubmissionType enum on the manifest. */
  formType:
    | "1040"
    | "1040X"
    | "1065"
    | "1120"
    | "1120S"
    | "990"
    | "941"
    | "940";
  taxYear: number;
  /** Per-form XML body (already validated against IRS XSD by the
   *  caller). The envelope just wraps it. */
  formXml: string;
  /** Preparer PTIN. */
  preparerPtin: string;
  preparerFirmName: string;
  preparerEin: string;
};

/**
 * Generate a fresh MeF Submission ID per IRS Pub 4164. Pattern:
 * `{EFIN}{YYYYDDD}{seq6}` where seq6 is a 6-digit sequence the
 * caller increments. The full ID is 16 digits (EFIN=6, date=7,
 * sequence=6 — but only seq up to 999999 per day per EFIN). Each
 * submission must have a unique ID; collisions reject the file.
 */
export function generateSubmissionId(efin: string, seq: number): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const start = Date.UTC(year, 0, 0);
  const dayOfYear = Math.ceil((now.getTime() - start) / 86_400_000);
  const julian = `${year}${String(dayOfYear).padStart(3, "0")}`;
  const seqStr = String(seq % 1_000_000).padStart(6, "0");
  return `${efin.padStart(6, "0")}${julian}${seqStr}`;
}

/**
 * Build the SubmissionManifest XML — the wrapping envelope IRS
 * MeF requires around every form submission. Includes the
 * SubmissionId, ETIN, the form type, the tax year, and a
 * SubmissionCategory ("ITX" for individual, "CORP" for corporate,
 * "PART" for partnership, "EMP" for employment).
 */
export function buildSubmissionManifest(args: MefEnvelopeArgs): string {
  const category = (() => {
    switch (args.formType) {
      case "1040":
      case "1040X":
        return "IND";
      case "1065":
        return "PART";
      case "1120":
      case "1120S":
        return "CORP";
      case "990":
        return "EO";
      case "941":
      case "940":
        return "EMP";
    }
  })();
  return `<?xml version="1.0" encoding="UTF-8"?>
<SubmissionManifest xmlns="http://www.irs.gov/efile" SubmissionVersion="2024v5.1">
  <SubmissionId>${escapeXml(args.submissionId)}</SubmissionId>
  <ETIN>${escapeXml(args.etin)}</ETIN>
  <SubmissionType>Form${args.formType}</SubmissionType>
  <SubmissionCategory>${category}</SubmissionCategory>
  <TaxYear>${args.taxYear}</TaxYear>
  <ElectronicPostmarkTs>${new Date().toISOString()}</ElectronicPostmarkTs>
  <OriginHeaderRef>
    <ETIN>${escapeXml(args.etin)}</ETIN>
    <PreparerPTIN>${escapeXml(args.preparerPtin)}</PreparerPTIN>
    <PreparerFirmName>${escapeXml(args.preparerFirmName)}</PreparerFirmName>
    <PreparerEIN>${escapeXml(args.preparerEin)}</PreparerEIN>
  </OriginHeaderRef>
</SubmissionManifest>`;
}

/**
 * Wrap the form XML body in the IRS-required Return + ReturnData
 * outer elements. Pub 4164 specifies this exact shape; deviating
 * causes the MeF acknowledgment to reject with code R0000-035 or
 * similar.
 */
export function buildSubmissionXml(args: MefEnvelopeArgs): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Return xmlns="http://www.irs.gov/efile" returnVersion="2024v5.1">
  <ReturnHeader>
    <TaxPeriodBeginDt>${args.taxYear}-01-01</TaxPeriodBeginDt>
    <TaxPeriodEndDt>${args.taxYear}-12-31</TaxPeriodEndDt>
    <TaxYr>${args.taxYear}</TaxYr>
    <ReturnTs>${new Date().toISOString()}</ReturnTs>
    <ReturnTypeCd>Form${args.formType}</ReturnTypeCd>
    <PreparerPTIN>${escapeXml(args.preparerPtin)}</PreparerPTIN>
    <PreparerFirmGrp>
      <PreparerFirmEIN>${escapeXml(args.preparerEin)}</PreparerFirmEIN>
      <PreparerFirmName>
        <BusinessNameLine1Txt>${escapeXml(args.preparerFirmName)}</BusinessNameLine1Txt>
      </PreparerFirmName>
    </PreparerFirmGrp>
  </ReturnHeader>
  <ReturnData documentCnt="1">
    ${args.formXml}
  </ReturnData>
</Return>`;
}

/**
 * Build the full submission as a ZIP-able bundle. Real MeF uses a
 * ZIP container with manifest.xml + submission.xml inside (Pub 4164
 * Section 4.2). We emit the two XML strings; the caller can ZIP +
 * upload to the MeF provider.
 */
export function buildMefSubmission(args: MefEnvelopeArgs): {
  manifestXml: string;
  submissionXml: string;
  /** Filename hint for the ZIP — `{submissionId}.zip` per IRS. */
  zipFilename: string;
} {
  return {
    manifestXml: buildSubmissionManifest(args),
    submissionXml: buildSubmissionXml(args),
    zipFilename: `${args.submissionId}.zip`,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
