import requests
import json

def fetch_json(url: str):
    """Fetch JSON from a URL with basic resilience and diagnostics."""
    try:
        resp = requests.get(url, timeout=15)
    except Exception as e:
        print(f"Request failed: {e}")
        return None

    if not resp.ok:
        print(f"HTTP error {resp.status_code} from API. Body preview: {resp.text[:200]}")
        return None

    try:
        return resp.json()
    except json.JSONDecodeError:
        print(f"Response was not valid JSON. Body preview: {resp.text[:200]}")
        return None


def main():
    # Get all sessions for 2025
    url_sessions = "https://api.openf1.org/v1/sessions?year=2025"
    data_sessions = fetch_json(url_sessions)

    if data_sessions is None:
        return

    # If API returned an error/message wrapper, show it and exit gracefully
    if isinstance(data_sessions, dict) and any(k in data_sessions for k in ("error", "message", "detail")):
        print("API returned an error payload:", data_sessions)
        return

    # Ensure we have a list of session objects
    if not isinstance(data_sessions, list):
        print("Unexpected payload type from API:", type(data_sessions).__name__)
        print("Payload preview:", str(data_sessions)[:200])
        return

    # Filter for race sessions only and extract session keys (guarding against malformed items)
    race_session_keys = []
    for item in data_sessions:
        if isinstance(item, dict) and item.get('session_name') == 'Race' and 'session_key' in item:
            race_session_keys.append(item['session_key'])

    print(f"Total race sessions found: {len(race_session_keys)}")
    print("Race session keys:")
    for key in race_session_keys:
        print(key)


if __name__ == "__main__":
    main()