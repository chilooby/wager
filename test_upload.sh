#!/bin/bash

# Usage: ./test_upload.sh /path/to/photoA.jpg /path/to/photoB.jpg

set -e

if [ $# -ne 2 ]; then
  echo "Usage: $0 /path/to/photoA.jpg /path/to/photoB.jpg"
  exit 1
fi

PHOTO_A="$1"
PHOTO_B="$2"

API_URL="http://localhost:8000"
USER_A="cus_A"
USER_B="cus_B"

# 1. Create wager
echo "Creating wager..."
CREATE_RESP=$(curl -s -X POST "$API_URL/wager" \
  -H 'Content-Type: application/json' \
  -d '{"userA":"'$USER_A'","userB":"'$USER_B'","stakeUsd":10}')
echo "Create response: $CREATE_RESP"
WAGER_ID=$(echo "$CREATE_RESP" | grep -o '"wagerId":"[^"]*' | grep -o '[^"]*$')

if [ -z "$WAGER_ID" ]; then
  echo "Failed to create wager."
  exit 1
fi

echo "Wager ID: $WAGER_ID"

# 2. Upload result for User A
echo "Uploading result for $USER_A..."
UPLOAD_A=$(curl -s -X POST "$API_URL/wager/$WAGER_ID/upload-result" \
  -F "userId=$USER_A" \
  -F "image=@$PHOTO_A")
echo "Upload A response: $UPLOAD_A"

# 3. Upload result for User B
echo "Uploading result for $USER_B..."
UPLOAD_B=$(curl -s -X POST "$API_URL/wager/$WAGER_ID/upload-result" \
  -F "userId=$USER_B" \
  -F "image=@$PHOTO_B")
echo "Upload B response: $UPLOAD_B"

# 4. Check result status
echo "Checking result status..."
STATUS=$(curl -s "$API_URL/wager/$WAGER_ID/result-status")
echo "Result status: $STATUS" 