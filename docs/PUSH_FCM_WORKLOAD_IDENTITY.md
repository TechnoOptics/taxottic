# FCM push without a service-account key (Workload Identity Federation)

`taxottic-llc` has the GCP org policy `iam.disableServiceAccountKeyCreation`
enforced, so you cannot download a service-account key for
`FCM_SERVICE_ACCOUNT_JSON`. Rather than relax that (sound) security control,
the FCM provider (`lib/push/providers.ts`) supports a **keyless** path:

```
Vercel function  --(OIDC token)-->  GCP STS  --(federated token)-->
  impersonate firebase-adminsdk SA  -->  FCM HTTP v1 send
```

No long-lived key is ever created or stored. Below is the one-time setup. The
code path activates automatically once the four env vars at the end are set
(and `FCM_SERVICE_ACCOUNT_JSON` is absent).

## 1. Turn on Vercel OIDC

Vercel → Project `taxottic` → Settings → Security → **OIDC Federation** → enable
(Team-level issuer). Every serverless function then receives a `VERCEL_OIDC_TOKEN`
env var automatically (no need to set it yourself). Note the token's:

- **Issuer**: `https://oidc.vercel.com/<team-slug>`
- **Audience** (default): `https://vercel.com/<team-slug>`
- **Subject**: `owner:<team>:project:taxottic:environment:production`

## 2. Create a Workload Identity Pool + provider (GCP console)

GCP Console → IAM & Admin → **Workload Identity Federation** → Create pool
(project `taxottic-llc`):

- Pool ID: `vercel-pool`
- Add provider → **OIDC**:
  - Provider ID: `vercel`
  - Issuer (URL): `https://oidc.vercel.com/<team-slug>`
  - Allowed audiences: `https://vercel.com/<team-slug>`
  - Attribute mapping: `google.subject = assertion.sub`
  - (Recommended) Attribute condition to lock it to this project + prod:
    `assertion.sub == "owner:<team>:project:taxottic:environment:production"`

## 3. Let the federated identity impersonate the Firebase SA

The Firebase Admin SA is `firebase-adminsdk-fbsvc@taxottic-llc.iam.gserviceaccount.com`
(shown on the Service accounts tab). Grant the pool principal the token-creator
role on it (Cloud Shell, or IAM UI):

```bash
gcloud iam service-accounts add-iam-policy-binding \
  firebase-adminsdk-fbsvc@taxottic-llc.iam.gserviceaccount.com \
  --project=taxottic-llc \
  --role=roles/iam.serviceAccountTokenCreator \
  --member="principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/vercel-pool/*"
```

Replace `<PROJECT_NUMBER>` with the numeric project number (Project settings →
General, or `gcloud projects describe taxottic-llc --format='value(projectNumber)'`).
The `firebase-adminsdk` SA already has FCM send permission, so no extra role is
needed for messaging itself.

## 4. Set the env vars in Vercel (production)

```bash
cd ~/Projects/taxottic
printf '//iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/vercel-pool/providers/vercel' \
  | vercel env add GCP_WIF_AUDIENCE production
printf 'firebase-adminsdk-fbsvc@taxottic-llc.iam.gserviceaccount.com' \
  | vercel env add GCP_WIF_SERVICE_ACCOUNT production
printf 'taxottic-llc' | vercel env add FCM_PROJECT_ID production
```

`VERCEL_OIDC_TOKEN` is injected by Vercel automatically (step 1); do not set it.
Redeploy so the new env is live. Then `POST /api/push/test` from a signed-in
session with an Android device registered: the diagnostic's
`providers.fcmConfigured` should read `true` and a banner should arrive.

## Notes

- The provider caches the impersonated token ~55 min, independent of the
  per-request OIDC token.
- If `FCM_SERVICE_ACCOUNT_JSON` is ever set, it takes priority over WIF.
- This is the same trust model Google recommends over downloadable keys, so it
  is worth keeping even if the org policy is later relaxed.
