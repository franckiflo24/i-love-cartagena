#!/usr/bin/env python3
"""
Backend API Testing for I ❤️ Cartagena Analytics Dashboard
Tests all analytics endpoints and core functionality.
"""

import requests
import json
import sys
from datetime import datetime

# Backend URL from environment
BACKEND_URL = "https://cartagena-week.preview.emergentagent.com/api"

def test_endpoint(method, endpoint, data=None, expected_status=200, description=""):
    """Test a single endpoint and return results."""
    url = f"{BACKEND_URL}{endpoint}"
    
    try:
        if method.upper() == "GET":
            response = requests.get(url, timeout=30)
        elif method.upper() == "POST":
            response = requests.post(url, json=data, timeout=30)
        else:
            return {"success": False, "error": f"Unsupported method: {method}"}
        
        success = response.status_code == expected_status
        
        result = {
            "success": success,
            "status_code": response.status_code,
            "description": description,
            "endpoint": endpoint,
            "method": method
        }
        
        if success:
            try:
                result["data"] = response.json()
            except:
                result["data"] = response.text
        else:
            result["error"] = f"Expected {expected_status}, got {response.status_code}"
            try:
                result["response_text"] = response.text
            except:
                result["response_text"] = "Could not decode response"
                
        return result
        
    except requests.exceptions.RequestException as e:
        return {
            "success": False,
            "error": f"Request failed: {str(e)}",
            "description": description,
            "endpoint": endpoint,
            "method": method
        }

def validate_analytics_dashboard_structure(data):
    """Validate the structure of the analytics dashboard response."""
    required_fields = [
        "kpis", "demographics", "daily_activity", "hourly_activity", 
        "funnel", "revenue", "top_events", "top_partners", "top_venues",
        "interactions_by_type", "events_per_season"
    ]
    
    missing_fields = []
    for field in required_fields:
        if field not in data:
            missing_fields.append(field)
    
    # Validate KPIs structure
    if "kpis" in data:
        required_kpis = [
            "total_users", "total_events", "total_partners", "total_interactions",
            "total_seasons", "total_passes", "booking_clicks", "total_revenue_cop",
            "transport_views", "map_views"
        ]
        for kpi in required_kpis:
            if kpi not in data["kpis"]:
                missing_fields.append(f"kpis.{kpi}")
    
    # Validate demographics structure
    if "demographics" in data:
        demo_fields = ["nationalities", "age_groups", "genders", "total_profiled"]
        for field in demo_fields:
            if field not in data["demographics"]:
                missing_fields.append(f"demographics.{field}")
    
    # Validate revenue structure
    if "revenue" in data:
        if "total_cop" not in data["revenue"]:
            missing_fields.append("revenue.total_cop")
        if "by_tier" not in data["revenue"]:
            missing_fields.append("revenue.by_tier")
    
    return missing_fields

def validate_analytics_summary_structure(data):
    """Validate the structure of the analytics summary response."""
    required_fields = [
        "total_users", "total_events", "total_partners", "top_events",
        "interactions_by_type", "events_per_season", "booking_clicks"
    ]
    
    missing_fields = []
    for field in required_fields:
        if field not in data:
            missing_fields.append(field)
    
    return missing_fields

