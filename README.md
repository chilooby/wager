# Wager Backend (Deno Oak)

Minimal peer-to-peer match wagering backend.

## Features
- Deno Oak server (PORT env, default 8000)
- In-memory store
- Stripe integration (PaymentIntent, Transfer, Webhook)

## Endpoints

### 1. Create Wager
```
curl -X POST http://localhost:8000/wager \
  -H 'Content-Type: application/json' \
  -d '{"userA":"cus_A","userB":"cus_B","stakeUsd":10}'
```
Response: `{ "wagerId": "..." }`

### 2. Attach Stake (PaymentIntent)
```
curl -X POST http://localhost:8000/wager/<wagerId>/stake \
  -H 'Content-Type: application/json' \
  -d '{"customerId":"cus_A","paymentMethodId":"pm_card_visa"}'
```
Response: `{ "paymentIntentId": "...", "status": "..." }`

### 3. Settle Wager (Admin)
```
curl -X POST http://localhost:8000/wager/<wagerId>/settle \
  -H 'Content-Type: application/json' \
  -d '{"winnerCustomerId":"cus_A"}'
```
Response: `{ "transferId": "...", "payoutUsd": 18 }`

### 4. Stripe Webhook
```
POST http://localhost:8000/stripe/webhook
```
Handles `payment_intent.succeeded` and `payout.paid` events.

## Stripe CLI Webhook (Local Dev)

1. [Install Stripe CLI](https://stripe.com/docs/stripe-cli)
2. Listen and forward events:
```
stripe listen --events payment_intent.succeeded,payout.paid --forward-to localhost:8000/stripe/webhook
```
3. Use test cards and triggers:
```
stripe trigger payment_intent.succeeded
stripe trigger payout.paid
```

## Dev

- Requires Deno, Denon, and Stripe CLI.
- Start: `deno task dev`
- Env: `PORT`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` 

## Wager Result Verification (User-Uploaded Photos)

### Database Schema

#### wager_results Table
```
CREATE TABLE wager_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wager_id uuid REFERENCES wagers(id),
  user_id uuid REFERENCES users(id),
  image_url text NOT NULL,
  uploaded_at timestamp with time zone DEFAULT now(),
  status text CHECK (status IN ('pending', 'verified', 'disputed')) DEFAULT 'pending'
);
```

#### wagers Table Update
```
ALTER TABLE wagers
ADD COLUMN verification_status text CHECK (verification_status IN ('pending', 'verified', 'disputed')) DEFAULT 'pending';
```

### Supabase Storage
- Create a bucket named `wager-results` for storing uploaded images.
- Store the image URL in the `wager_results` table.

### API Endpoints

#### POST `/wagers/:id/upload-result`
- Authenticated endpoint.
- Accepts image file upload (multipart/form-data).
- Stores image in Supabase Storage.
- Creates/updates a `wager_results` record for the user and wager.
- Triggers verification check (if both images present).

#### GET `/wagers/:id/result-status`
- Returns URLs of both users’ uploaded images (if present) and current verification status.

#### POST `/wagers/:id/dispute` (optional)
- Allows a user to flag a dispute if they believe the result is incorrect.

### Verification Logic
- When both users have uploaded images:
  - Mark `verification_status` as `verified`.
  - Trigger payout.
- If only one image is present, status remains `pending`.
- If a dispute is flagged, status becomes `disputed`. 

## Supabase Database Setup

### Table: wagers
```sql
CREATE TABLE wagers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a text NOT NULL,
  user_b text NOT NULL,
  stake_usd integer NOT NULL,
  verification_status text CHECK (verification_status IN ('pending', 'verified', 'disputed')) DEFAULT 'pending',
  created_at timestamp with time zone DEFAULT now()
);
```

### Table: wager_results
```sql
CREATE TABLE wager_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wager_id uuid REFERENCES wagers(id),
  user_id text NOT NULL,
  image_url text NOT NULL,
  uploaded_at timestamp with time zone DEFAULT now(),
  status text CHECK (status IN ('pending', 'verified', 'disputed')) DEFAULT 'pending'
);
```

### Supabase Environment Variables
Add these to your `.env` file:
```
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_STORAGE_BUCKET=wager-results
```

- Create a storage bucket in Supabase called `wager-results` for storing uploaded images.
- Use the service role key for backend operations (never expose it to the frontend). 