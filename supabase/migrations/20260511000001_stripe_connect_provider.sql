-- Stripe Connect as a bank_connections provider.
--
-- Stripe isn't a bank, but for tax purposes a user's Stripe revenue
-- IS where they earn money. Plaid can't connect to Stripe (Stripe
-- isn't on Plaid's institution list), so we add Stripe as a
-- first-class provider on bank_connections and reuse the existing
-- account_transactions / review-and-apply pipeline.
--
-- One Stripe Connect connection = one Stripe Standard account. The
-- platform (Taxottic) gets a read-only access_token via OAuth; we
-- store it in bank_connection_secrets the same way we store Plaid
-- access tokens. Subsequent calls use Stripe's `Stripe-Account`
-- header rather than the access_token directly, but storing it lets
-- us call /v1/oauth/deauthorize cleanly when a user disconnects.

alter table public.bank_connections
  drop constraint if exists bank_connections_provider_check;

alter table public.bank_connections
  add constraint bank_connections_provider_check
    check (provider in ('plaid', 'teller', 'mx', 'manual', 'stripe'));

comment on column public.bank_connections.provider is
  'Aggregator backing this connection. plaid = traditional bank/card via Plaid; teller/mx reserved for future swaps; manual = CSV import + manual entry; stripe = Stripe Connect (payment processor as an income source).';
