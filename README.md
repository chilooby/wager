
## Payment, Escrow, and Payouts (Stripe Connect)

### Payment Flow Overview
1. **Wallet Top-Up:**
   - Users can top up their in-app wallet using Stripe Payment Intents (card, Apple/Google Pay).
2. **Escrow:**
   - When a wager is created, both users' stakes are locked in escrow using Stripe Connect (Custom accounts).
3. **Payout:**
   - After match verification, the winner receives the pot (minus house fee) via instant payout to their Stripe account.
4. **KYC/AML:**
   - Users must complete KYC/AML onboarding via Stripe before they can receive payouts.

### Endpoints (to be implemented)
- `POST /wallet/topup` — Initiate a wallet top-up (Stripe Payment Intent)
- `POST /wager/:id/lock` — Lock funds for a wager (move to escrow)
- `POST /wager/:id/payout` — Payout to winner (minus house fee)
- `POST /stripe/onboard` — Start KYC/AML onboarding for user

### Stripe Connect Setup
- Use Stripe Connect Custom accounts for each user.
- Store each user's Stripe account ID in the database.
- Use Payment Intents for wallet top-up and escrow.
- Use Transfers or Payouts for winner payout.
- Use Stripe's onboarding flow for KYC/AML compliance.

### House Fee
- Deduct a configurable percentage (e.g., 10%) from the pot before payout. 

## Users Table Schema (for Stripe Connect)

Add a column to store each user's Stripe Connect account ID:

```sql
ALTER TABLE users ADD COLUMN stripe_account_id text;
```

- `stripe_account_id`: The Stripe Connect Custom account ID for the user (e.g., acct_123...).
- Store this value after onboarding the user with Stripe Connect.

### KYC/AML Status Tracking

Add columns to track KYC verification status:

```sql
ALTER TABLE users ADD COLUMN kyc_status text CHECK (kyc_status IN ('not_started', 'pending', 'verified', 'rejected')) DEFAULT 'not_started';
ALTER TABLE users ADD COLUMN kyc_requirements jsonb;
```

- `kyc_status`: Current KYC verification status
- `kyc_requirements`: JSON object containing Stripe's verification requirements (currently_due, eventually_due, etc.)

### Complete Users Table Schema

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  display_name text,
  stripe_account_id text,
  stripe_customer_id text,
  kyc_status text CHECK (kyc_status IN ('not_started', 'pending', 'verified', 'rejected')) DEFAULT 'not_started',
  kyc_requirements jsonb,
  created_at timestamp with time zone DEFAULT now()
);
``` 

## Complete Payment Flow & Escrow Logic

### Overview
The Wager app implements a peer-to-peer wagering system with automated escrow and payout using Stripe Connect. Users place wagers on game outcomes, funds are held in escrow, and winners receive payouts automatically after match verification.

### Payment Flow Architecture

```
1. User Registration & KYC
   ├── User creates account
   ├── User completes Stripe Connect onboarding (KYC/AML)
   └── User receives Stripe Connect account ID

2. Wallet Management
   ├── User tops up wallet via Stripe Payment Intent
   ├── Funds added to user's in-app wallet balance
   └── User can view transaction history

3. Wager Creation & Escrow
   ├── User A creates wager with User B
   ├── Both users lock funds (Payment Intents created)
   ├── Funds held in escrow until match completion
   └── Wager status: "pending_verification"

4. Match Verification
   ├── Both users upload match result screenshots
   ├── Backend verifies both images are uploaded
   ├── Wager status: "verified"
   └── Automatic payout triggered

5. Payout Processing
   ├── Winner receives payout (stake * 2 - 10% house fee)
   ├── Funds transferred to winner's Stripe Connect account
   ├── Wager status: "completed"
   └── Transaction recorded in database
