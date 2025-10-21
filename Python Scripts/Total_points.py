import requests
import json
import os
from datetime import datetime
import random

# Persistent cache files
CACHE_FILE = 'api_cache.json'
POINTS_CACHE_FILE = 'points_cache.json'
POINTS_TABLE_FILE = 'points_progression_table.json'
POINTS_TABLE_CSV = 'points_progression_table.csv'

# Load cache from file if it exists
api_cache = {}
if os.path.exists(CACHE_FILE):
    try:
        with open(CACHE_FILE, 'r') as f:
            api_cache = json.load(f)
    except (json.JSONDecodeError, IOError):
        api_cache = {}

# Load points cache from file if it exists
points_cache = {}
if os.path.exists(POINTS_CACHE_FILE):
    try:
        with open(POINTS_CACHE_FILE, 'r') as f:
            points_cache = json.load(f)
    except (json.JSONDecodeError, IOError):
        points_cache = {}

def save_cache():
    try:
        with open(CACHE_FILE, 'w') as f:
            json.dump(api_cache, f, indent=2)
    except IOError:
        pass  # Silently fail if can't save

def save_points_cache():
    """Save the points cache to file"""
    try:
        with open(POINTS_CACHE_FILE, 'w') as f:
            json.dump(points_cache, f, indent=2)
    except IOError:
        pass  # Silently fail if can't save

def cached_get(url):
    """Simple cached GET with basic resilience.
    Avoid caching transient error objects and always return parsed JSON when possible.
    """
    # Return cached value if present
    if url in api_cache:
        return api_cache[url]

    # Fetch fresh
    session = requests.Session()
    try:
        response = session.get(url, timeout=15)
        # Raise for non-2xx so we can handle uniformly
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        # On hard failure, do not cache; surface a minimal diagnostic structure
        return {"error": True, "detail": str(e)}

    # If the API returns a dict with an error/message, don't cache it to avoid poisoning future runs
    if isinstance(data, dict) and any(k in data for k in ("error", "message", "detail")):
        return data

    # Cache only likely-good payloads
    api_cache[url] = data
    save_cache()  # Save after fetching new data
    return data

# Cache for points calculations
cache_points = {}

# Full 2025 F1 Calendar (hardcoded from Wikipedia)
ALL_RACES = [
    ("Australia", "2025-03-16"),
    ("China", "2025-03-23"),
    ("Japan", "2025-04-06"),
    ("Bahrain", "2025-04-13"),
    ("Saudi Arabia", "2025-04-20"),
    ("Miami", "2025-05-04"),
    ("Emilia Romagna", "2025-05-18"),
    ("Monaco", "2025-05-25"),
    ("Spain", "2025-06-01"),
    ("Canada", "2025-06-15"),
    ("Austria", "2025-06-29"),
    ("Britain", "2025-07-06"),
    ("Belgium", "2025-07-27"),
    ("Hungary", "2025-08-03"),
    ("Netherlands", "2025-08-31"),
    ("Italy", "2025-09-07"),
    ("Azerbaijan", "2025-09-21"),
    ("Singapore", "2025-10-05"),
    ("United States", "2025-10-19"),
    ("Mexico City", "2025-10-26"),
    ("São Paulo", "2025-11-09"),
    ("Las Vegas", "2025-11-22"),
    ("Qatar", "2025-11-30"),
    ("Abu Dhabi", "2025-12-07"),
]

ALL_SPRINTS = [
    ("China", "2025-03-22"),  # Assuming sprint is day before
    ("Miami", "2025-05-03"),
    ("Belgium", "2025-07-26"),
    ("United States", "2025-10-18"),
    ("São Paulo", "2025-11-08"),
    ("Qatar", "2025-11-29"),
]

def get_sessions(year):
    url_race_sessions = f"https://api.openf1.org/v1/sessions?session_name=Race&year={year}"
    url_sprint_sessions = f"https://api.openf1.org/v1/sessions?session_name=Sprint&year={year}"
    race_sessions_data = cached_get(url_race_sessions)
    sprint_sessions_data = cached_get(url_sprint_sessions)
    race_session_keys = [(session['session_key'], session['country_name']) for session in race_sessions_data]
    sprint_session_keys = [(session['session_key'], session['country_name']) for session in sprint_sessions_data]
    return race_sessions_data, sprint_sessions_data, race_session_keys, sprint_session_keys

def print_session_keys(race_keys, sprint_keys):
    print(f"Total race sessions found: {len(race_keys)}")
    print("Race session keys:")
    for key in race_keys:
        print(key)
    print(f"\nTotal sprint sessions found: {len(sprint_keys)}")
    print("Sprint session keys:")
    for key in sprint_keys:
        print(key)

