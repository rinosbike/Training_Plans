"""
TDEE calculator and nutrition target engine for endurance athletes.

Calorie model:
  Total = BMR × NEAT_factor + Exercise Energy Expenditure (EEE) + EPOC
  EEE is calculated per-workout using MET × weight × duration (more accurate than
  a flat activity multiplier, which under-estimates heavy training days by 30-50%).

Macro model (ISSN 2018 + Burke periodisation guidelines):
  Protein : 1.8 g/kg base → 2.2 g/kg heavy/peak (muscle repair, adaptation)
  Carbs   : 4 g/kg rest → up to 10 g/kg for 3+ hr sessions (glycogen, performance)
  Fat     : residual to hit calorie target, minimum 1.0 g/kg (hormone production)

Micronutrients use athlete-specific RDAs (higher than sedentary population for
iron, magnesium, sodium, vitamin D, vitamin C, omega-3).
"""
from datetime import date


# MET values (metabolic equivalent of task) per sport/zone
# Source: Compendium of Physical Activities (Ainsworth 2011) + endurance sport research
_MET = {
    ('swim',     1): 5.5,  ('swim',     2): 7.0,  ('swim',     3): 9.5,
    ('swim',     4): 11.0, ('swim',     5): 13.0,
    ('cycle',    1): 6.0,  ('cycle',    2): 8.0,  ('cycle',    3): 10.5,
    ('cycle',    4): 13.0, ('cycle',    5): 15.0,
    ('run',      1): 7.0,  ('run',      2): 9.0,  ('run',      3): 11.0,
    ('run',      4): 13.0, ('run',      5): 14.5,
    ('brick',    1): 8.0,  ('brick',    2): 9.5,  ('brick',    3): 11.5,
    ('brick',    4): 13.5, ('brick',    5): 15.0,
    ('strength', 1): 3.5,  ('strength', 2): 5.0,  ('strength', 3): 6.0,
    ('core',     1): 3.0,  ('core',     2): 3.5,
}


def _bmr(profile: dict) -> float:
    weight = float(profile.get('weight_kg') or 70)
    height = float(profile.get('height_cm') or 175)
    gender = (profile.get('gender') or 'male').lower()
    dob    = profile.get('date_of_birth')
    age    = 30
    if dob:
        try:
            from datetime import datetime
            if isinstance(dob, str):
                dob = datetime.strptime(str(dob)[:10], '%Y-%m-%d').date()
            age = (date.today() - dob).days // 365
        except Exception:
            pass
    # Mifflin-St Jeor
    if gender == 'female':
        return 10 * weight + 6.25 * height - 5 * age - 161
    return 10 * weight + 6.25 * height - 5 * age + 5


def _eee(workouts: list, weight: float) -> float:
    """Exercise Energy Expenditure: MET × weight_kg × duration_hr."""
    total = 0.0
    for w in workouts:
        sport    = w.get('sport', 'run')
        zone     = int(w.get('intensity_zone') or 2)
        dur_min  = float(w.get('duration_min') or 0)
        met      = _MET.get((sport, zone)) or _MET.get((sport, 2)) or 8.0
        total   += met * weight * (dur_min / 60.0)
    return total


def _epoc_factor(workouts: list) -> float:
    """Post-exercise oxygen consumption bonus (% of EEE).
    Easy sessions: 5 %, threshold: 10 %, VO2max/race: 15 %."""
    if not workouts:
        return 0.0
    max_zone = max(int(w.get('intensity_zone') or 1) for w in workouts)
    return 0.05 if max_zone <= 2 else 0.10 if max_zone == 3 else 0.15


