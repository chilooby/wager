-- Database schema for Wager app

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100),
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- OAuth providers table
CREATE TABLE IF NOT EXISTS oauth_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(50) NOT NULL, -- 'twitch', 'xbox', 'psn', 'steam'
    provider_id VARCHAR(255) NOT NULL,
    provider_username VARCHAR(255),
    access_token TEXT,
    refresh_token TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(provider, provider_id)
);

-- Friend relationships table
CREATE TABLE IF NOT EXISTS friendships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'blocked'
    created_at TIMESTAMP DEFAULT NOW(),
    accepted_at TIMESTAMP,
    UNIQUE(user_id, friend_id),
    CHECK (user_id != friend_id)
);

-- Wagers table (extending existing in-memory structure)
CREATE TABLE IF NOT EXISTS wagers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id UUID NOT NULL REFERENCES users(id),
    user_b_id UUID NOT NULL REFERENCES users(id),
    stake_usd DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'active', 'settled', 'cancelled'
    winner_id UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    accepted_at TIMESTAMP,
    settled_at TIMESTAMP,
    CHECK (user_a_id != user_b_id)
);

-- Wager payment intents table
CREATE TABLE IF NOT EXISTS wager_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wager_id UUID NOT NULL REFERENCES wagers(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    stripe_payment_intent_id VARCHAR(255) NOT NULL,
    amount_cents INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Wager invites/requests table
CREATE TABLE IF NOT EXISTS wager_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_user_id UUID NOT NULL REFERENCES users(id),
    to_user_id UUID NOT NULL REFERENCES users(id),
    stake_usd DECIMAL(10, 2) NOT NULL,
    message TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'accepted', 'declined', 'expired'
    expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
    created_at TIMESTAMP DEFAULT NOW(),
    responded_at TIMESTAMP,
    CHECK (from_user_id != to_user_id)
);

-- Indexes for performance
CREATE INDEX idx_oauth_providers_user_id ON oauth_providers(user_id);
CREATE INDEX idx_friendships_user_id ON friendships(user_id);
CREATE INDEX idx_friendships_friend_id ON friendships(friend_id);
CREATE INDEX idx_wagers_user_a_id ON wagers(user_a_id);
CREATE INDEX idx_wagers_user_b_id ON wagers(user_b_id);
CREATE INDEX idx_wager_requests_from_user ON wager_requests(from_user_id);
CREATE INDEX idx_wager_requests_to_user ON wager_requests(to_user_id);