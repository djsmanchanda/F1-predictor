import requests
import json

# Get all sessions for 2025
url_sessions = "https://api.openf1.org/v1/sessions?year=2025"
response_sessions = requests.get(url_sessions)
data_sessions = response_sessions.json()

# Filter for race sessions only and extract session keys
race_session_keys = [session['session_key'] for session in data_sessions if session['session_type'] == 'Race']

print(f"Total race sessions found: {len(race_session_keys)}")
print("Race session keys:")
for key in race_session_keys:
    print(key)