```

### API Endpoints

#### User Management & KYC
- `POST /stripe/onboard` - Start Stripe Connect onboarding
- `GET /user/:id/kyc-status` - Check KYC verification status

#### Wallet Operations
- `POST /wallet/topup` - Add funds to wallet
- `GET /wallet/balance` - Get current wallet balance (future)
- `GET /wallet/transactions` - Get transaction history (future)

#### Wager Management
- `POST /wager` - Create new wager
- `POST /wager/:id/lock` - Lock funds for wager
- `GET /wager/:id/status` - Get wager status (future)

#### Match Verification
- `POST /wager/:id/upload-result` - Upload match result image
- `GET /wager/:id/result-status` - Check verification status

#### Payout
- `POST /wager/:id/payout` - Process payout to winner

### Escrow Implementation Details

#### Fund Locking Process
1. **Payment Intent Creation**: When a user locks funds, a Stripe Payment Intent is created
2. **Escrow Simulation**: For MVP, Payment Intents serve as escrow (not actual escrow)
3. **Status Tracking**: Wager status tracks fund locking progress
4. **Verification Trigger**: Both users must lock funds before verification can proceed

#### Payout Calculation
```javascript
const grossPayout = wager.stake_usd * 2;  // Both users' stakes
const houseFee = grossPayout * 0.10;      // 10% house fee
const netPayout = grossPayout - houseFee; // Winner receives this amount
```

#### House Fee Structure
- **Rate**: 10% of total wager amount
- **Calculation**: Applied to gross payout (stake * 2)
- **Example**: $10 wager → $20 gross → $18 net payout to winner

### Database Schema

#### Users Table
```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  display_name text,
  stripe_account_id text,      -- Stripe Connect account
  stripe_customer_id text,     -- Stripe Customer for payments
  kyc_status text DEFAULT 'not_started',
  kyc_requirements jsonb,
  wallet_balance integer DEFAULT 0,  -- In cents
  created_at timestamp with time zone DEFAULT now()
);
```

#### Wagers Table
```sql
CREATE TABLE wagers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a text NOT NULL,           -- User A ID
  user_b text NOT NULL,           -- User B ID
  stake_usd integer NOT NULL,     -- Stake amount in cents
  status text DEFAULT 'pending',  -- pending, locked, verified, completed
  verification_status text DEFAULT 'pending',
  winner_id text,                 -- Winner user ID
  created_at timestamp with time zone DEFAULT now()
);
```

#### Wager Results Table
```sql
CREATE TABLE wager_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wager_id uuid REFERENCES wagers(id),
  user_id text NOT NULL,
  image_url text NOT NULL,
  uploaded_at timestamp with time zone DEFAULT now(),
  status text DEFAULT 'pending'
);
```

### Security & Compliance

#### KYC/AML Requirements
- All users must complete Stripe Connect onboarding
- KYC verification required before receiving payouts
- Status tracked in database with real-time updates

#### Payment Security
- Stripe Payment Intents for secure payment processing
- Webhook verification for payment confirmations
- No sensitive payment data stored locally

#### Escrow Security
- Funds held by Stripe (not in app)
- Payment Intents provide escrow-like functionality
- Automatic payout prevents manual intervention

### Error Handling

#### Common Error Scenarios
1. **Insufficient Funds**: User tries to lock more than wallet balance
2. **KYC Incomplete**: User tries to receive payout without verification
3. **Verification Failed**: Match results don't match between users
4. **Payment Failed**: Stripe payment processing errors

#### Error Responses
- `400 Bad Request`: Invalid request data
- `404 Not Found`: User/wager not found
- `409 Conflict`: Wager already completed
- `500 Internal Server Error`: Stripe API errors

### Testing

#### Test Scripts
- `test_stripe_flow.sh` - Complete payment flow testing
- `test_kyc_flow.sh` - KYC onboarding testing
- `test_upload.sh` - Match verification testing

#### Test Data
- Use Stripe test cards for payments
- Test KYC data for verification
- Mock images for result uploads

### Production Considerations

#### Stripe Configuration
- Switch to live mode keys for production
- Configure webhook endpoints for production URLs
- Set up proper error monitoring

#### Scaling Considerations
- Implement proper wallet balance tracking
- Add transaction history endpoints
- Consider real escrow service for larger amounts

#### Compliance
- Ensure KYC/AML compliance for target jurisdictions
- Implement proper record keeping
- Add admin override capabilities for disputes 

## Authentication & Social Layer Schema

### Enhanced Users Table (Firebase Auth Integration)

```sql
-- Add Firebase Auth fields to existing users table
ALTER TABLE users ADD COLUMN firebase_uid text UNIQUE;
ALTER TABLE users ADD COLUMN auth_provider text; -- 'email', 'twitch', 'xbox', 'psn', 'steam'
ALTER TABLE users ADD COLUMN oauth_providers jsonb; -- Store multiple OAuth account IDs
ALTER TABLE users ADD COLUMN profile_image_url text;
ALTER TABLE users ADD COLUMN is_online boolean DEFAULT false;
ALTER TABLE users ADD COLUMN last_seen timestamp with time zone DEFAULT now();
```

### Friends Table

```sql
CREATE TABLE friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  friend_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, friend_id)
);
```

### Friend Requests Table

```sql
CREATE TABLE friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id text NOT NULL,
  to_user_id text NOT NULL,
  status text CHECK (status IN ('pending', 'accepted', 'declined')) DEFAULT 'pending',
  message text, -- Optional message with request
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(from_user_id, to_user_id)
);
```

### Wager Invitations Table

```sql
CREATE TABLE wager_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id text NOT NULL,
  to_user_id text NOT NULL,
  stake_usd integer NOT NULL,
  game_type text, -- e.g., 'rainbow_six', 'csgo', etc.
  message text, -- Optional message
  status text CHECK (status IN ('pending', 'accepted', 'declined', 'expired')) DEFAULT 'pending',
  expires_at timestamp with time zone DEFAULT (now() + interval '24 hours'),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
