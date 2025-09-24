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