#!/usr/bin/env python3
"""
download_f1_images.py

Downloads two image variants for the 2025 F1 drivers (normal + whitefrless),
converts webp -> png and saves as:
    {driver_number}.png
    {driver_number}_white.png

If an image is not found, a message is printed and script continues.
"""

import os
import requests
from PIL import Image
from io import BytesIO
from time import sleep

OUTDIR = "f1_driver_images_2025"
os.makedirs(OUTDIR, exist_ok=True)

# ---- Driver list (2025) ----
# Each entry: (first_name, last_name, team_name_for_slug, driver_number)
# Source: Formula1 — drivers list & driver numbers (2025).
# If anything changes on the grid you can update this list.
DRIVERS = [
    ("Oscar", "Piastri", "mclaren", "81"),
    ("Lando", "Norris", "mclaren", "4"),
    ("George", "Russell", "mercedes", "63"),
    ("Andrea", "Antonelli", "mercedes", "12"),   # Andrea Kimi Antonelli -> first name Andrea
    ("Charles", "Leclerc", "ferrari", "16"),
    ("Lewis", "Hamilton", "ferrari", "44"),
    ("Max", "Verstappen", "redbullracing", "1"),
    ("Yuki", "Tsunoda", "redbullracing", "22"),
    ("Alexander", "Albon", "williams", "23"),
    ("Carlos", "Sainz", "williams", "55"),
    ("Liam", "Lawson", "racingbulls", "30"),
    ("Isack", "Hadjar", "racingbulls", "6"),
    ("Fernando", "Alonso", "astonmartin", "14"),
    ("Lance", "Stroll", "astonmartin", "18"),
    ("Nico", "Hulkenberg", "kicksauber", "27"),
    ("Gabriel", "Bortoleto", "kicksauber", "5"),
    ("Esteban", "Ocon", "haas", "31"),
    ("Oliver", "Bearman", "haas", "87"),
    ("Pierre", "Gasly", "alpine", "10"),
    ("Franco", "Colapinto", "alpine", "43"),
]

# ---- URL templates ----
BASE = "https://media.formula1.com/image/upload/c_fit,w_876,h_742/q_auto/v1740000000/common/f1/2025"
# normal:
TEMPLATE_NORMAL = BASE + "/{team}/{slug}01/2025{team}{slug}01numbercolourfrless.webp"
# whitefrless:
TEMPLATE_WHITE = BASE + "/{team}/{slug}01/2025{team}{slug}01numberwhitefrless.webp"

# helper functions
def make_team_slug(team_name: str) -> str:
    """Lowercase and remove spaces/punctuation to form team slug."""
    return "".join(ch for ch in team_name.lower() if ch.isalnum())

def make_driver_slug(first: str, last: str) -> str:
    """Driver slug pattern: first3letters + first3letters_of_lastname, lowercase.
       Example: Max Verstappen -> maxver
    """
    f = (first.strip().lower()[:3]).ljust(3, "_")  # pad if short
    l = (last.strip().lower()[:3]).ljust(3, "_")
    slug = (f + l).replace("_", "")
    return slug

def download_image(url: str, timeout=15):
    """Return bytes of response if 200 and content-type present, else None."""
    try:
        r = requests.get(url, timeout=timeout)
        if r.status_code == 200 and r.content:
            return r.content
        else:
            return None
    except Exception as e:
        return None

def webp_to_png_and_save(webp_bytes: bytes, out_path: str):
    """Convert webp bytes to PNG and save to out_path."""
    img = Image.open(BytesIO(webp_bytes)).convert("RGBA")
    img.save(out_path, "PNG")

# ---- Main loop ----
failed = []
success_count = 0

for first, last, team, number in DRIVERS:
    team_slug = make_team_slug(team)
    driver_slug = make_driver_slug(first, last)
    # sometimes F1 uses 6-letter slug (3+3) as in examples; our function builds that.
    # build urls
    url_normal = TEMPLATE_NORMAL.format(team=team_slug, slug=driver_slug)
    url_white = TEMPLATE_WHITE.format(team=team_slug, slug=driver_slug)

    # Download normal
    print(f"[{number}] Trying normal image for {first} {last} -> {url_normal}")
    data = download_image(url_normal)
    if data:
        out_fn = os.path.join(OUTDIR, f"{number}.png")
        try:
            webp_to_png_and_save(data, out_fn)
            print(f"  saved {out_fn}")
            success_count += 1
        except Exception as e:
            print(f"  failed converting/saving normal for {number}: {e}")
            failed.append((number, "normal", url_normal))
    else:
        print(f"  normal image NOT found ({url_normal})")
        failed.append((number, "normal", url_normal))

    # Download whitefrless
    print(f"[{number}] Trying white image for {first} {last} -> {url_white}")
    data2 = download_image(url_white)
    if data2:
        out_fn2 = os.path.join(OUTDIR, f"{number}_white.png")
        try:
            webp_to_png_and_save(data2, out_fn2)
            print(f"  saved {out_fn2}")
            success_count += 1
        except Exception as e:
            print(f"  failed converting/saving white for {number}: {e}")
            failed.append((number, "white", url_white))
    else:
        print(f"  white image NOT found ({url_white})")
        failed.append((number, "white", url_white))

    # small delay to be polite to the server
    sleep(0.2)

print("\nDone.")
print(f"Successful image saves (approx): {success_count}")
if failed:
    print("Failed or missing images (number, variant, url):")
    for t in failed:
        print(" ", t)
else:
    print("All images downloaded successfully.")