```

### Complete Users Table Schema (Updated)

```sql
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  display_name text,
  firebase_uid text UNIQUE,
  auth_provider text,
  oauth_providers jsonb,
  profile_image_url text,
  is_online boolean DEFAULT false,
  last_seen timestamp with time zone DEFAULT now(),
  stripe_account_id text,
  stripe_customer_id text,
  kyc_status text DEFAULT 'not_started',
  kyc_requirements jsonb,
  wallet_balance integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);
``` 

## Setup Instructions

### 1. Database Setup
Run these SQL commands in your Supabase SQL editor to create the required tables:

```sql
-- Add Firebase Auth fields to existing users table
ALTER TABLE users ADD COLUMN firebase_uid text UNIQUE;
ALTER TABLE users ADD COLUMN auth_provider text;
ALTER TABLE users ADD COLUMN oauth_providers jsonb;
ALTER TABLE users ADD COLUMN profile_image_url text;
ALTER TABLE users ADD COLUMN is_online boolean DEFAULT false;
ALTER TABLE users ADD COLUMN last_seen timestamp with time zone DEFAULT now();

-- Create friends table
CREATE TABLE friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  friend_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, friend_id)
);

-- Create friend_requests table
CREATE TABLE friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id text NOT NULL,
  to_user_id text NOT NULL,
  status text CHECK (status IN ('pending', 'accepted', 'declined')) DEFAULT 'pending',
  message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(from_user_id, to_user_id)
);

-- Create wager_invitations table
CREATE TABLE wager_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id text NOT NULL,
  to_user_id text NOT NULL,
  stake_usd integer NOT NULL,
  game_type text,
  message text,
  status text CHECK (status IN ('pending', 'accepted', 'declined', 'expired')) DEFAULT 'pending',
  expires_at timestamp with time zone DEFAULT (now() + interval '24 hours'),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
```

### 2. Firebase Setup
1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Authentication and add Email/Password sign-in method
3. Get your Firebase configuration:
   - Go to Project Settings > General
   - Copy the API Key, Auth Domain, and Project ID
   - Add them to your `.env` file

### 3. Environment Variables
Add these to your `.env` file:
```
# Firebase Configuration
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id

# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_STORAGE_BUCKET=wager-results

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

### 4. Running the Backend
```bash
deno run --allow-net --allow-env --allow-read main.ts
```

### 5. Testing the Authentication & Social Layer
On Windows, you can run the test script using Git Bash or WSL:
```bash
# Using Git Bash
./test_auth_social.sh

# Or using bash directly
bash test_auth_social.sh
```

The test script will:
- Register two test users
- Test login functionality
- Test friend request flow
- Test wager invitation flow
- Test error handling

## API Endpoints

### Authentication Endpoints

#### POST /auth/register
Register a new user with email/password.
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "displayName": "Gamer123"
}
```
**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "display_name": "Gamer123"
  },
  "firebase_uid": "firebase_user_id"
}
```

