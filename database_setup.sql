-- Database Setup for Wager App - Authentication & Social Layer
-- Run these commands in your Supabase SQL editor

-- 1. Add Firebase Auth fields to existing users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid text UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider text; -- 'email', 'twitch', 'xbox', 'psn', 'steam'
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_providers jsonb; -- Store multiple OAuth account IDs
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online boolean DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen timestamp with time zone DEFAULT now();

-- 2. Create friends table for bidirectional friendships
CREATE TABLE IF NOT EXISTS friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  friend_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, friend_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Create friend_requests table for pending friend requests
CREATE TABLE IF NOT EXISTS friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id text NOT NULL,
  to_user_id text NOT NULL,
  status text CHECK (status IN ('pending', 'accepted', 'declined')) DEFAULT 'pending',
  message text, -- Optional message with request
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(from_user_id, to_user_id),
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Create wager_invitations table for pending wager invitations
CREATE TABLE IF NOT EXISTS wager_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id text NOT NULL,
  to_user_id text NOT NULL,
  stake_usd integer NOT NULL, -- Amount in cents
  game_type text, -- e.g., 'rainbow_six', 'csgo', etc.
  message text, -- Optional message
  status text CHECK (status IN ('pending', 'accepted', 'declined', 'expired')) DEFAULT 'pending',
  expires_at timestamp with time zone DEFAULT (now() + interval '24 hours'),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 5. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_from_user_id ON friend_requests(from_user_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_to_user_id ON friend_requests(to_user_id);
CREATE INDEX IF NOT EXISTS idx_friend_requests_status ON friend_requests(status);
CREATE INDEX IF NOT EXISTS idx_wager_invitations_from_user_id ON wager_invitations(from_user_id);
CREATE INDEX IF NOT EXISTS idx_wager_invitations_to_user_id ON wager_invitations(to_user_id);
CREATE INDEX IF NOT EXISTS idx_wager_invitations_status ON wager_invitations(status);
CREATE INDEX IF NOT EXISTS idx_wager_invitations_expires_at ON wager_invitations(expires_at);
CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_users_online_status ON users(is_online);

-- 6. Create RLS (Row Level Security) policies for friends table
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own friends" ON friends
  FOR SELECT USING (
    user_id IN (
      SELECT id FROM users WHERE firebase_uid = auth.uid()
    )
  );

CREATE POLICY "Users can add friends" ON friends
  FOR INSERT WITH CHECK (
    user_id IN (
      SELECT id FROM users WHERE firebase_uid = auth.uid()
    )
  );

CREATE POLICY "Users can remove their own friends" ON friends
  FOR DELETE USING (
    user_id IN (
      SELECT id FROM users WHERE firebase_uid = auth.uid()
    )
  );

-- 7. Create RLS policies for friend_requests table
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view friend requests they sent or received" ON friend_requests
  FOR SELECT USING (
    from_user_id IN (
      SELECT id FROM users WHERE firebase_uid = auth.uid()
    ) OR to_user_id IN (
      SELECT id FROM users WHERE firebase_uid = auth.uid()
    )
  );

CREATE POLICY "Users can send friend requests" ON friend_requests
  FOR INSERT WITH CHECK (
    from_user_id IN (
      SELECT id FROM users WHERE firebase_uid = auth.uid()
    )
  );

CREATE POLICY "Users can update friend requests they received" ON friend_requests
  FOR UPDATE USING (
    to_user_id IN (
      SELECT id FROM users WHERE firebase_uid = auth.uid()
    )
  );

-- 8. Create RLS policies for wager_invitations table
ALTER TABLE wager_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view wager invitations they sent or received" ON wager_invitations
  FOR SELECT USING (
    from_user_id IN (
      SELECT id FROM users WHERE firebase_uid = auth.uid()
    ) OR to_user_id IN (
      SELECT id FROM users WHERE firebase_uid = auth.uid()
    )
  );

CREATE POLICY "Users can send wager invitations" ON wager_invitations
  FOR INSERT WITH CHECK (
    from_user_id IN (
      SELECT id FROM users WHERE firebase_uid = auth.uid()
    )
  );

CREATE POLICY "Users can update wager invitations they received" ON wager_invitations
  FOR UPDATE USING (
    to_user_id IN (
      SELECT id FROM users WHERE firebase_uid = auth.uid()
    )
  );

-- 9. Create function to update last_seen timestamp
CREATE OR REPLACE FUNCTION update_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  NEW.last_seen = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 10. Create trigger to automatically update last_seen
CREATE TRIGGER update_user_last_seen
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_last_seen();

-- 11. Create function to expire old wager invitations
CREATE OR REPLACE FUNCTION expire_old_invitations()
RETURNS void AS $$
BEGIN
  UPDATE wager_invitations 
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending' AND expires_at < now();
END;
$$ LANGUAGE plpgsql;

-- 12. Create a cron job to expire invitations (optional - can be done manually too)
-- SELECT cron.schedule('expire-invitations', '0 * * * *', 'SELECT expire_old_invitations();');

-- Verification queries (run these to check the setup)
-- SELECT 'Tables created successfully' as status;
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('friends', 'friend_requests', 'wager_invitations');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('firebase_uid', 'auth_provider', 'oauth_providers', 'profile_image_url', 'is_online', 'last_seen'); 