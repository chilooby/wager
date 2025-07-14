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