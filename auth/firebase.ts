import { initializeApp, cert, ServiceAccount } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

// Initialize Firebase Admin SDK
let firebaseApp: any;

export function initFirebase() {
  if (!firebaseApp) {
    // Get Firebase service account credentials from environment
    const serviceAccount: ServiceAccount = {
      projectId: Deno.env.get("FIREBASE_PROJECT_ID") || "",
      clientEmail: Deno.env.get("FIREBASE_CLIENT_EMAIL") || "",
      privateKey: (Deno.env.get("FIREBASE_PRIVATE_KEY") || "").replace(/\\n/g, "\n"),
    };

    firebaseApp = initializeApp({
      credential: cert(serviceAccount),
    });
  }
  return firebaseApp;
}

export function getFirebaseAuth() {
  initFirebase();
  return getAuth();
}

// Verify Firebase ID token
export async function verifyIdToken(idToken: string) {
  try {
    const auth = getFirebaseAuth();
    const decodedToken = await auth.verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error("Error verifying ID token:", error);
    return null;
  }
}

// Create custom token for OAuth providers
export async function createCustomToken(uid: string, claims?: Record<string, any>) {
  const auth = getFirebaseAuth();
  return await auth.createCustomToken(uid, claims);
}

// Link OAuth provider to existing user
export async function linkOAuthProvider(
  uid: string,
  provider: string,
  providerId: string,
  email?: string,
  displayName?: string,
  photoURL?: string,
) {
  const auth = getFirebaseAuth();
  
  const providerData = {
    uid: providerId,
    displayName,
    email,
    photoURL,
    providerId: provider,
  };

  try {
    await auth.updateUser(uid, {
      providerData: [providerData],
    });
    return true;
  } catch (error) {
    console.error("Error linking OAuth provider:", error);
    return false;
  }
}