def calc_tdee(profile: dict, workouts: list = None, day_type: str = 'rest') -> int:
    """
    Total Daily Energy Expenditure.
    NEAT = BMR × 1.30 (covers all non-exercise movement + thermic effect of food).
    EEE  = MET-based exercise calories.
    EPOC = 5-15% of EEE depending on intensity.
    """
    bmr   = _bmr(profile)
    neat  = bmr * 1.30          # non-exercise activity thermogenesis
    weight = float(profile.get('weight_kg') or 70)

    if workouts:
        exercise = _eee(workouts, weight)
        epoc     = exercise * _epoc_factor(workouts)
    else:
        # Fallback estimate when no workout data available
        _fallback = {
            'rest': 0, 'easy': bmr * 0.25, 'tempo': bmr * 0.45,
            'interval': bmr * 0.60, 'long': bmr * 0.80, 'brick': bmr * 0.90,
            'race': bmr * 1.20, 'strength': bmr * 0.35, 'core': bmr * 0.15,
            'swim': bmr * 0.40, 'cycle': bmr * 0.50,
        }
        exercise = _fallback.get(day_type, bmr * 0.30)
        epoc     = exercise * 0.07

    return int(neat + exercise + epoc)


def calc_targets(profile: dict, workouts: list = None,
                 day_type: str = 'rest', block_type: str = 'base') -> dict:
    weight = float(profile.get('weight_kg') or 70)
    gender = (profile.get('gender') or 'male').lower()

    calories = calc_tdee(profile, workouts, day_type)

    wos          = workouts or []
    total_min    = sum(float(w.get('duration_min') or 0) for w in wos)
    max_zone     = max((int(w.get('intensity_zone') or 1) for w in wos), default=1)
    is_heavy     = total_min > 120 or max_zone >= 4
    is_very_heavy = total_min > 180 or (total_min > 120 and max_zone >= 4)

    # --- Protein ---
    # Higher during Build/Peak and on heavy sessions; muscle protein synthesis
    if block_type in ('peak', 'taper') or is_very_heavy:
        prot_per_kg = 2.2
    elif block_type == 'build' or is_heavy:
        prot_per_kg = 2.0
    else:
        prot_per_kg = 1.8
    protein_g = round(weight * prot_per_kg, 1)

    # --- Carbohydrates (Burke 2011 guidelines for endurance athletes) ---
    # Scaled to workout volume: glycogen is the primary limiting fuel.
    # Race day uses a separate meal-based model (athlete fuels ~60-90g/hr DURING
    # the race via gels/isotonics — that is not counted here).
    if day_type == 'race':
        # Pre + post race meals: high-carb load, recovery protein
        carb_per_kg  = 8.0
        prot_per_kg  = 2.2
        protein_g    = round(weight * prot_per_kg, 1)
        fat_per_kg   = 1.0
        fat_g        = round(weight * fat_per_kg, 1)
        calories     = int(protein_g * 4 + round(weight * carb_per_kg, 1) * 4 + fat_g * 9)
        carbs_g      = round(weight * carb_per_kg, 1)
    else:
        if total_min == 0 or day_type == 'rest':
            carb_per_kg = 4.0       # rest: maintenance + glycogen top-up
        elif total_min <= 60:
            carb_per_kg = 5.0 + (max_zone - 1) * 0.4
        elif total_min <= 120:
            carb_per_kg = 6.5 + (max_zone - 1) * 0.5
        elif total_min <= 180:
            carb_per_kg = 8.0 + (max_zone - 1) * 0.4
        else:
            # >3 hours: up to 10 g/kg
            carb_per_kg = min(10.0, 9.0 + (max_zone - 1) * 0.3)
        carbs_g = round(weight * carb_per_kg, 1)

        # Fat: residual to hit calorie target, minimum 1.0 g/kg
        macro_calories = protein_g * 4 + carbs_g * 4
        fat_g = round(max(weight * 1.0, (calories - macro_calories) / 9.0), 1)

    # Recalculate final calories from macros (macros drive calories, not the other way)
    calories = int(protein_g * 4 + carbs_g * 4 + fat_g * 9)

    # --- Fiber ---
    fiber_g = round(calories / 1000 * 14, 1)

    # --- Water (ml): 35 ml/kg baseline + ~500-750 ml per hour of exercise ---
    water_ml = int(weight * 35) + int(total_min * 8)  # ~500 ml/hr

    # --- Sleep ---
    sleep_targets = {'base': 8.0, 'build': 8.5, 'peak': 9.0, 'taper': 9.0}
    sleep_hours = sleep_targets.get(block_type, 8.0)

    # --- Sodium (electrolyte replacement) ---
    # Athletes lose 500-1500 mg sodium/hr in sweat; scale to workout load
    # Standard RDA is 1500-2300 mg; athletes need more on training days
    sodium_base = 1500
    sodium_training = int(total_min * 15)   # ~900 mg/hr sweat loss
    sodium_mg = min(4000, sodium_base + sodium_training)

    # --- Magnesium (athlete RDA: 400-600 mg; lost in sweat, needed for muscle function) ---
    magnesium_mg = 400 + int(total_min * 1.2)  # +72 mg/hr exercise
    magnesium_mg = min(600, magnesium_mg)

    # --- Potassium (muscle contraction, heart, fluid balance) ---
    potassium_mg = 4000 + int(total_min * 5)   # ~300 mg/hr loss
    potassium_mg = min(5000, potassium_mg)

    # --- Iron (endurance athletes lose via sweat, foot-strike hemolysis, GI) ---
    # Male athletes: 11.6 mg (vs 8 mg RDA). Female athletes: 21 mg (vs 18 mg RDA)
    iron_mg = 21.0 if gender == 'female' else 11.6

    # --- Vitamin D (athletes in northern climates often deficient; 2000-4000 IU) ---
    # Estonian latitude → minimal sun synthesis Oct-Apr → aim for 50-100 mcg/day
    vitamin_d_mcg = 75.0   # ≈ 3000 IU — upper-safe high-performer target

    # --- Other micronutrients ---
    return {
        'calories_kcal':    calories,
        'protein_g':        protein_g,
        'carbs_g':          carbs_g,
        'fat_g':            fat_g,
        'fiber_g':          fiber_g,
        'water_ml':         water_ml,
        'sleep_target_hours': sleep_hours,
        # Electrolytes
        'sodium_mg':        sodium_mg,
        'potassium_mg':     potassium_mg,
        'magnesium_mg':     magnesium_mg,
        'calcium_mg':       1200.0,      # bone density, muscle contraction
        # Vitamins
        'iron_mg':          iron_mg,
        'vitamin_d_mcg':    vitamin_d_mcg,
        'vitamin_b12_mcg':  3.0,         # slightly above RDA; important for red blood cells
        'vitamin_c_mg':     250.0,       # antioxidant recovery; athlete target 200-500 mg
        'zinc_mg':          13.0,        # immune + testosterone; athletes need more than RDA
        # Omega-3 (anti-inflammatory, joint/tendon health — critical for high training load)
        'omega3_g':         round(min(4.0, 2.0 + (total_min / 60) * 0.3), 1),  # 2–4 g/day
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
        totals['calories']       += float(entry.get('calories_per_100g')   or 0) * ratio
        totals['protein_g']      += float(entry.get('protein_per_100g')    or 0) * ratio
        totals['carbs_g']        += float(entry.get('carbs_per_100g')      or 0) * ratio
        totals['fat_g']          += float(entry.get('fat_per_100g')        or 0) * ratio
        totals['fiber_g']        += float(entry.get('fiber_per_100g')      or 0) * ratio
        totals['iron_mg']        += float(entry.get('iron_per_100g')       or 0) * ratio
        totals['calcium_mg']     += float(entry.get('calcium_per_100g')    or 0) * ratio
        totals['vitamin_d_mcg']  += float(entry.get('vitamin_d_per_100g') or 0) * ratio
        totals['vitamin_b12_mcg']+= float(entry.get('vitamin_b12_per_100g') or 0) * ratio
        totals['vitamin_c_mg']   += float(entry.get('vitamin_c_per_100g') or 0) * ratio
        totals['magnesium_mg']   += float(entry.get('magnesium_per_100g') or 0) * ratio
        totals['potassium_mg']   += float(entry.get('potassium_per_100g') or 0) * ratio
        totals['zinc_mg']        += float(entry.get('zinc_per_100g')       or 0) * ratio
        totals['sodium_mg']      += float(entry.get('sodium_per_100g')     or 0) * ratio
    return {k: round(v, 2) for k, v in totals.items()}
