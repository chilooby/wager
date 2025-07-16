# Wager Backend API

A peer-to-peer wagering platform built with Deno, Oak, Supabase, and Stripe.

## Features

- **Authentication**: JWT-based auth using Supabase Auth
- **Database**: PostgreSQL via Supabase with real-time subscriptions
- **Payments**: Stripe integration for secure payment processing
- **API**: RESTful API built with Oak framework
- **Security**: Row Level Security (RLS) policies for data protection

## Setup

### Prerequisites

- Deno installed
- Supabase project created
- Stripe account with API keys

### Environment Variables

Create a `.env` file based on `.env.example`:

```bash
# Server Configuration
PORT=8000

# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_key

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# JWT Secret for Auth
JWT_SECRET=your_jwt_secret_key
```

### Database Setup

1. Run the SQL schema in `supabase/schema.sql` in your Supabase SQL editor
2. This will create the required tables, indexes, and RLS policies

### Running the Server

```bash
# Development
deno task dev

# Production
deno task start
```

## Database Schema

### Users Table
```sql
users
├── id (UUID, PK) - References auth.users
├── username (TEXT, UNIQUE)
├── email (TEXT, UNIQUE)
├── stripe_customer_id (TEXT)
├── balance (DECIMAL)
├── created_at (TIMESTAMPTZ)
└── updated_at (TIMESTAMPTZ)
```

### Wagers Table
```sql
wagers
├── id (UUID, PK)
├── participant_a_id (UUID, FK → users)
├── participant_b_id (UUID, FK → users)
├── amount (DECIMAL)
├── status (TEXT) - pending|active|completed|cancelled
├── winner_id (UUID, FK → users)
├── description (TEXT)
├── created_at (TIMESTAMPTZ)
├── settled_at (TIMESTAMPTZ)
└── updated_at (TIMESTAMPTZ)
```

### Transactions Table
```sql
transactions
├── id (UUID, PK)
├── user_id (UUID, FK → users)
├── wager_id (UUID, FK → wagers)
├── type (TEXT) - deposit|withdrawal|wager_stake|wager_payout|fee
├── amount (DECIMAL)
├── stripe_payment_intent_id (TEXT)
├── stripe_transfer_id (TEXT)
├── status (TEXT) - pending|processing|completed|failed
├── metadata (JSONB)
├── created_at (TIMESTAMPTZ)
└── updated_at (TIMESTAMPTZ)
```

## API Endpoints

### Health Check

```http
GET /health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "environment": {
    "supabase": true,
    "stripe": true
  }
}
```

### Authentication Endpoints

#### Sign Up
```http
POST /auth/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure_password",
  "username": "johndoe"
}
```

Response:
```json
{
  "user": { "id": "...", "email": "..." },
  "session": { "access_token": "...", "refresh_token": "..." }
}
```

#### Sign In
```http
POST /auth/signin
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "secure_password"
}
```

#### Sign Out
```http
POST /auth/signout
Authorization: Bearer {access_token}
```

#### Get Current User
```http
GET /auth/me
Authorization: Bearer {access_token}
```

### Wager Endpoints

#### Create Wager
```http
POST /wagers
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "participantBId": "uuid-of-participant-b",
  "amount": 50.00,
  "description": "Super Bowl winner bet"
}
```

Response:
```json
{
  "wager": {
    "id": "...",
    "participant_a_id": "...",
    "participant_b_id": "...",
    "amount": 50.00,
    "status": "pending",
    "created_at": "..."
  }
}
```

#### List Wagers
```http
GET /wagers?status=active
Authorization: Bearer {access_token}
```

Response:
```json
{
  "wagers": [
    {
      "id": "...",
      "participant_a": { "id": "...", "username": "..." },
      "participant_b": { "id": "...", "username": "..." },
      "amount": 50.00,
      "status": "active"
    }
  ]
}
```

#### Get Single Wager
```http
GET /wagers/{wagerId}
Authorization: Bearer {access_token}
```

#### Accept/Reject Wager
```http
PATCH /wagers/{wagerId}/respond
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "accept": true
}
```

#### Settle Wager
```http
POST /wagers/{wagerId}/settle
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "winnerId": "uuid-of-winner"
}
```

### Payment Endpoints

#### Create Payment for Wager Stake
```http
POST /payments/stake
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "wagerId": "uuid-of-wager",
  "paymentMethodId": "pm_card_visa"
}
```

Response:
```json
{
  "paymentIntentId": "pi_...",
  "status": "succeeded",
  "clientSecret": "pi_...secret..."
}
```

#### Process Wager Payout
```http
POST /payments/payout
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "wagerId": "uuid-of-wager"
}
```

Response:
```json
{
  "transferId": "tr_...",
  "payoutAmount": 90.00,
  "feeAmount": 10.00
}
```

#### Stripe Webhook
```http
POST /payments/webhook
Stripe-Signature: {webhook_signature}
```

Handles events:
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `transfer.paid`

#### List User Transactions
```http
GET /payments/transactions
Authorization: Bearer {access_token}
```

Response:
```json
{
  "transactions": [
    {
      "id": "...",
      "type": "wager_stake",
      "amount": 50.00,
      "status": "completed",
      "wager": { "id": "...", "description": "..." },
      "created_at": "..."
    }
  ]
}
```

## Wager Flow

1. **Create Wager**: User A creates a wager challenge for User B
2. **Accept/Reject**: User B accepts or rejects the wager
3. **Payment**: Both users submit payment via Stripe
4. **Competition**: Users compete/wait for outcome
5. **Settlement**: Winner is declared
6. **Payout**: Winner receives payout (minus 10% platform fee)

## Security

- All tables have Row Level Security (RLS) enabled
- Users can only view/modify their own data
- JWT tokens required for authenticated endpoints
- Webhook endpoints validate Stripe signatures

## Development

### Local Testing with Stripe CLI

```bash
# Install Stripe CLI
# https://stripe.com/docs/stripe-cli

# Forward webhooks to local server
stripe listen --events payment_intent.succeeded,transfer.paid \
  --forward-to localhost:8000/payments/webhook

# Test webhooks
stripe trigger payment_intent.succeeded
```

### Running Tests

```bash
deno test --allow-env --allow-net
```

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Error message here"
}
```

Common HTTP status codes:
- `200` - Success
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error 