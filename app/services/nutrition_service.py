"""
TDEE calculator and nutrition target engine for endurance athletes.
Macro ratios follow ISSN sport nutrition guidelines.
"""
from datetime import date


def calc_tdee(profile: dict, day_type: str = 'rest') -> int:
    weight = float(profile.get('weight_kg') or 70)
    height = float(profile.get('height_cm') or 170)
    dob = profile.get('date_of_birth')
    gender = (profile.get('gender') or 'male').lower()

    age = 30
    if dob:
        try:
            from datetime import datetime
            if isinstance(dob, str):
                dob = datetime.strptime(dob[:10], '%Y-%m-%d').date()
            age = (date.today() - dob).days // 365
        except Exception:
            pass

    # Mifflin-St Jeor
    if gender == 'female':
        bmr = 10 * weight + 6.25 * height - 5 * age - 161
    else:
        bmr = 10 * weight + 6.25 * height - 5 * age + 5

    multipliers = {
        'rest': 1.2,
        'easy': 1.4,
        'tempo': 1.55,
        'interval': 1.65,
        'long': 1.75,
        'strength': 1.50,
        'brick': 1.80,
        'race': 2.0,
        'core': 1.30,
    }
    multiplier = multipliers.get(day_type, 1.35)
    return int(bmr * multiplier)


def calc_targets(profile: dict, day_type: str = 'rest', block_type: str = 'base') -> dict:
    weight = float(profile.get('weight_kg') or 70)
    calories = calc_tdee(profile, day_type)

    # Protein: 1.6 g/kg base, 2.0 g/kg peak/race
    protein_g_per_kg = 2.0 if block_type in ('peak', 'taper') else 1.6
    protein_g = round(weight * protein_g_per_kg, 1)

    # Carbs vary with training load
    carb_map = {
        'rest': 4.0, 'easy': 5.0, 'tempo': 6.0,
        'interval': 7.0, 'long': 8.0, 'brick': 8.0, 'race': 10.0,
        'strength': 4.5, 'core': 3.5,
    }
    carbs_g = round(weight * carb_map.get(day_type, 5.0), 1)
    fat_g = round(weight * 1.2, 1)

    # Recalculate calories from macros (more accurate)
    calories_from_macro = int(protein_g * 4 + carbs_g * 4 + fat_g * 9)
    calories = max(calories, calories_from_macro)

    # Fiber
    fiber_g = round(calories / 1000 * 14, 1)

    # Water: base 35ml/kg + training load
    water_additions = {
        'rest': 0, 'easy': 500, 'tempo': 750, 'interval': 1000,
        'long': 1500, 'brick': 1500, 'race': 2000, 'strength': 500,
    }
    water_ml = int(weight * 35) + water_additions.get(day_type, 300)

    # Sleep target
    sleep_targets = {'base': 8.0, 'build': 8.5, 'peak': 9.0, 'taper': 9.0}
    sleep_hours = sleep_targets.get(block_type, 8.0)

    return {
        'calories_kcal': calories,
        'protein_g': protein_g,
        'carbs_g': carbs_g,
        'fat_g': fat_g,
        'fiber_g': fiber_g,
        'water_ml': water_ml,
        'sleep_target_hours': sleep_hours,
        # Micronutrient targets (per day — based on athlete RDAs)
        'iron_mg': 18.0 if (profile.get('gender') or '').lower() == 'female' else 8.0,
        'calcium_mg': 1000.0,
        'vitamin_d_mcg': 15.0,
        'vitamin_b12_mcg': 2.4,
        'vitamin_c_mg': 90.0,
        'magnesium_mg': 400.0,
        'potassium_mg': 3500.0,
        'zinc_mg': 11.0,
        'sodium_mg': min(2300, 1500 + int(weight * 5)),
    }


def calc_nutrients_from_log(food_entries: list) -> dict:
    totals = {
        'calories': 0.0, 'protein_g': 0.0, 'carbs_g': 0.0, 'fat_g': 0.0,
        'fiber_g': 0.0, 'iron_mg': 0.0, 'calcium_mg': 0.0, 'vitamin_d_mcg': 0.0,
        'vitamin_b12_mcg': 0.0, 'vitamin_c_mg': 0.0, 'magnesium_mg': 0.0,
        'potassium_mg': 0.0, 'zinc_mg': 0.0, 'sodium_mg': 0.0,
    }
    for entry in food_entries:
        ratio = float(entry.get('amount_g', 0)) / 100.0
        totals['calories'] += float(entry.get('calories_per_100g') or 0) * ratio
        totals['protein_g'] += float(entry.get('protein_per_100g') or 0) * ratio
        totals['carbs_g'] += float(entry.get('carbs_per_100g') or 0) * ratio
        totals['fat_g'] += float(entry.get('fat_per_100g') or 0) * ratio
        totals['fiber_g'] += float(entry.get('fiber_per_100g') or 0) * ratio
        totals['iron_mg'] += float(entry.get('iron_per_100g') or 0) * ratio
        totals['calcium_mg'] += float(entry.get('calcium_per_100g') or 0) * ratio
        totals['vitamin_d_mcg'] += float(entry.get('vitamin_d_per_100g') or 0) * ratio
        totals['vitamin_b12_mcg'] += float(entry.get('vitamin_b12_per_100g') or 0) * ratio
        totals['vitamin_c_mg'] += float(entry.get('vitamin_c_per_100g') or 0) * ratio
        totals['magnesium_mg'] += float(entry.get('magnesium_per_100g') or 0) * ratio
        totals['potassium_mg'] += float(entry.get('potassium_per_100g') or 0) * ratio
        totals['zinc_mg'] += float(entry.get('zinc_per_100g') or 0) * ratio
        totals['sodium_mg'] += float(entry.get('sodium_per_100g') or 0) * ratio
    return {k: round(v, 2) for k, v in totals.items()}
