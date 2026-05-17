import requests
import json

def test_prediction():
    url = "http://localhost:8000/predict"
    
    # Test 1: Valid full data
    valid_data = {
        "age": 25,
        "weight": 60,
        "height": 160,
        "bmi": 23.4,
        "cycle": 0,
        "hairLoss": 0,
        "pimples": 0,
        "fastFood": 1,
        "skinDarkening": 0
    }
    print("Testing valid data...")
    try:
        response = requests.post(url, json=valid_data)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
    except Exception as e:
        print(f"Request failed (is ML service running?): {e}")

    # Test 2: Partial data (should not crash now)
    partial_data = {
        "age": 30,
        "weight": 70
    }
    print("\nTesting partial data...")
    try:
        response = requests.post(url, json=partial_data)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
    except Exception as e:
        print(f"Request failed: {e}")

    # Test 3: No data
    print("\nTesting no data...")
    try:
        response = requests.post(url, json={})
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    test_prediction()
