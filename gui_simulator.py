import tkinter as tk
from tkinter import ttk
import random
import Total_points
from datetime import datetime
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg

# Fetch data
driver_names = Total_points.get_driver_names(2025)
race_sessions_data, sprint_sessions_data, race_keys, sprint_keys = Total_points.get_sessions(2025)
driver_points = {}
Total_points.add_points(sprint_keys, 8, driver_points)
Total_points.add_points(race_keys, 10, driver_points)
current_points = driver_points
current_date = datetime(2025, 9, 29).date()
num_races = Total_points.count_remaining_races(Total_points.ALL_RACES, current_date)
num_sprints = Total_points.count_remaining_sprints(Total_points.ALL_SPRINTS, current_date)
drivers = sorted([1, 63, 55, 12, 30, 22, 4, 44, 16, 6, 5, 87, 23, 31, 14, 27, 18, 10, 43, 81])
race_points = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1] + [0] * 10
sprint_points = [8, 7, 6, 5, 4, 3, 2, 1] + [0] * 12

# Scenarios
scenarios = {i: [] for i in range(num_races + num_sprints)}

# GUI
root = tk.Tk()
root.title("F1 Championship Simulator")

type_vars = [[tk.StringVar(master=root) for _ in range(5)] for _ in range(num_races + num_sprints)]
driver1_vars = [[tk.StringVar(master=root) for _ in range(5)] for _ in range(num_races + num_sprints)]
second_vars = [[tk.StringVar(master=root) for _ in range(5)] for _ in range(num_races + num_sprints)]

def conflicts(existing, new_type, new_d1, new_second):
    try:
        d1 = int(new_d1.split(':')[0]) if ':' in new_d1 else int(new_d1)
        if new_type == "Set Position":
            pos = int(new_second)
            for t, d, s in existing:
                if t == "Set Position":
                    p = int(s)
                    dd = int(d.split(':')[0]) if ':' in d else int(d)
                    if p == pos or dd == d1:
                        return True
        elif new_type == "A Above B":
            d2 = int(new_second.split(':')[0]) if ':' in new_second else int(new_second)
            for t, d, s in existing:
                if t == "A Above B":
                    dd1 = int(d.split(':')[0]) if ':' in d else int(d)
                    dd2 = int(s.split(':')[0]) if ':' in s else int(s)
                    if (dd1 == d2 and dd2 == d1):
                        return True  # direct reverse
                elif t == "Set Position":
                    dd = int(d.split(':')[0]) if ':' in d else int(d)
                    p = int(s)
                    if dd == d1 and p == 1:
                        return True  # can't have above d1 if d1 is 1
    except:
        return True  # if parsing fails, consider conflict
    return False

def update_scenarios():
    for r in range(num_races + num_sprints):
        scenarios[r] = []
        for j in range(5):
            t = type_vars[r][j].get()
            d1 = driver1_vars[r][j].get()
            s = second_vars[r][j].get()
            if t and d1 and s:
                if not conflicts(scenarios[r], t, d1, s):
                    scenarios[r].append((t, d1, s))

def generate_order_with_constraints(drivers, scenario_list, top5=None):
    for _ in range(1000):  # try up to 1000 times
        order = random.sample(drivers, 20)
        valid = True
        for type_, d1_str, second in scenario_list:
            try:
                d1 = int(d1_str.split(':')[0]) if ':' in d1_str else int(d1_str)
                if type_ == "Set Position":
                    pos = int(second) - 1
                    if d1 in order and pos < 20:
                        idx = order.index(d1)
                        order[idx], order[pos] = order[pos], order[idx]
                elif type_ == "A Above B":
                    d2 = int(second)
                    if d1 in order and d2 in order:
                        if order.index(d1) > order.index(d2):
                            valid = False
                            break
            except:
                continue
        if valid:
            if top5 and random.random() < 0.5:
                if not all(d in order[:5] for d in top5):
                    valid = False
                    continue
            if valid:
                return order
    # fallback
    if top5 and random.random() < 0.5:
        top5_in = [d for d in top5 if d in drivers]
        other = [d for d in drivers if d not in top5_in]
        random.shuffle(top5_in)
        random.shuffle(other)
        order = top5_in + other[:20 - len(top5_in)]
    else:
        order = random.sample(drivers, 20)
    return order

def simulate():
    update_scenarios()
    sorted_top = sorted(current_points.items(), key=lambda x: x[1], reverse=True)[:5]
    top_5 = [d for d, _ in sorted_top]
    win_counts = {d: 0 for d in top_5}
    for sim in range(1000):
        sim_points = {d: current_points.get(d, 0) for d in drivers}
        for r in range(num_races):
            order = generate_order_with_constraints(drivers, scenarios[r], top5=top_5)
            for pos, d in enumerate(order):
                sim_points[d] += race_points[pos]
        for s in range(num_sprints):
            order = generate_order_with_constraints(drivers, scenarios[num_races + s], top5=top_5)
            for pos, d in enumerate(order[:8]):
                sim_points[d] += sprint_points[pos]
        winner = max(sim_points, key=sim_points.get)
        if winner in win_counts:
            win_counts[winner] += 1
    result_text.delete(1.0, tk.END)
    for d in sorted(win_counts, key=win_counts.get, reverse=True):
        pct = (win_counts[d] / 10)
        result_text.insert(tk.END, f"{driver_names.get(d, f'Driver #{d}')}: {pct:.3f}%\n")

