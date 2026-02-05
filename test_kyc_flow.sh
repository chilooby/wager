#!/bin/bash

# Usage: ./test_kyc_flow.sh

set -e

API_URL="http://localhost:8000"
USER_ID="245c448f-dcbe-41cc-8456-cb20931ac635"

echo "=== KYC/AML Onboarding Flow Test ==="

echo "1. Check initial KYC status..."
INITIAL_STATUS=$(curl -s "$API_URL/user/$USER_ID/kyc-status")
echo "Initial status: $INITIAL_STATUS"

echo ""
echo "2. Start KYC onboarding..."
ONBOARD=$(curl -s -X POST "$API_URL/stripe/onboard" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$USER_ID\"}")
echo "Onboarding response: $ONBOARD"

echo ""
echo "3. Check KYC status after onboarding..."
AFTER_ONBOARD=$(curl -s "$API_URL/user/$USER_ID/kyc-status")
echo "Status after onboarding: $AFTER_ONBOARD"

echo ""
echo "4. Simulate account.updated webhook (manual check)..."
echo "Note: In production, this would be triggered by Stripe when user completes onboarding"
echo "You can manually check the status in your Stripe Dashboard:"
echo "- Go to Connect > Accounts"
echo "- Find the connected account"
echo "- Check verification status and requirements"

echo ""
echo "=== Test Complete ==="
echo ""
echo "Next steps:"
echo "1. Open the onboarding URL in your browser"
echo "2. Complete the KYC verification process"
echo "3. Check the status again with: curl $API_URL/user/$USER_ID/kyc-status" 