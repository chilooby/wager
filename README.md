# Wager Backend (Deno Oak)

A peer-to-peer match wagering backend with authentication, social features, and payment processing.

## Features

### Authentication & User Management
- Firebase Auth integration for secure authentication
- Email/password registration and login
- OAuth integration with gaming platforms:
  - Twitch
  - Xbox Live
  - PlayStation Network (PSN)
  - Steam
- JWT-based authentication with Firebase ID tokens

### Social Features
- Friend system with requests and acceptance
- User search functionality
- Wager requests between friends
- Friend-only wager creation

### Wager System
- Create wagers between friends
- Stake management with Stripe PaymentIntents
- Wager settlement with automatic payout calculation (90% after 10% platform fee)
- PostgreSQL database for persistent storage

## Prerequisites

- Deno runtime
- PostgreSQL database
- Firebase project with Authentication enabled
- Stripe account
- OAuth app credentials for gaming platforms

## Setup

1. **Clone and install dependencies**
   ```bash
   git clone <repository>
   cd wager
   ```

2. **Set up PostgreSQL database**
   ```bash
   createdb wager_db
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Set up Firebase**
   - Create a Firebase project
   - Enable Authentication
   - Download service account credentials
   - Add credentials to .env

5. **Configure OAuth providers**
   - Register apps with each gaming platform
   - Add OAuth credentials to .env

6. **Run the application**
   ```bash
   deno task dev
   ```

## API Endpoints

### Authentication

#### Register new user
```
POST /auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "username": "gamer123",
  "displayName": "Gamer 123"
}
```

#### Login with Firebase ID token
```
POST /auth/login
Content-Type: application/json

{
  "idToken": "firebase-id-token-from-client"
}
```

#### OAuth login
```
GET /auth/oauth/:provider
```
Redirects to OAuth provider (twitch, xbox, psn, steam)

#### Link OAuth account
```
POST /auth/link/:provider
Authorization: Bearer <firebase-id-token>
```

### Social Features

#### Get friends list
```
GET /social/friends
Authorization: Bearer <firebase-id-token>
```

#### Get pending friend requests
```
GET /social/friends/pending
Authorization: Bearer <firebase-id-token>
```

#### Send friend request
```
POST /social/friends/request
Authorization: Bearer <firebase-id-token>
Content-Type: application/json

{
  "username": "friend123"
}
```

#### Respond to friend request
```
POST /social/friends/respond/:requestId
Authorization: Bearer <firebase-id-token>
Content-Type: application/json

{
  "accept": true
}
```

#### Remove friend
```
DELETE /social/friends/:friendId
Authorization: Bearer <firebase-id-token>
```

#### Search users
```
GET /social/search?q=username
Authorization: Bearer <firebase-id-token>
```

#### Get wager requests
```
GET /social/wager-requests
Authorization: Bearer <firebase-id-token>
```

#### Send wager request
```
POST /social/wager-requests
Authorization: Bearer <firebase-id-token>
Content-Type: application/json

{
  "toUserId": "uuid-of-friend",
  "stakeUsd": 10,
  "message": "Let's play!"
}
```

#### Respond to wager request
```
POST /social/wager-requests/respond/:requestId
Authorization: Bearer <firebase-id-token>
Content-Type: application/json

{
  "accept": true
}
```

### Wager Management

#### Create wager
```
POST /wager
Authorization: Bearer <firebase-id-token>
Content-Type: application/json

{
  "opponentId": "uuid-of-friend",
  "stakeUsd": 10
}
```

#### Get wager details
```
GET /wager/:wagerId
Authorization: Bearer <firebase-id-token>
```

#### Stake on wager
```
POST /wager/:wagerId/stake
Authorization: Bearer <firebase-id-token>
Content-Type: application/json

{
  "paymentMethodId": "pm_card_visa"
}
```

#### Settle wager (admin only)
```
POST /wager/:wagerId/settle
Authorization: Bearer <firebase-id-token>
Content-Type: application/json

{
  "winnerId": "uuid-of-winner"
}
```

### Webhooks

#### Stripe webhook
```
POST /stripe/webhook
```
Handles payment confirmations and payout events

## Database Schema

The application uses PostgreSQL with the following main tables:
- `users` - User accounts and profiles
- `oauth_providers` - Linked OAuth accounts
- `friendships` - Friend relationships
- `wagers` - Wager records
- `wager_payments` - Payment tracking
- `wager_requests` - Pending wager invitations

See `db/schema.sql` for complete schema.

## Development

### Project Structure
```
wager/
├── auth/           # Authentication modules
├── db/             # Database connection and schema
├── middleware/     # Express middleware
├── routes/         # API route handlers
├── deno.json       # Deno configuration
├── main.ts         # Application entry point
└── README.md       # This file
```

### Testing with Stripe CLI
```bash
stripe listen --events payment_intent.succeeded,payout.paid --forward-to localhost:8000/stripe/webhook
```

### Environment Variables
See `.env.example` for all required environment variables.

## Security Considerations

- All authenticated endpoints require valid Firebase ID tokens
- OAuth state parameters prevent CSRF attacks
- Friend-only wager creation prevents abuse
- Parameterized queries prevent SQL injection
- CORS configured for frontend origin only

## License

[Your License Here] 