def plot_graph():
    fig = plt.Figure(figsize=(8, 5), dpi=100)
    ax = fig.add_subplot(111)
    completed_races = len(Total_points.ALL_RACES) - num_races
    weeks_past = list(range(1, completed_races + 1))
    top_5 = [d for d, p in sorted(current_points.items(), key=lambda x: x[1], reverse=True)[:5]]
    driver_points_over_time = {d: [] for d in top_5}
    for k in weeks_past:
        points = Total_points.get_points_after_race_week(k)
        for d in top_5:
            driver_points_over_time[d].append(points.get(d, 0))
    
    # Run simulations for average points over remaining races
    num_sims = 100  # Smaller number for speed
    avg_points_lists = {d: [] for d in top_5}
    for sim in range(num_sims):
        sim_points = {d: current_points.get(d, 0) for d in drivers}
        points_over_time = [sim_points.copy()]  # initial
        for r in range(num_races):
            order = generate_order_with_constraints(drivers, scenarios[r])
            for pos, d in enumerate(order):
                sim_points[d] += race_points[pos]
            points_over_time.append(sim_points.copy())
        for s in range(num_sprints):
            order = generate_order_with_constraints(drivers, scenarios[num_races + s])
            for pos, d in enumerate(order[:8]):
                sim_points[d] += sprint_points[pos]
        # points_over_time has initial + after each race
        for i, pts in enumerate(points_over_time):
            for d in top_5:
                if i >= len(avg_points_lists[d]):
                    avg_points_lists[d].append([])
                avg_points_lists[d][i].append(pts[d])
    # Average
    avg_points_over_time = {}
    for d in top_5:
        avg_points_over_time[d] = [sum(vals) / len(vals) for vals in avg_points_lists[d]]
    
    # Quartiles for future
    lower_quartile = {}
    upper_quartile = {}
    median_points = {}
    for d in top_5:
        lower_quartile[d] = [current_points[d]] + [min(vals) for vals in avg_points_lists[d][1:]]
        upper_quartile[d] = [current_points[d]] + [max(vals) for vals in avg_points_lists[d][1:]]
        median_points[d] = [sorted(vals)[49] for vals in avg_points_lists[d][1:]]  # median
    
    # Plot
    for d in top_5:
        past = driver_points_over_time[d]
        future_median = median_points[d]
        full_points = past + future_median
        weeks_full = list(range(1, completed_races + num_races + 1))
        ax.plot(weeks_full, full_points, label=driver_names.get(d, f'Driver #{d}'), marker='o')
        
        # Shaded area for future uncertainty
        weeks_future = list(range(completed_races, completed_races + num_races + 1))
        ax.fill_between(weeks_future, lower_quartile[d], upper_quartile[d], alpha=0.3)
    
    ax.set_xlabel('Race Week')
    ax.set_ylabel('Points')
    ax.set_title('Top 5 Driver Points: Actual (Past) and Simulated Average (Future)')
    ax.axvline(x=completed_races, color='red', linestyle='--', label='End of Real Data')
    ax.legend()
    ax.grid(True)
    
    plot_window = tk.Toplevel(root)
    plot_window.title("Points Graph")
    canvas = FigureCanvasTkAgg(fig, master=plot_window)
    canvas.draw()
    canvas.get_tk_widget().pack()

notebook = ttk.Notebook(root)
completed_races = len(Total_points.ALL_RACES) - num_races
completed_sprints = len(Total_points.ALL_SPRINTS) - num_sprints
for i in range(num_races + num_sprints):
    frame = ttk.Frame(notebook)
    if i < num_races:
        country = Total_points.ALL_RACES[completed_races + i][0]
        tab_text = f"Race {i+1}: {country[:3]}"
    else:
        sprint_i = i - num_races
        country = Total_points.ALL_SPRINTS[completed_sprints + sprint_i][0]
        tab_text = f"Sprint {sprint_i+1}: {country[:3]}"
    notebook.add(frame, text=tab_text)
    ttk.Label(frame, text="Scenarios (up to 5)").grid(row=0, column=0, columnspan=4)
    for j in range(5):
        type_cb = ttk.Combobox(frame, textvariable=type_vars[i][j], values=["Set Position", "A Above B"], width=15)
        type_cb.grid(row=j+1, column=0)
        driver1_cb = ttk.Combobox(frame, textvariable=driver1_vars[i][j], values=[f"{d}: {driver_names.get(d, f'Driver #{d}')}" for d in drivers], width=25)
        driver1_cb.grid(row=j+1, column=1)
        second_cb = ttk.Combobox(frame, textvariable=second_vars[i][j], width=20)
        second_cb.grid(row=j+1, column=2)
        def update_second(*args, i=i, j=j, cb=second_cb, tv=type_vars[i][j]):
            if tv.get() == "Set Position":
                cb['values'] = [str(k) for k in range(1, 21)]
            elif tv.get() == "A Above B":
                cb['values'] = [f"{d}: {driver_names.get(d, f'Driver #{d}')}" for d in drivers]
        type_vars[i][j].trace_add('write', update_second)
        update_second()

notebook.pack()

ttk.Button(root, text="Run Simulation (1000 sims)", command=simulate).pack()
ttk.Button(root, text="Plot Points Graph", command=plot_graph).pack()

result_text = tk.Text(root, height=10)
result_text.pack()

root.mainloop()