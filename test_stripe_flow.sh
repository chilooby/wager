#!/bin/bash

# Usage: ./test_stripe_flow.sh <STAKE_USD>

set -e

STAKE="${1:-10}"
API_URL="http://localhost:8000"
USER_ID="245c448f-dcbe-41cc-8456-cb20931ac635"

echo "1. Onboarding User to Stripe Connect..."
ONBOARD=$(curl -s -X POST "$API_URL/stripe/onboard" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$USER_ID\"}")
echo "User onboarding URL: $(echo $ONBOARD | grep -o 'http[^"}]*')"

echo "2. Top up User's wallet..."
TOPUP=$(curl -s -X POST "$API_URL/wallet/topup" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$USER_ID\", \"amountUsd\":$STAKE}")
echo "User top-up clientSecret: $(echo $TOPUP | grep -o '\"clientSecret\":\"[^\"]*' | grep -o '[^:]*$' | tr -d '\"')"

echo "3. Creating wager..."
CREATE_WAGER=$(curl -s -X POST "$API_URL/wager" \
  -H "Content-Type: application/json" \
  -d "{\"userA\":\"$USER_ID\", \"userB\":\"$USER_ID\", \"stakeUsd\":$STAKE}")
WAGER_ID=$(echo "$CREATE_WAGER" | grep -o '"wagerId":"[^\"]*' | grep -o '[^:]*$' | tr -d '\"')
echo "Wager ID: $WAGER_ID"

echo "4. Locking funds for User..."
LOCK=$(curl -s -X POST "$API_URL/wager/$WAGER_ID/lock" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$USER_ID\", \"amountUsd\":$STAKE}")
echo "User lock response: $LOCK"

echo "5. Payout to winner..."
PAYOUT=$(curl -s -X POST "$API_URL/wager/$WAGER_ID/payout" \
  -H "Content-Type: application/json" \
  -d "{\"winnerUserId\":\"$USER_ID\"}")
echo "Payout response: $PAYOUT" 