def run_analytics_tests():
    """Run comprehensive tests for analytics endpoints."""
    print("🧪 Testing I ❤️ Cartagena Analytics Backend APIs")
    print("=" * 60)
    
    test_results = []
    
    # Test 1: Enhanced Analytics Dashboard
    print("\n📊 Testing Enhanced Analytics Dashboard...")
    result = test_endpoint(
        "GET", 
        "/analytics/dashboard",
        description="Enhanced analytics dashboard with comprehensive data"
    )
    
    if result["success"]:
        # Validate structure
        missing_fields = validate_analytics_dashboard_structure(result["data"])
        if missing_fields:
            result["success"] = False
            result["error"] = f"Missing required fields: {', '.join(missing_fields)}"
        else:
            print("✅ Dashboard structure validation passed")
            
            # Check data quality
            data = result["data"]
            kpis = data.get("kpis", {})
            demographics = data.get("demographics", {})
            
            print(f"   📈 Total Users: {kpis.get('total_users', 0)}")
            print(f"   🎉 Total Events: {kpis.get('total_events', 0)}")
            print(f"   🤝 Total Partners: {kpis.get('total_partners', 0)}")
            print(f"   💰 Total Revenue: ${kpis.get('total_revenue_cop', 0):,} COP")
            print(f"   👥 Demographics Profiles: {demographics.get('total_profiled', 0)}")
            print(f"   📅 Daily Activity Records: {len(data.get('daily_activity', []))}")
            print(f"   🕐 Hourly Activity Records: {len(data.get('hourly_activity', []))}")
    
    test_results.append(result)
    
    # Test 2: Original Analytics Summary (Backward Compatibility)
    print("\n📋 Testing Original Analytics Summary...")
    result = test_endpoint(
        "GET",
        "/analytics/summary", 
        description="Original analytics summary endpoint (backward compatibility)"
    )
    
    if result["success"]:
        missing_fields = validate_analytics_summary_structure(result["data"])
        if missing_fields:
            result["success"] = False
            result["error"] = f"Missing required fields: {', '.join(missing_fields)}"
        else:
            print("✅ Summary structure validation passed")
            data = result["data"]
            print(f"   📊 Total Users: {data.get('total_users', 0)}")
            print(f"   🎯 Top Events: {len(data.get('top_events', []))}")
            print(f"   📱 Booking Clicks: {data.get('booking_clicks', 0)}")
    
    test_results.append(result)
    
    # Test 3: Analytics Event Tracking
    print("\n📝 Testing Analytics Event Tracking...")
    tracking_data = {
        "event_type": "page_view",
        "target_id": "test_event_001",
        "target_type": "event",
        "metadata": {"test": True, "timestamp": datetime.now().isoformat()}
    }
    
    result = test_endpoint(
        "POST",
        "/analytics/track",
        data=tracking_data,
        description="Track analytics event"
    )
    
    if result["success"]:
        if result["data"].get("ok") == True:
            print("✅ Event tracking successful")
        else:
            result["success"] = False
            result["error"] = "Expected 'ok': True in response"
    
    test_results.append(result)
    
    # Test 4: Events Endpoint (Core functionality)
    print("\n🎉 Testing Events Endpoint...")
    result = test_endpoint(
        "GET",
        "/events",
        description="List all events"
    )
    
    if result["success"]:
        events = result["data"]
        if isinstance(events, list):
            print(f"✅ Events endpoint returned {len(events)} events")
        else:
            result["success"] = False
            result["error"] = "Expected array of events"
    
    test_results.append(result)
    
    # Test 5: Partners Endpoint
    print("\n🤝 Testing Partners Endpoint...")
    result = test_endpoint(
        "GET",
        "/partners",
        description="List all partners"
    )
    
    if result["success"]:
        partners = result["data"]
        if isinstance(partners, list):
            print(f"✅ Partners endpoint returned {len(partners)} partners")
        else:
            result["success"] = False
            result["error"] = "Expected array of partners"
    
    test_results.append(result)
    
    # Test 6: Seasons Endpoint
    print("\n📅 Testing Seasons Endpoint...")
    result = test_endpoint(
        "GET",
        "/seasons",
        description="List all seasons"
    )
    
    if result["success"]:
        seasons = result["data"]
        if isinstance(seasons, list):
            print(f"✅ Seasons endpoint returned {len(seasons)} seasons")
        else:
            result["success"] = False
            result["error"] = "Expected array of seasons"
    
    test_results.append(result)
    
    return test_results

def run_additional_endpoint_tests():
    """Test additional core endpoints for completeness."""
    print("\n🔍 Testing Additional Core Endpoints...")
    
    additional_tests = []
    
    # Test featured events
    result = test_endpoint(
        "GET",
        "/events/featured",
        description="Get featured events"
    )
    additional_tests.append(result)
    
    # Test event types
    result = test_endpoint(
        "GET", 
        "/event-types",
        description="Get available event types"
    )
    additional_tests.append(result)
    
    # Test partner categories
    result = test_endpoint(
        "GET",
        "/partner-categories", 
        description="Get partner categories"
    )
    additional_tests.append(result)
    
    # Test venues
    result = test_endpoint(
        "GET",
        "/venues",
        description="List all venues"
    )
    additional_tests.append(result)
    
    # Test city pass plans
    result = test_endpoint(
        "GET",
        "/city-pass/plans",
        description="Get city pass plans"
    )
    additional_tests.append(result)
    
    return additional_tests

def print_test_summary(test_results):
    """Print a comprehensive test summary."""
    print("\n" + "=" * 60)
    print("📋 TEST SUMMARY")
    print("=" * 60)
    
    total_tests = len(test_results)
    passed_tests = sum(1 for result in test_results if result["success"])
    failed_tests = total_tests - passed_tests
    
    print(f"Total Tests: {total_tests}")
    print(f"✅ Passed: {passed_tests}")
    print(f"❌ Failed: {failed_tests}")
    print(f"Success Rate: {(passed_tests/total_tests)*100:.1f}%")
    
    if failed_tests > 0:
        print("\n❌ FAILED TESTS:")
        for i, result in enumerate(test_results, 1):
            if not result["success"]:
                print(f"{i}. {result['method']} {result['endpoint']}")
                print(f"   Description: {result['description']}")
                print(f"   Error: {result['error']}")
                if 'response_text' in result:
                    print(f"   Response: {result['response_text'][:200]}...")
                print()
    
    print("\n✅ PASSED TESTS:")
    for i, result in enumerate(test_results, 1):
        if result["success"]:
            print(f"{i}. {result['method']} {result['endpoint']} - {result['description']}")

def main():
    """Main test execution."""
    print(f"🚀 Starting Backend API Tests")
    print(f"Backend URL: {BACKEND_URL}")
    print(f"Test Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Run analytics tests
    analytics_results = run_analytics_tests()
    
    # Run additional endpoint tests
    additional_results = run_additional_endpoint_tests()
    
    # Combine all results
    all_results = analytics_results + additional_results
    
    # Print summary
    print_test_summary(all_results)
    
    # Return exit code based on results
    failed_count = sum(1 for result in all_results if not result["success"])
    return 0 if failed_count == 0 else 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)