def count_remaining_races(all_races, current_date):
    remaining = 0
    for country, date_str in all_races:
        race_date = datetime.fromisoformat(date_str).date()
        if race_date > current_date:
            remaining += 1
    return remaining

def count_remaining_sprints(all_sprints, current_date):
    remaining = 0
    for country, date_str in all_sprints:
        sprint_date = datetime.fromisoformat(date_str).date()
        if sprint_date > current_date:
            remaining += 1
    return remaining

def print_all_races_and_sprints():
    print("Full 2025 F1 Race Calendar:")
    for i, (country, date) in enumerate(ALL_RACES, 1):
        print(f"{i}. {country} Grand Prix - {date}")
    
    print("\nSprint Races:")
    for i, (country, date) in enumerate(ALL_SPRINTS, 1):
        print(f"{i}. {country} Sprint - {date}")

def session_result(session_key, n=10):
    """Fetch session results and return a list of result dicts.
    The OpenF1 API may return an error dict (rate limit, not found, etc.).
    This function normalizes the output to a list and avoids crashes.
    """
    url = f"https://api.openf1.org/v1/session_result?session_key={session_key}&position<={n}"
    raw = cached_get(url)

    # Normalize to list
    results = []
    if isinstance(raw, list):
        results = raw
    elif isinstance(raw, dict):
        # Attempt to extract common list containers; otherwise treat as no data
        for key in ("results", "data", "items"):
            val = raw.get(key)
            if isinstance(val, list):
                results = val
                break
        else:
            # If we previously cached a bad structure for this URL, purge it once
            if url in api_cache:
                try:
                    api_cache.pop(url, None)
                    save_cache()
                except Exception:
                    pass
            # Return empty list to allow callers to proceed gracefully
            return []
    else:
        return []

    # Sort safely by numeric position if available
    try:
        results.sort(key=lambda x: int(x.get('position', 9999)))
    except Exception:
        # If any item is malformed, fall back to unsorted
        pass
    return results  # Return full dicts to access 'points'

def print_session_results(session_keys, session_type, n):
    for key, country in session_keys:
        print(f"{session_type} results for session {key} ({country}):")
        print("-" * 40)
        results = session_result(key, n=n)
        for result in results:
            print(f"Position {result['position']}: Driver #{result['driver_number']} - {result['points']} points")
        print("\n")

def add_points(session_keys, n, driver_points, cache_key_prefix=''):
    """Add points from sessions and cache results per session"""
    for key, country in session_keys:
        cache_key = f"{cache_key_prefix}_{key}_{country}"
        total_cache_key = f"{cache_key_prefix}_{key}_{country}_TOTAL"
        
        # Check if this session is already cached
        if cache_key in points_cache:
            # Use cached points
            cached_results = points_cache[cache_key]
            for driver_number_str, points in cached_results.items():
                driver_number = int(driver_number_str)
                if driver_number in driver_points:
                    driver_points[driver_number] += points
                else:
                    driver_points[driver_number] = points
        else:
            # Fetch and cache new results
            results = session_result(key, n=n)
            session_points = {}
            for result in results:
                driver_number = int(result['driver_number'])
                points = result['points']
                session_points[driver_number] = points
                if driver_number in driver_points:
                    driver_points[driver_number] += points
                else:
                    driver_points[driver_number] = points
            
            # Cache the results for this session
            points_cache[cache_key] = session_points
            save_points_cache()
        
        # Always cache the cumulative total after this session
        points_cache[total_cache_key] = driver_points.copy()
        save_points_cache()

def get_driver_names(year):
    url_drivers = f"https://api.jolpi.ca/ergast/f1/{year}/drivers/"
    ergast_data = cached_get(url_drivers)
    driver_names = {}
    for driver in ergast_data['MRData']['DriverTable']['Drivers']:
        permanent_number = int(driver['permanentNumber'])
        full_name = f"{driver['givenName']} {driver['familyName']}"
        driver_names[permanent_number] = full_name
    # Hardcode known drivers if not in API
    driver_names[1] = "Max Verstappen"
    return driver_names

def print_total_points(driver_points, driver_names):
    sorted_driver_points = sorted(driver_points.items(), key=lambda x: x[1], reverse=True)
    print("\nTotal points per driver:\n")
    for driver_number, points in sorted_driver_points:
        driver_name = driver_names.get(driver_number, f"Driver #{driver_number}")
        print(f"{driver_name} (#{driver_number}): {points} points")

