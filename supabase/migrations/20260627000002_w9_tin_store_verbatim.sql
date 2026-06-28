-- W-9 TIN encryption support.
--
-- The W-9 TIN (an actual SSN or EIN of a contractor/vendor) is now
-- encrypted application-side (AES-256-GCM via the field-encryption helper)
-- BEFORE it reaches this RPC. The previous body ran
-- `regexp_replace(p_tin_digits, '\D', '', 'g')`, which stripped every
-- non-digit character — that would shred the base64 ciphertext and make the
-- value undecryptable. So we now store p_tin_digits verbatim.
--
-- The "9 digits" validation already happens in the app (app/w9/[token]/
-- actions.ts) on the raw TIN before encryption, so we keep only a basic
-- non-empty / min-length guard here (ciphertext is long, so it passes).
-- `create or replace` preserves the existing EXECUTE grant.

create or replace function public.submit_w9_form(
  p_token text,
  p_legal_name text,
  p_business_name text,
  p_entity_type public.firm_w9_entity_type,
  p_llc_tax_classification char,
  p_other_classification text,
  p_exempt_payee_code text,
  p_exempt_fatca_code text,
  p_address_line_1 text,
  p_address_line_2 text,
  p_address_city text,
  p_address_region text,
  p_address_postal_code text,
  p_tin_type public.firm_w9_tin_type,
  p_tin_digits text,
  p_signature_full_name text,
  p_signed_ip text,
  p_signed_ua text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
    -- Store verbatim: the app sends already-encrypted ciphertext.
    tin_digits = p_tin_digits,
    signed_at = now(),
    signed_ip = p_signed_ip,
    signed_user_agent = p_signed_ua,
    signature_full_name = p_signature_full_name,
    status = 'received',
    updated_at = now()
  where request_token = p_token
    and status in ('requested', 'received')
    and expires_at > now()
  returning id into v_w9_id;

  if v_w9_id is null then
    raise exception 'invalid_or_expired_token';
  end if;
  return v_w9_id;
end;
$$;
