-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    stripe_customer_id TEXT,
    balance DECIMAL(10, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wagers table
CREATE TABLE IF NOT EXISTS public.wagers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    participant_a_id UUID NOT NULL REFERENCES public.users(id),
    participant_b_id UUID NOT NULL REFERENCES public.users(id),
    amount DECIMAL(10, 2) NOT NULL CHECK (amount > 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
    winner_id UUID REFERENCES public.users(id),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    settled_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT different_participants CHECK (participant_a_id != participant_b_id)
);

-- Transactions table
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id),
    wager_id UUID REFERENCES public.wagers(id),
    type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'wager_stake', 'wager_payout', 'fee')),
    amount DECIMAL(10, 2) NOT NULL,
    stripe_payment_intent_id TEXT,
    stripe_transfer_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_wagers_participant_a ON public.wagers(participant_a_id);
CREATE INDEX idx_wagers_participant_b ON public.wagers(participant_b_id);
CREATE INDEX idx_wagers_status ON public.wagers(status);
CREATE INDEX idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX idx_transactions_wager_id ON public.transactions(wager_id);
CREATE INDEX idx_transactions_status ON public.transactions(status);

-- Updated at trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to tables
CREATE TRIGGER set_updated_at_users
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_wagers
    BEFORE UPDATE ON public.wagers
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_transactions
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

-- Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wagers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users
CREATE POLICY "Users can view their own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- RLS Policies for wagers
CREATE POLICY "Users can view their own wagers" ON public.wagers
    FOR SELECT USING (auth.uid() = participant_a_id OR auth.uid() = participant_b_id);

CREATE POLICY "Users can create wagers" ON public.wagers
    FOR INSERT WITH CHECK (auth.uid() = participant_a_id);

-- RLS Policies for transactions
CREATE POLICY "Users can view their own transactions" ON public.transactions
    FOR SELECT USING (auth.uid() = user_id);