import requests
import json
import os
from datetime import datetime
import random

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
    url = f"https://api.openf1.org/v1/session_result?session_key={session_key}&position<={n}"
    session_results = cached_get(url)
    session_results.sort(key=lambda x: int(x['position']))
    return session_results  # Return full dicts to access 'points'

def print_session_results(session_keys, session_type, n):
    for key, country in session_keys:
        print(f"{session_type} results for session {key} ({country}):")
        print("-" * 40)
        results = session_result(key, n=n)
        for result in results:
            print(f"Position {result['position']}: Driver #{result['driver_number']} - {result['points']} points")
        print("\n")

def add_points(session_keys, n, driver_points):
    for key, country in session_keys:
        results = session_result(key, n=n)
        for result in results:
            driver_number = int(result['driver_number'])
            points = result['points']
            if driver_number in driver_points:
                driver_points[driver_number] += points
            else:
                driver_points[driver_number] = points

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
        add_points([(key, country)], 10, driver_points)
        # Add sprint if exists for that country
        sprint_session = next((k for k, c in sprint_keys if c == country), None)
        if sprint_session:
            add_points([(sprint_session, country)], 8, driver_points)
    cache_points[(k, year)] = driver_points.copy()
    return driver_points

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
    add_points(sprint_keys, 8, driver_points)
    add_points(race_keys, 10, driver_points)
    
    print_active_drivers(driver_names)
    print_total_points(driver_points, driver_names)
    
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