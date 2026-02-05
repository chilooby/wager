// Test script to verify Firebase setup
// Run this with: node test_firebase_setup.js

const { initializeApp } = require('firebase/app');
const { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } = require('firebase/auth');
require('dotenv').config();

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
};

console.log('🔥 Testing Firebase Setup...');
console.log('============================');

// Check if environment variables are set
console.log('📋 Environment Variables Check:');
console.log(`FIREBASE_API_KEY: ${process.env.FIREBASE_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`FIREBASE_AUTH_DOMAIN: ${process.env.FIREBASE_AUTH_DOMAIN ? '✅ Set' : '❌ Missing'}`);
console.log(`FIREBASE_PROJECT_ID: ${process.env.FIREBASE_PROJECT_ID ? '✅ Set' : '❌ Missing'}`);

if (!process.env.FIREBASE_API_KEY || !process.env.FIREBASE_AUTH_DOMAIN || !process.env.FIREBASE_PROJECT_ID) {
  console.log('\n❌ Missing Firebase environment variables!');
  console.log('Please check your .env file and ensure all Firebase variables are set.');
  process.exit(1);
}

// Initialize Firebase
try {
  console.log('\n🚀 Initializing Firebase...');
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  console.log('✅ Firebase initialized successfully!');
  
  // Test user credentials
  const testEmail = 'test@example.com';
  const testPassword = 'password123';
  
  console.log('\n🧪 Testing Firebase Authentication...');
  
  // Try to create a test user
  createUserWithEmailAndPassword(auth, testEmail, testPassword)
    .then((userCredential) => {
      console.log('✅ User registration successful!');
      console.log(`User ID: ${userCredential.user.uid}`);
      
      // Try to sign in with the created user
      return signInWithEmailAndPassword(auth, testEmail, testPassword);
    })
    .then((userCredential) => {
      console.log('✅ User login successful!');
      console.log(`User ID: ${userCredential.user.uid}`);
      console.log('\n🎉 Firebase setup is working correctly!');
      console.log('You can now run your Deno backend with: deno run --allow-net --allow-env --allow-read main.ts');
    })
    .catch((error) => {
      if (error.code === 'auth/email-already-in-use') {
        console.log('⚠️  Test user already exists, trying to sign in...');
        
        // Try to sign in instead
        signInWithEmailAndPassword(auth, testEmail, testPassword)
          .then((userCredential) => {
            console.log('✅ User login successful!');
            console.log(`User ID: ${userCredential.user.uid}`);
            console.log('\n🎉 Firebase setup is working correctly!');
            console.log('You can now run your Deno backend with: deno run --allow-net --allow-env --allow-read main.ts');
          })
          .catch((loginError) => {
            console.log('❌ Login failed:', loginError.message);
            console.log('\n🔧 Troubleshooting:');
            console.log('1. Check your Firebase project settings');
            console.log('2. Ensure Email/Password authentication is enabled');
            console.log('3. Verify your environment variables');
          });
      } else {
        console.log('❌ Firebase test failed:', error.message);
        console.log('\n🔧 Troubleshooting:');
        console.log('1. Check your Firebase project settings');
        console.log('2. Ensure Email/Password authentication is enabled');
        console.log('3. Verify your environment variables');
      }
    });
    
} catch (error) {
  console.log('❌ Firebase initialization failed:', error.message);
  console.log('\n🔧 Troubleshooting:');
  console.log('1. Check your Firebase configuration');
  console.log('2. Verify your environment variables');
  console.log('3. Ensure your Firebase project exists');
} 