import requests
import json

# Get all sessions for 2025
url_sessions = "https://api.openf1.org/v1/sessions?year=2025"
response_sessions = requests.get(url_sessions)
data_sessions = response_sessions.json()

# Filter for race sessions only and extract session keys with country names
def get_session_keys(data_sessions):
    race_sessions = [(session['session_key'], session['country_name']) for session in data_sessions if session['session_name'] == 'Race']
    sprint_sessions = [(session['session_key'], session['country_name']) for session in data_sessions if session['session_name'] == 'Sprint']
    return race_sessions, sprint_sessions

race_session_keys, sprint_session_keys = get_session_keys(data_sessions)
print(f"Total race sessions found: {len(race_session_keys)}")

# Get session results for top 10 positions
def session_result(session_key, n=10):
    url = f"https://api.openf1.org/v1/session_result?session_key={session_key}&position<={n}"
    response = requests.get(url)
    session_results = response.json()
    session_results.sort(key=lambda x: int(x['position']))
    return [(int(result['position']), int(result['driver_number'])) for result in session_results]



print("Race session keys:")
for key in race_session_keys:
    print(key)
print(f"\nTotal sprint sessions found: {len(sprint_session_keys)}")
print("Sprint session keys:")
for key in sprint_session_keys:
    print(key)


print(f"\nRace results for session {race_session_keys[0]}:")
print("-" * 40)
for position, driver_number in session_result(race_session_keys[0][0]):
    print(f"Position {position}: Driver #{driver_number}")

for key, country in sprint_session_keys:
    print(f"Sprint results for session {key} ({country}):")
    print("-" * 40)
    for position, driver_number in session_result(key):
        print(f"Position {position}: Driver #{driver_number}")
    print("\n")

for key, country in race_session_keys:
    print(f"Race results for session {key} ({country}):")
    print("-" * 40)
    for position, driver_number in session_result(key):
        print(f"Position {position}: Driver #{driver_number}")
    print("\n")
    
race_position_points = {
    "1": 25,
    "2": 18,
    "3": 15,
    "4": 12,
    "5": 10,
    "6": 8,
    "7": 6,
    "8": 4,
    "9": 2,
    "10": 1
}
sprint_position_points = {
    "1": 8,
    "2": 7,
    "3": 6,
    "4": 5,
    "5": 4,
    "6": 3,
    "7": 2,
    "8": 1
}
        
driver_points = {}
def add_points(session_keys, points_dict):
    for key, country in session_keys:
        results = session_result(key, n=10)
        for position, driver_number in results:
            if str(position) in points_dict:
                points = points_dict[str(position)]
                if driver_number in driver_points:
                    driver_points[driver_number] += points
                else:
                    driver_points[driver_number] = points
add_points(sprint_session_keys, sprint_position_points)
add_points(race_session_keys, race_position_points)
sorted_driver_points = sorted(driver_points.items(), key=lambda x: x[1], reverse=True)
    
driver_names = {}
for driver_number in driver_points.keys():
    url = f"https://api.openf1.org/v1/drivers?driver_number={driver_number}"
    response = requests.get(url)
    driver_data = response.json()
    if driver_data:
        driver_names[driver_number] = driver_data[0]['full_name']
    else:
        driver_names[driver_number] = f"Driver #{driver_number}"

print("Total points per driver:")
for driver_number, points in sorted_driver_points:
    driver_name = driver_names.get(driver_number, f"Driver #{driver_number}")
    print(f"{driver_name} (#{driver_number}): {points} points")