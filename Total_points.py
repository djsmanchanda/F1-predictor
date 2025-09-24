import requests
import json
import os

# Persistent cache file
CACHE_FILE = 'api_cache.json'

# Load cache from file if it exists
api_cache = {}
if os.path.exists(CACHE_FILE):
    try:
        with open(CACHE_FILE, 'r') as f:
            api_cache = json.load(f)
    except (json.JSONDecodeError, IOError):
        api_cache = {}

def save_cache():
    try:
        with open(CACHE_FILE, 'w') as f:
            json.dump(api_cache, f, indent=2)
    except IOError:
        pass  # Silently fail if can't save

def cached_get(url):
    if url in api_cache:
        return api_cache[url]
    session = requests.Session()
    response = session.get(url)
    data = response.json()
    api_cache[url] = data
    save_cache()  # Save after fetching new data
    return data

# Get race and sprint sessions for 2025
url_race_sessions = "https://api.openf1.org/v1/sessions?session_name=Race&year=2025"
url_sprint_sessions = "https://api.openf1.org/v1/sessions?session_name=Sprint&year=2025"
race_sessions_data = cached_get(url_race_sessions)
sprint_sessions_data = cached_get(url_sprint_sessions)

race_session_keys = [(session['session_key'], session['country_name']) for session in race_sessions_data]
sprint_session_keys = [(session['session_key'], session['country_name']) for session in sprint_sessions_data]
print(f"Total race sessions found: {len(race_session_keys)}")

# Get session results for top 10 positions
def session_result(session_key, n=10):
    url = f"https://api.openf1.org/v1/session_result?session_key={session_key}&position<={n}"
    session_results = cached_get(url)
    session_results.sort(key=lambda x: int(x['position']))
    return session_results  # Return full dicts to access 'points'



print("Race session keys:")
for key in race_session_keys:
    print(key)
print(f"\nTotal sprint sessions found: {len(sprint_session_keys)}")
print("Sprint session keys:")
for key in sprint_session_keys:
    print(key)


print(f"\nRace results for session {race_session_keys[0]}:")
print("-" * 40)
results = session_result(race_session_keys[0][0])
for result in results:
    print(f"Position {result['position']}: Driver #{result['driver_number']} - {result['points']} points")

for key, country in sprint_session_keys:
    print(f"Sprint results for session {key} ({country}):")
    print("-" * 40)
    results = session_result(key, n=8)
    for result in results:
        print(f"Position {result['position']}: Driver #{result['driver_number']} - {result['points']} points")
    print("\n")

for key, country in race_session_keys:
    print(f"Race results for session {key} ({country}):")
    print("-" * 40)
    results = session_result(key, n=10)
    for result in results:
        print(f"Position {result['position']}: Driver #{result['driver_number']} - {result['points']} points")
    print("\n")
        
driver_points = {}
def add_points(session_keys, n):
    for key, country in session_keys:
        results = session_result(key, n=n)
        for result in results:
            driver_number = int(result['driver_number'])
            points = result['points']
            if driver_number in driver_points:
                driver_points[driver_number] += points
            else:
                driver_points[driver_number] = points

add_points(sprint_session_keys, 8)
add_points(race_session_keys, 10)
    
url_drivers = "https://api.jolpi.ca/ergast/f1/2025/drivers/"
ergast_data = cached_get(url_drivers)
driver_names = {}
for driver in ergast_data['MRData']['DriverTable']['Drivers']:
    permanent_number = int(driver['permanentNumber'])
    full_name = f"{driver['givenName']} {driver['familyName']}"
    driver_names[permanent_number] = full_name
sorted_driver_points = sorted(driver_points.items(), key=lambda x: x[1], reverse=True)

print("Total points per driver:")
for driver_number, points in sorted_driver_points:
    driver_name = driver_names.get(driver_number, f"Driver #{driver_number}")
    print(f"{driver_name} (#{driver_number}): {points} points")