def get_points_after_race_week(k, year=2025):
    """
    Calculate driver points after the first k race weeks.
    A race week includes the race and any associated sprint.
    """
    if (k, year) in cache_points:
        return cache_points[(k, year)].copy()
    race_sessions_data, sprint_sessions_data, race_keys, sprint_keys = get_sessions(year)
    driver_points = {}
    for i in range(min(k, len(race_keys))):
        key, country = race_keys[i]
        add_points([(key, country)], 10, driver_points, cache_key_prefix=f'{year}_race')
        # Add sprint if exists for that country
        sprint_session = next((k for k, c in sprint_keys if c == country), None)
        if sprint_session:
            add_points([(sprint_session, country)], 8, driver_points, cache_key_prefix=f'{year}_sprint')
    cache_points[(k, year)] = driver_points.copy()
    return driver_points

def get_total_points_at_session(session_key, country, cache_key_prefix):
    """Retrieve cached total accumulated points after a specific session"""
    total_cache_key = f"{cache_key_prefix}_{session_key}_{country}_TOTAL"
    if total_cache_key in points_cache:
        # Convert string keys to int keys for consistency
        return {int(k): v for k, v in points_cache[total_cache_key].items()}
    return None

def print_total_points_history(race_keys, sprint_keys, driver_names, year=2025):
    """Print the total points standings after each race/sprint in a 2D table"""
    print("\n" + "="*200)
    print("CHAMPIONSHIP STANDINGS - POINTS PROGRESSION TABLE")
    print("="*200)
    
    # Combine all sessions chronologically (races only for cleaner table)
    all_sessions = []
    for key, country in race_keys:
        all_sessions.append((key, country, 'R', f'{year}_race'))
    
    # Collect all points data
    all_drivers = set()
    points_data = {}
    
    for key, country, session_type, prefix in all_sessions:
        totals = get_total_points_at_session(key, country, prefix)
        if totals:
            points_data[(key, country)] = totals
            for driver_num_str in totals.keys():
                all_drivers.add(int(driver_num_str))
    
    # Get final standings to sort drivers
    if all_sessions:
        last_key, last_country, _, last_prefix = all_sessions[-1]
        final_totals = get_total_points_at_session(last_key, last_country, last_prefix)
        if final_totals:
            sorted_drivers = sorted(
                [(int(d), int(p)) for d, p in final_totals.items()],
                key=lambda x: x[1],
                reverse=True
            )[:10]  # Top 10 drivers by points for display
            all_sorted_drivers = sorted(
                [(int(d), int(p)) for d, p in final_totals.items()],
                key=lambda x: x[0]
            )  # All drivers sorted by driver number for JSON
        else:
            sorted_drivers = [(d, 0) for d in sorted(all_drivers)[:10]]
            all_sorted_drivers = [(d, 0) for d in sorted(all_drivers)]
    else:
        sorted_drivers = [(d, 0) for d in sorted(all_drivers)[:10]]
        all_sorted_drivers = [(d, 0) for d in sorted(all_drivers)]
    
    # Build JSON structure for ALL drivers
    json_table = {
        "year": year,
        "races": [country for key, country, session_type, prefix in all_sessions],
        "drivers": []
    }
    
    for driver_num, final_pts in all_sorted_drivers:
        driver_name = driver_names.get(driver_num, f"Driver #{driver_num}")
        driver_data = {
            "driver_number": driver_num,
            "driver_name": driver_name,
            "points_progression": [],
            "final_points": final_pts
        }
        
        for key, country, session_type, prefix in all_sessions:
            totals = points_data.get((key, country), {})
            pts = totals.get(driver_num, 0)
            driver_data["points_progression"].append({
                "race": country,
                "cumulative_points": int(pts) if pts > 0 else 0
            })
        
        json_table["drivers"].append(driver_data)
    
    # Save to JSON file
    try:
        with open(POINTS_TABLE_FILE, 'w') as f:
            json.dump(json_table, f, indent=2)
        print(f"\nPoints progression table saved to: {POINTS_TABLE_FILE}")
    except IOError as e:
        print(f"\nWarning: Could not save points table to file: {e}")
    
    # Save to CSV file
    try:
        import csv
        with open(POINTS_TABLE_CSV, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            
            # Write header row
            header = ['Driver Number', 'Driver Name'] + [country for key, country, session_type, prefix in all_sessions] + ['Final Points']
            writer.writerow(header)
            
            # Write data rows for each driver
            for driver_num, final_pts in all_sorted_drivers:
                driver_name = driver_names.get(driver_num, f"Driver #{driver_num}")
                row = [driver_num, driver_name]
                
                # Add cumulative points for each race
                for key, country, session_type, prefix in all_sessions:
                    totals = points_data.get((key, country), {})
                    pts = totals.get(driver_num, 0)
                    row.append(int(pts) if pts > 0 else 0)
                
                row.append(final_pts)
                writer.writerow(row)
        
        print(f"Points progression table saved to: {POINTS_TABLE_CSV}")
    except IOError as e:
        print(f"Warning: Could not save CSV file: {e}")
    
    # Print header for console display (top 10 only)
    header = f"{'Driver':<25} "
    for key, country, session_type, prefix in all_sessions:
        # Abbreviate country name to 3 letters
        country_abbr = country[:3].upper()
        header += f"{country_abbr:>5} "
    header += "| FINAL"
    print(header)
    print("-" * len(header))
    
    # Print each driver's row (top 10 only)
    for driver_num, final_pts in sorted_drivers:
        driver_name = driver_names.get(driver_num, f"Driver #{driver_num}")
        # Truncate long names
        if len(driver_name) > 23:
            driver_name = driver_name[:23]
        row = f"{driver_name:<25} "
        
        for key, country, session_type, prefix in all_sessions:
            totals = points_data.get((key, country), {})
            pts = totals.get(driver_num, 0)  # Use int key directly
            if pts > 0:
                row += f"{int(pts):>5} "
            else:
                row += f"{'--':>5} "
        
        row += f"| {final_pts:>5}"
        print(row)
    
    print("="*200)
    print("Note: Shows cumulative points after each race. '--' means 0 points at that stage.")

def print_active_drivers(driver_names):
    print("\nActive F1 Drivers for 2025:")
    sorted_drivers = sorted(driver_names.items(), key=lambda x: x[0])
    for number, name in sorted_drivers:
        print(f"#{number}: {name}")

def main():
    race_sessions_data, sprint_sessions_data, race_keys, sprint_keys = get_sessions(2025)
    print_session_keys(race_keys, sprint_keys)
    
    print_all_races_and_sprints()
    
    current_date = datetime(2025, 9, 29).date()
    total_races = len(ALL_RACES)
    remaining_races = count_remaining_races(ALL_RACES, current_date)
    completed_races = total_races - remaining_races
    print(f"\nTotal races in 2025: {total_races}")
    print(f"Races completed: {completed_races}")
    print(f"Races remaining: {remaining_races}")
    
    total_sprints = len(ALL_SPRINTS)
    remaining_sprints = count_remaining_sprints(ALL_SPRINTS, current_date)
    completed_sprints = total_sprints - remaining_sprints
    print(f"\nTotal sprint races in 2025: {total_sprints}")
    print(f"Sprint races completed: {completed_sprints}")
    print(f"Sprint races remaining: {remaining_sprints}")
    
    driver_names = get_driver_names(2025)
    
    print(f"\nDrivers in the last race ({race_keys[-1][1]} Grand Prix):")
    results = session_result(race_keys[-1][0], n=20)
    for result in results:
        driver_name = driver_names.get(int(result['driver_number']), f"Driver #{result['driver_number']}")
        print(f"Position {result['position']}: {driver_name} (#{result['driver_number']})")
    
    print(f"\nRace results for session {race_keys[0]}:")
    print("-" * 40)
    results = session_result(race_keys[0][0])
    for result in results:
        print(f"Position {result['position']}: Driver #{result['driver_number']} - {result['points']} points")
    
    print_session_results(sprint_keys, "Sprint", 8)
    print_session_results(race_keys, "Race", 10)
    
    driver_points = {}
    add_points(sprint_keys, 8, driver_points, cache_key_prefix='2025_sprint')
    add_points(race_keys, 10, driver_points, cache_key_prefix='2025_race')
    
    print_active_drivers(driver_names)
    print_total_points(driver_points, driver_names)
    
    # Print championship standings history
    print_total_points_history(race_keys, sprint_keys, driver_names, 2025)
    
    # Get top 5 drivers
    sorted_current = sorted(driver_points.items(), key=lambda x: x[1], reverse=True)
    top_5 = [d for d, p in sorted_current[:5]]
    leader_points = sorted_current[0][1]
    
    # Randomized race simulator
    drivers = [1, 63, 55, 12, 30, 22, 4, 44, 16, 6, 5, 87, 23, 31, 14, 27, 18, 10, 43, 81]
    points_system = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] + [0] * 10
    current_points_full = {d: driver_points.get(d, 0) for d in drivers}
    win_counts = {d: 0 for d in top_5}
    
    print("\nRunning 2000 simulations for remaining 7 races...")
    for sim in range(2000):
        sim_points = current_points_full.copy()
        for race in range(7):
            random_order = random.sample(drivers, 20)
            for pos, driver in enumerate(random_order):
                sim_points[driver] += points_system[pos]
        winner = max(sim_points, key=sim_points.get)
        if winner in win_counts:
            win_counts[winner] += 1
    
    print("\nChampionship win chances for top 5 drivers:")
    for d in top_5:
        name = driver_names.get(d, f"Driver #{d}")
        percent = (win_counts[d] / 2000) * 100
        print(f"{name} (#{d}): {percent:.3f}% chance")

if __name__ == "__main__":
    main()