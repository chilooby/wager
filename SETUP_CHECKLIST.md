# 🎯 Wager App Setup Checklist

## ✅ Pre-Setup Requirements
- [ ] Node.js installed (for Firebase testing)
- [ ] Deno installed
- [ ] Git repository initialized
- [ ] Supabase account created
- [ ] Stripe account created (for payments)

## 🗄️ Database Setup (Supabase)
- [ ] Run SQL commands from `database_setup.sql` in Supabase SQL Editor
- [ ] Verify tables created: `friends`, `friend_requests`, `wager_invitations`
- [ ] Verify user table has new columns: `firebase_uid`, `auth_provider`, etc.
- [ ] Check Row Level Security (RLS) policies are active

## 🔥 Firebase Setup
- [ ] Create Firebase project at [Firebase Console](https://console.firebase.google.com/)
- [ ] Enable Authentication > Email/Password sign-in method
- [ ] Add web app to Firebase project
- [ ] Copy Firebase configuration (API Key, Auth Domain, Project ID)
- [ ] Create `.env` file with Firebase credentials

## 🔧 Environment Variables
Create `.env` file with:
- [ ] `FIREBASE_API_KEY`
- [ ] `FIREBASE_AUTH_DOMAIN`
- [ ] `FIREBASE_PROJECT_ID`
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `SUPABASE_STORAGE_BUCKET`
- [ ] `STRIPE_SECRET_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`
- [ ] `PORT=8000`

## 🧪 Testing Setup
- [ ] Install Node.js dependencies: `npm install firebase dotenv`
- [ ] Test Firebase connection: `node test_firebase_setup.js`
- [ ] Start Deno backend: `deno run --allow-net --allow-env --allow-read main.ts`
- [ ] Test backend endpoints with `test_auth_social.sh`

## 🚀 Quick Start Commands

### 1. Database Setup
```sql
-- Copy and paste database_setup.sql into Supabase SQL Editor
```

### 2. Firebase Setup
```bash
# Follow firebase_setup.md instructions
# Then test with:
node test_firebase_setup.js
```

### 3. Backend Testing
```bash
# Start backend
deno run --allow-net --allow-env --allow-read main.ts

# In another terminal, test endpoints
bash test_auth_social.sh
```

### 4. Manual Testing
```bash
# Test user registration
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","displayName":"TestUser"}'

# Test user login
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

## 🔍 Verification Steps

### Database Verification
```sql
-- Check tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('friends', 'friend_requests', 'wager_invitations');

-- Check user columns
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'users' 
AND column_name IN ('firebase_uid', 'auth_provider', 'oauth_providers', 'profile_image_url', 'is_online', 'last_seen');
```

### Firebase Verification
- [ ] Firebase project created
- [ ] Authentication enabled
- [ ] Email/Password sign-in method active
- [ ] Web app registered
- [ ] Configuration copied to `.env`

### Backend Verification
- [ ] Server starts without errors
- [ ] Registration endpoint responds
- [ ] Login endpoint responds
- [ ] Protected endpoints require authentication

## 🐛 Troubleshooting

### Common Issues:
1. **"Firebase App not initialized"**
   - Check environment variables
   - Verify Firebase project exists

2. **"Database connection failed"**
   - Check Supabase URL and service role key
   - Verify database tables exist

3. **"Authentication failed"**
   - Ensure Email/Password auth is enabled in Firebase
   - Check Firebase configuration

4. **"Permission denied"**
   - Verify RLS policies in Supabase
   - Check user authentication

## 📞 Support
- Firebase Docs: https://firebase.google.com/docs
- Supabase Docs: https://supabase.com/docs
- Deno Docs: https://deno.land/manual

## 🎉 Success Criteria
- [ ] User can register with email/password
- [ ] User can login and get profile
- [ ] User can send/accept friend requests
- [ ] User can send/accept wager invitations
- [ ] All endpoints return proper HTTP status codes
- [ ] Authentication middleware works correctly 