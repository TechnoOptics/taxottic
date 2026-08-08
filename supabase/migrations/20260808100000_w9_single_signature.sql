-- A signed W-9 must not be silently re-signable.
--
-- submit_w9_form matched on:
--
--   and status in ('requested', 'received')
--
-- 'received' is the state a form enters AFTER it has been signed. So anyone
-- holding the request link could re-submit for the whole 90-day token life
-- and overwrite an executed form, including:
--
--   tin_digits, legal_name, address, entity_type   the substance
--   signed_at, signed_ip, signed_user_agent        WHO signed and from where
--   signature_full_name                            the attestation itself
--
-- The second group is the problem. A W-9 is a signed declaration made under
-- penalty of perjury, and those columns exist to evidence it. A flow that
-- lets the evidence be replaced later, in place, with no record that it
-- changed, cannot support the document's purpose. The payer would have no
-- way to show which TIN was actually attested to.
--
-- Reachability today, stated precisely rather than reassuringly: EXECUTE was
-- revoked from anon and authenticated in 20260808060000, so this is no longer
-- callable straight from PostgREST. But app/w9/[token]/actions.ts calls it
-- with the service-role client, passing the token from the URL, so a link
-- holder still reaches it. The revoke narrowed the surface and did not close
-- this.
--
-- Fix: a form may be submitted once. `status = 'requested'` alone would be
-- enough today, but `signed_at is null` is included as a second, independent
-- condition so that a future status value cannot quietly re-open this.
--
-- Corrections are a re-request, not an overwrite: the firm issues a new
-- token, which produces a new row and a new signature, and leaves the
-- original intact. That is the behaviour a reviewer or an auditor expects.
--
-- Safe to apply now: firm_w9_forms holds 0 rows, so nothing needs
-- backfilling and no legitimate in-flight signature can be disrupted. After
-- the first real form exists this becomes a data question as well as a code
-- one, which is the argument for doing it today.

create or replace function public.submit_w9_form(
  p_token text,
  p_legal_name text,
  p_business_name text,
  p_entity_type firm_w9_entity_type,
  p_llc_tax_classification character,
  p_other_classification text,
  p_exempt_payee_code text,
  p_exempt_fatca_code text,
  p_address_line_1 text,
  p_address_line_2 text,
  p_address_city text,
  p_address_region text,
  p_address_postal_code text,
  p_tin_type firm_w9_tin_type,
  p_tin_digits text,
  p_signature_full_name text,
  p_signed_ip text,
  p_signed_ua text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_w9_id uuid;
begin
  if length(coalesce(p_legal_name, '')) < 1 then
    raise exception 'legal_name required';
  end if;
  if p_tin_type is null or length(coalesce(p_tin_digits, '')) < 9 then
    raise exception 'tin required';
  end if;
  if length(coalesce(p_signature_full_name, '')) < 1 then
    raise exception 'signature required';
  end if;

  update public.firm_w9_forms set
    legal_name = p_legal_name,
    business_name = p_business_name,
    entity_type = p_entity_type,
    llc_tax_classification = p_llc_tax_classification,
    other_classification = p_other_classification,
    exempt_payee_code = p_exempt_payee_code,
    exempt_fatca_code = p_exempt_fatca_code,
    address_line_1 = p_address_line_1,
    address_line_2 = p_address_line_2,
    address_city = p_address_city,
    address_region = p_address_region,
    address_postal_code = p_address_postal_code,
    tin_type = p_tin_type,
    tin_digits = p_tin_digits,
    signed_at = now(),
    signed_ip = p_signed_ip,
    signed_user_agent = p_signed_ua,
    signature_full_name = p_signature_full_name,
    status = 'received',
    updated_at = now()
  where request_token = p_token
    -- ONE signature per token. Was `status in ('requested','received')`,
    -- which let an executed form be overwritten for 90 days. Both
    -- conditions are deliberate: either alone would close this today, and
    -- keeping both means a new status value cannot silently re-open it.
    and status = 'requested'
    and signed_at is null
    and expires_at > now()
  returning id into v_w9_id;

  if v_w9_id is null then
    -- Deliberately the same error for "no such token", "expired" and
    -- "already signed". A token holder learning WHICH of those applies is
    -- an oracle over other people's filing state, and the legitimate user
    -- cannot act differently on any of them: all three mean "ask the firm
    -- for a new link".
    raise exception 'invalid_or_expired_token';
  end if;
  return v_w9_id;
end;
$function$;

-- CREATE OR REPLACE preserves the existing ACL, and 20260808060000 already
-- revoked this from anon and authenticated. Re-asserted rather than assumed:
-- a replace that ever recreated the function fresh would silently inherit
-- the PUBLIC default, which is the exact trap that put these RPCs on the
-- internet in the first place.
revoke execute on function public.submit_w9_form(
  text, text, text, firm_w9_entity_type, character, text, text, text,
  text, text, text, text, text, firm_w9_tin_type, text, text, text, text
) from anon, authenticated, public;
