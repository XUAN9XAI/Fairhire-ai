import csv
import random
import os

def generate_biased_dataset(filename="sample_data.csv", num_rows=500):
    random.seed(42)

    genders = ['Male', 'Female']
    cities = ['Tier-1', 'Tier-2', 'Tier-3']
    education_levels = ['PhD', 'Masters', 'Bachelors', 'Diploma']
    
    data = []

    # Inject Priya (Our specific demo case)
    data.append({
        'candidate_id': 'CAND-001',
        'name': 'Priya S.',
        'gender': 'Female',
        'city': 'Tier-2',
        'experience_years': 5,
        'education': 'Masters',
        'employment_gap_years': 2,
        'english_proficiency': 'Medium',
        'skills_score': 85,
        'hired': 0
    })

    for i in range(2, num_rows + 1):
        gender = random.choices(genders, weights=[0.6, 0.4])[0]
        city = random.choices(cities, weights=[0.3, 0.4, 0.3])[0]
        education = random.choices(education_levels, weights=[0.05, 0.25, 0.6, 0.1])[0]
        
        exp = random.randint(0, 15)
        
        gap_prob = 0.4 if gender == 'Female' else 0.1
        has_gap = random.random() < gap_prob
        gap = random.randint(1, 5) if has_gap else 0
        
        if city == 'Tier-1':
            eng = random.choices(['High', 'Medium', 'Low'], weights=[0.7, 0.25, 0.05])[0]
        elif city == 'Tier-2':
            eng = random.choices(['High', 'Medium', 'Low'], weights=[0.3, 0.6, 0.1])[0]
        else:
            eng = random.choices(['High', 'Medium', 'Low'], weights=[0.1, 0.5, 0.4])[0]

        base_skill = random.gauss(70, 10)
        if gender == 'Male':
            base_skill += 5
        skills = min(100, max(40, int(base_skill)))

        hire_score = (skills * 0.4) + (exp * 2) 
        
        if education == 'PhD': hire_score += 15
        elif education == 'Masters': hire_score += 10
        elif education == 'Bachelors': hire_score += 5

        if eng == 'High': hire_score += 10
        elif eng == 'Medium': hire_score += 5

        hire_score -= (gap * 5)
        
        if city == 'Tier-2': hire_score -= 5
        if city == 'Tier-3': hire_score -= 10

        hired = 1 if hire_score > 60 else 0

        data.append({
            'candidate_id': f'CAND-{i:03d}',
            'name': f'Candidate {i}',
            'gender': gender,
            'city': city,
            'experience_years': exp,
            'education': education,
            'employment_gap_years': gap,
            'english_proficiency': eng,
            'skills_score': skills,
            'hired': hired
        })

    # Save to CSV
    output_path = os.path.join(os.path.dirname(__file__), filename)
    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=data[0].keys())
        writer.writeheader()
        writer.writerows(data)
        
    print(f"Dataset generated and saved to {output_path}")

if __name__ == "__main__":
    generate_biased_dataset()
