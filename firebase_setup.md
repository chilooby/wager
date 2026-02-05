# Firebase Setup Guide for Wager App

## Step-by-Step Firebase Configuration

### 1. Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project" or "Add project"
3. Enter project name: `wager-app` (or your preferred name)
4. Choose whether to enable Google Analytics (optional)
5. Click "Create project"

### 2. Enable Authentication
1. In your Firebase project dashboard, click "Authentication" in the left sidebar
2. Click "Get started"
3. Go to the "Sign-in method" tab
4. Enable "Email/Password":
   - Click on "Email/Password"
   - Toggle "Enable"
   - Click "Save"

### 3. Get Firebase Configuration
1. Click the gear icon (⚙️) next to "Project Overview"
2. Select "Project settings"
3. Scroll down to "Your apps" section
4. Click the web icon (</>) to add a web app
5. Register app:
   - App nickname: `wager-backend`
   - Check "Also set up Firebase Hosting" (optional)
   - Click "Register app"
6. Copy the configuration object

### 4. Environment Variables
Create a `.env` file in your project root with these variables:

```env
# Firebase Configuration
FIREBASE_API_KEY=your_firebase_api_key_here
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id_here

# Supabase Configuration
SUPABASE_URL=your_supabase_project_url_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
SUPABASE_STORAGE_BUCKET=wager-results

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# Server Configuration
PORT=8000
```

### 5. Firebase Configuration Example
Your Firebase config will look like this:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyC...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

From this, extract:
- `FIREBASE_API_KEY`: The `apiKey` value
- `FIREBASE_AUTH_DOMAIN`: The `authDomain` value
- `FIREBASE_PROJECT_ID`: The `projectId` value

### 6. Optional: Enable Additional OAuth Providers
For future OAuth integration (Twitch, Xbox Live, PSN, Steam):

1. In Authentication > Sign-in method
2. Enable the providers you want:
   - **Google** (for testing)
   - **GitHub** (for testing)
   - **Twitter** (for testing)

### 7. Test Firebase Connection
After setting up, you can test the connection by running:
```bash
deno run --allow-net --allow-env --allow-read main.ts
```

Then test registration:
```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","displayName":"TestUser"}'
```

### 8. Firebase Security Rules (Optional)
For production, you might want to set up Firebase Security Rules:

1. Go to Firestore Database (if using)
2. Click "Rules" tab
3. Set up appropriate security rules

### 9. Firebase Functions (Future)
For advanced features, you can enable Firebase Functions:
1. Go to Functions in the sidebar
2. Click "Get started"
3. Follow the setup instructions

## Troubleshooting

### Common Issues:
1. **"Firebase App not initialized"**: Check your environment variables
2. **"Invalid API key"**: Verify the API key in your .env file
3. **"Project not found"**: Check the project ID and auth domain

### Verification Steps:
1. Check that all environment variables are set
2. Verify Firebase project is created and authentication is enabled
3. Test with a simple registration request
4. Check server logs for any Firebase-related errors 