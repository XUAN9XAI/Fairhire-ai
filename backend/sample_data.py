import pandas as pd
import numpy as np
import random

def get_sample_dataset():
    """
    Generates a realistic sample hiring dataset with built-in gender bias.
    Male selection rate ≈ 65-75%, Female selection rate ≈ 35-45%.
    Includes slight randomness (±5%) per run so results vary.
    Contains 1-2 missing values for realism.
    """
    random.seed(None)  # Fresh seed each call for controlled randomness
    np.random.seed(None)

    # --- Named candidates (always present) ---
    named = [
        {"name": "Ray",   "gender": "Male",   "experience_years": 6, "location": "tier1", "employment_gap": 0},
        {"name": "Kai",   "gender": "Female", "experience_years": 5, "location": "tier2", "employment_gap": 2},
        {"name": "Ved",   "gender": "Male",   "experience_years": 8, "location": "tier1", "employment_gap": 0},
        {"name": "Xixi",  "gender": "Female", "experience_years": 4, "location": "tier3", "employment_gap": 1},
        {"name": "Aarav", "gender": "Male",   "experience_years": 3, "location": "tier2", "employment_gap": 0},
    ]

    # --- Generate remaining candidates ---
    male_names = ["Arjun", "Rohan", "Siddharth", "Omar", "Liam", "Yuto", "Chen", "Aditya", "Farhan", "Nikhil", "Ravi", "Sameer"]
    female_names = ["Priya", "Meera", "Zara", "Ananya", "Suki", "Yuna", "Fatima", "Diya", "Rina", "Nisha", "Kavya", "Sneha"]

    extra_rows = []
    # Add 10 more males, 10 more females
    for i in range(10):
        extra_rows.append({
            "name": male_names[i],
            "gender": "Male",
            "experience_years": random.randint(1, 12),
            "location": random.choice(["tier1", "tier2", "tier3"]),
            "employment_gap": random.choice([0, 0, 0, 1]),
        })
        extra_rows.append({
            "name": female_names[i],
            "gender": "Female",
            "experience_years": random.randint(1, 10),
            "location": random.choice(["tier1", "tier2", "tier3"]),
            "employment_gap": random.choice([0, 1, 1, 2, 3]),
        })

    all_rows = named + extra_rows  # 25 total
    df = pd.DataFrame(all_rows)

    # --- Assign candidate IDs ---
    df.insert(0, "candidate_id", [f"DEMO-{str(i+1).zfill(3)}" for i in range(len(df))])

    # --- Assign biased hiring outcomes ---
    # Base rates: Male ≈ 70% ±5%, Female ≈ 40% ±5%
    male_rate = 0.70 + random.uniform(-0.05, 0.05)
    female_rate = 0.40 + random.uniform(-0.05, 0.05)

    hired = []
    for _, row in df.iterrows():
        rate = male_rate if row["gender"] == "Male" else female_rate
        hired.append(1 if random.random() < rate else 0)

    df["hired"] = hired

    # --- Inject 1-2 missing values for realism ---
    # Set one employment_gap to NaN
    nan_idx = random.randint(6, len(df) - 1)
    df.loc[nan_idx, "employment_gap"] = np.nan
    # Occasionally set one experience to NaN
    if random.random() > 0.5:
        nan_idx2 = random.randint(6, len(df) - 1)
        while nan_idx2 == nan_idx:
            nan_idx2 = random.randint(6, len(df) - 1)
        df.loc[nan_idx2, "experience_years"] = np.nan

    return df
