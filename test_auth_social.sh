#!/bin/bash

# Test script for Authentication & Social Layer
# This script tests user registration, login, friend management, and wager invitations

BASE_URL="http://localhost:8000"
echo "🧪 Testing Authentication & Social Layer"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to make requests
make_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local token=$4
    
    if [ -n "$token" ]; then
        if [ -n "$data" ]; then
            curl -s -X "$method" "$BASE_URL$endpoint" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $token" \
                -d "$data"
        else
            curl -s -X "$method" "$BASE_URL$endpoint" \
                -H "Authorization: Bearer $token"
        fi
    else
        if [ -n "$data" ]; then
            curl -s -X "$method" "$BASE_URL$endpoint" \
                -H "Content-Type: application/json" \
                -d "$data"
        else
            curl -s -X "$method" "$BASE_URL$endpoint"
        fi
    fi
}

# Helper function to extract values from JSON
extract_value() {
    local json=$1
    local key=$2
    echo "$json" | grep -o "\"$key\":\"[^\"]*\"" | cut -d'"' -f4
}

extract_uuid() {
    local json=$1
    local key=$2
    echo "$json" | grep -o "\"$key\":\"[a-f0-9-]*\"" | cut -d'"' -f4
}

# Test function
test_endpoint() {
    local test_name=$1
    local method=$2
    local endpoint=$3
    local data=$4
    local token=$5
    local expected_status=$6
    
    echo -e "${BLUE}Testing: $test_name${NC}"
    
    response=$(make_request "$method" "$endpoint" "$data" "$token")
    status_code=$(echo "$response" | tail -n1 | grep -o '[0-9]*$')
    
    if [ "$status_code" = "$expected_status" ]; then
        echo -e "${GREEN}✅ PASS${NC} - Status: $status_code"
        echo "Response: $response"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}❌ FAIL${NC} - Expected: $expected_status, Got: $status_code"
        echo "Response: $response"
        ((TESTS_FAILED++))
    fi
    echo ""
}

echo "📝 Step 1: User Registration"
echo "----------------------------"

# Register first user
echo "Registering user 1..."
user1_data='{"email":"testuser1@example.com","password":"password123","displayName":"TestUser1"}'
user1_response=$(make_request "POST" "/auth/register" "$user1_data")
user1_id=$(extract_uuid "$user1_response" "id")
echo "User 1 ID: $user1_id"

# Register second user
echo "Registering user 2..."
user2_data='{"email":"testuser2@example.com","password":"password123","displayName":"TestUser2"}'
user2_response=$(make_request "POST" "/auth/register" "$user2_data")
user2_id=$(extract_uuid "$user2_response" "id")
echo "User 2 ID: $user2_id"

echo ""
echo "🔐 Step 2: User Login"
echo "--------------------"

# Login user 1
echo "Logging in user 1..."
login1_data='{"email":"testuser1@example.com","password":"password123"}'
login1_response=$(make_request "POST" "/auth/login" "$login1_data")
user1_token=$(extract_value "$login1_response" "firebase_uid")
echo "User 1 Token: $user1_token"

# Login user 2
echo "Logging in user 2..."
login2_data='{"email":"testuser2@example.com","password":"password123"}'
login2_response=$(make_request "POST" "/auth/login" "$login2_data")
user2_token=$(extract_value "$login2_response" "firebase_uid")
echo "User 2 Token: $user2_token"

echo ""
echo "👤 Step 3: Profile Management"
echo "-----------------------------"

# Test getting user profile
test_endpoint "Get User Profile" "GET" "/auth/me" "" "$user1_token" "200"

echo ""
echo "👥 Step 4: Friend Management"
echo "----------------------------"

# Send friend request from user 1 to user 2
friend_request_data="{\"toUserId\":\"$user2_id\",\"message\":\"Hey, let's be friends!\"}"
test_endpoint "Send Friend Request" "POST" "/friends/request" "$friend_request_data" "$user1_token" "200"

# Get friend requests for user 2
test_endpoint "Get Friend Requests (User 2)" "GET" "/friends" "" "$user2_token" "200"

# Accept friend request (user 2 accepts from user 1)
# First, get the request ID from the response
requests_response=$(make_request "GET" "/friends" "" "$user2_token")
request_id=$(extract_uuid "$requests_response" "id")

if [ -n "$request_id" ]; then
    accept_request_data='{"action":"accept"}'
    test_endpoint "Accept Friend Request" "POST" "/friends/request/$request_id/respond" "$accept_request_data" "$user2_token" "200"
else
    echo -e "${YELLOW}⚠️  No friend request found to accept${NC}"
fi

# Get friends list for both users
test_endpoint "Get Friends List (User 1)" "GET" "/friends" "" "$user1_token" "200"
test_endpoint "Get Friends List (User 2)" "GET" "/friends" "" "$user2_token" "200"

echo ""
echo "🎮 Step 5: Wager Invitations"
echo "----------------------------"

# Send wager invitation from user 1 to user 2
wager_invite_data="{\"toUserId\":\"$user2_id\",\"stakeUsd\":25.00,\"gameType\":\"rainbow_six\",\"message\":\"1v1 me in Rainbow Six!\"}"
test_endpoint "Send Wager Invitation" "POST" "/wager/invite" "$wager_invite_data" "$user1_token" "200"

# Get wager invitations for user 2
test_endpoint "Get Wager Invitations (User 2)" "GET" "/wager/invitations" "" "$user2_token" "200"

# Accept wager invitation (user 2 accepts from user 1)
# First, get the invitation ID from the response
invitations_response=$(make_request "GET" "/wager/invitations" "" "$user2_token")
invitation_id=$(extract_uuid "$invitations_response" "id")

if [ -n "$invitation_id" ]; then
    accept_invite_data='{"action":"accept"}'
    test_endpoint "Accept Wager Invitation" "POST" "/wager/invite/$invitation_id/respond" "$accept_invite_data" "$user2_token" "200"
else
    echo -e "${YELLOW}⚠️  No wager invitation found to accept${NC}"
fi

echo ""
echo "🧪 Step 6: Error Handling Tests"
echo "-------------------------------"

# Test invalid login
invalid_login_data='{"email":"nonexistent@example.com","password":"wrongpassword"}'
test_endpoint "Invalid Login" "POST" "/auth/login" "$invalid_login_data" "" "401"

# Test duplicate friend request
test_endpoint "Duplicate Friend Request" "POST" "/friends/request" "$friend_request_data" "$user1_token" "409"

# Test sending friend request to self
self_friend_data="{\"toUserId\":\"$user1_id\",\"message\":\"Self friend request\"}"
test_endpoint "Self Friend Request" "POST" "/friends/request" "$self_friend_data" "$user1_token" "400"

# Test accessing protected endpoint without token
test_endpoint "Unauthorized Access" "GET" "/auth/me" "" "" "401"

echo ""
echo "📊 Test Results"
echo "==============="
echo -e "${GREEN}Tests Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Tests Failed: $TESTS_FAILED${NC}"
echo -e "Total Tests: $((TESTS_PASSED + TESTS_FAILED))"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed!${NC}"
    exit 1
fi 