#### POST /auth/login
Login with email/password.
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```
**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "display_name": "Gamer123",
    "profile_image_url": "https://...",
    "is_online": true
  },
  "firebase_uid": "firebase_user_id"
}
```

#### GET /auth/me
Get current user profile (requires Firebase token).
**Headers:** `Authorization: Bearer <firebase_id_token>`
**Response:**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "display_name": "Gamer123",
    "profile_image_url": "https://...",
    "is_online": true,
    "last_seen": "2024-01-01T12:00:00Z",
    "kyc_status": "verified"
  }
}
```

### Friend Management Endpoints

#### GET /friends
Get user's friends list (requires Firebase token).
**Headers:** `Authorization: Bearer <firebase_id_token>`
**Response:**
```json
{
  "friends": [
    {
      "id": "uuid",
      "display_name": "Friend123",
      "email": "friend@example.com",
      "profile_image_url": "https://...",
      "is_online": true,
      "last_seen": "2024-01-01T12:00:00Z"
    }
  ]
}
```

#### POST /friends/request
Send a friend request (requires Firebase token).
**Headers:** `Authorization: Bearer <firebase_id_token>`
```json
{
  "toUserId": "target_user_uuid",
  "message": "Hey, let's play together!"
}
```
**Response:**
```json
{
  "request": {
    "id": "uuid",
    "from_user_id": "current_user_uuid",
    "to_user_id": "target_user_uuid",
    "status": "pending",
    "message": "Hey, let's play together!",
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

#### POST /friends/request/:requestId/respond
Respond to a friend request (requires Firebase token).
**Headers:** `Authorization: Bearer <firebase_id_token>`
```json
{
  "action": "accept" // or "decline"
}
```
**Response:**
```json
{
  "request": {
    "id": "uuid",
    "status": "accepted",
    "updated_at": "2024-01-01T12:00:00Z"
  }
}
```

### Wager Invitation Endpoints

#### POST /wager/invite
Send a wager invitation (requires Firebase token).
**Headers:** `Authorization: Bearer <firebase_id_token>`
```json
{
  "toUserId": "target_user_uuid",
  "stakeUsd": 50.00,
  "gameType": "rainbow_six",
  "message": "1v1 me in Rainbow Six!"
}
```
**Response:**
```json
{
  "invitation": {
    "id": "uuid",
    "from_user_id": "current_user_uuid",
    "to_user_id": "target_user_uuid",
    "stake_usd": 5000,
    "game_type": "rainbow_six",
    "message": "1v1 me in Rainbow Six!",
    "status": "pending",
    "expires_at": "2024-01-02T12:00:00Z",
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

#### GET /wager/invitations
Get user's wager invitations (requires Firebase token).
**Headers:** `Authorization: Bearer <firebase_id_token>`
**Response:**
```json
{
  "received": [
    {
      "id": "uuid",
      "stake_usd": 5000,
      "game_type": "rainbow_six",
      "message": "1v1 me!",
      "created_at": "2024-01-01T12:00:00Z",
      "expires_at": "2024-01-02T12:00:00Z",
      "users": {
        "id": "uuid",
        "display_name": "Challenger123",
        "email": "challenger@example.com",
        "profile_image_url": "https://..."
      }
    }
  ],
  "sent": [
    {
      "id": "uuid",
      "stake_usd": 2500,
      "game_type": "csgo",
      "message": "Let's play CS:GO!",
      "status": "pending",
      "created_at": "2024-01-01T12:00:00Z",
      "expires_at": "2024-01-02T12:00:00Z",
      "users": {
        "id": "uuid",
        "display_name": "Target123",
        "email": "target@example.com",
        "profile_image_url": "https://..."
      }
    }
  ]
}
```

#### POST /wager/invite/:invitationId/respond
Respond to a wager invitation (requires Firebase token).
**Headers:** `Authorization: Bearer <firebase_id_token>`
```json
{
  "action": "accept" // or "decline"
}
```
**Response (accepted):**
```json
{
  "invitation": {
    "id": "uuid",
    "status": "accepted",
    "updated_at": "2024-01-01T12:00:00Z"
  },
  "wager": {
    "id": "new_wager_uuid"
  }
}
```

**Response (declined):**
```json
{
  "invitation": {
    "id": "uuid",
    "status": "declined",
    "updated_at": "2024-01-01T12:00:00Z"
  }
} 