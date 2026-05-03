"""
Periodization plan generator.
Implements progressive overload, polarized intensity (80/20), and
block periodization (Base→Build→Peak→Taper) across all goal types.
"""
from datetime import date, timedelta
import math

# --- Block proportions (fraction of total weeks) ---
BLOCK_RATIOS = {
    '5k':             {'base': 0.40, 'build': 0.40, 'peak': 0.10, 'taper': 0.10},
    '10k':            {'base': 0.40, 'build': 0.40, 'peak': 0.10, 'taper': 0.10},
    'half_marathon':  {'base': 0.35, 'build': 0.40, 'peak': 0.15, 'taper': 0.10},
    'marathon':       {'base': 0.30, 'build': 0.40, 'peak': 0.20, 'taper': 0.10},
    'sprint_triathlon': {'base': 0.40, 'build': 0.40, 'peak': 0.10, 'taper': 0.10},
    'half_ironman':   {'base': 0.35, 'build': 0.40, 'peak': 0.15, 'taper': 0.10},
    'ironman':        {'base': 0.30, 'build': 0.40, 'peak': 0.20, 'taper': 0.10},
    'cycling_event':  {'base': 0.35, 'build': 0.40, 'peak': 0.15, 'taper': 0.10},
    'strength':       {'base': 0.40, 'build': 0.40, 'peak': 0.15, 'taper': 0.05},
    'general_fitness': {'base': 0.50, 'build': 0.50, 'peak': 0.00, 'taper': 0.00},
}

# Starting weekly hours by fitness level
START_HOURS = {
    'beginner':    {'run': 3.0, 'triathlon': 5.0, 'cycling': 4.0, 'strength': 3.0, 'fitness': 2.0},
    'intermediate': {'run': 5.0, 'triathlon': 8.0, 'cycling': 6.0, 'strength': 4.0, 'fitness': 3.5},
    'advanced':    {'run': 8.0, 'triathlon': 12.0, 'cycling': 9.0, 'strength': 5.0, 'fitness': 5.0},
    'elite':       {'run': 12.0, 'triathlon': 16.0, 'cycling': 13.0, 'strength': 6.0, 'fitness': 7.0},
}

IS_TRIATHLON = {'sprint_triathlon', 'half_ironman', 'ironman'}
IS_RUNNING = {'5k', '10k', 'half_marathon', 'marathon'}
IS_CYCLING = {'cycling_event'}
IS_STRENGTH = {'strength'}


def generate_plan(goal: dict, profile: dict) -> dict:
    """
    Returns a dict with keys: plan_weeks (list), plan_days (list), workouts (list)
    """
    goal_type = goal['goal_type']
    target_date = _parse_date(goal['target_date'])
    start_date = date.today()
    total_days = (target_date - start_date).days
    total_weeks = max(4, total_days // 7)

    fitness_level = (profile or {}).get('fitness_level', 'beginner')
    current_weekly_hours = float((profile or {}).get('current_weekly_hours') or
                                 _default_start_hours(goal_type, fitness_level))

    ratios = BLOCK_RATIOS.get(goal_type, BLOCK_RATIOS['general_fitness'])
    block_weeks = _assign_block_weeks(total_weeks, ratios)

    weeks_data, days_data, workouts_data = [], [], []
    week_num = 1
    current_date = start_date
    weekly_hours = current_weekly_hours

    for block_type, num_weeks in block_weeks:
        for w in range(num_weeks):
            is_recovery = (w + 1) % 4 == 0 and block_type in ('base', 'build')
            if is_recovery:
                target_hours = round(weekly_hours * 0.70, 1)
            else:
                if w > 0:
                    weekly_hours = min(weekly_hours * 1.10, _max_hours(goal_type, fitness_level))
                target_hours = round(weekly_hours, 1)

            week_start = current_date
            week = {
                'week_number': week_num,
                'week_start': week_start.isoformat(),
                'block_type': block_type,
                'weekly_hours_target': target_hours,
                'weekly_tss_target': int(target_hours * 50),
            }
            weeks_data.append(week)

            # Generate 7 days
            days_for_week = _generate_days(
                goal_type, block_type, week_num, week_start, target_hours, is_recovery, profile or {}
            )
            for day_entry in days_for_week:
                days_data.append(day_entry['day'])
                workouts_data.extend(day_entry['workouts'])

            current_date = week_start + timedelta(weeks=1)
            week_num += 1

    # Add race day
    race_day = {
        'date': target_date.isoformat(),
        'day_type': 'race',
        'ai_adjusted': False,
        'notes': f"Race day — {goal['goal_name']}",
    }
    days_data.append(race_day)
    if goal_type in IS_TRIATHLON:
        workouts_data.extend(_triathlon_race_workouts(target_date, goal_type))
    elif goal_type in IS_RUNNING:
        workouts_data.append(_run_workout(target_date, 'race', 'Race', None, 5, 1))

    return {'weeks': weeks_data, 'days': days_data, 'workouts': workouts_data}


def _generate_days(goal_type, block_type, week_num, week_start, total_hours, is_recovery, profile):
    if goal_type in IS_TRIATHLON:
        return _triathlon_week(goal_type, block_type, week_start, total_hours, is_recovery)
    elif goal_type in IS_RUNNING:
        return _running_week(goal_type, block_type, week_start, total_hours, is_recovery)
    elif goal_type in IS_CYCLING:
        return _cycling_week(block_type, week_start, total_hours, is_recovery)
    elif goal_type in IS_STRENGTH:
        return _strength_week(block_type, week_start, total_hours, is_recovery)
    else:
        return _fitness_week(block_type, week_start, total_hours, is_recovery)


# --- Running week templates ---
def _running_week(goal_type, block_type, week_start, total_hours, is_recovery):
    days = []
    h = total_hours
    if is_recovery:
        # Recovery week: 3 easy runs, 1 long
        schedule = [
            (0, 'rest'),
            (1, 'easy', 0.20 * h),
            (2, 'rest'),
            (3, 'easy', 0.20 * h),
            (4, 'rest'),
            (5, 'long', 0.45 * h),
            (6, 'easy', 0.15 * h),
        ]
    elif block_type == 'base':
        schedule = [
            (0, 'rest'),
            (1, 'easy', 0.18 * h),
            (2, 'strength', 0.15 * h),
            (3, 'easy', 0.20 * h),
            (4, 'rest'),
            (5, 'long', 0.40 * h),
            (6, 'easy', 0.12 * h),
        ]
    elif block_type == 'build':
        schedule = [
            (0, 'rest'),
            (1, 'easy', 0.15 * h),
            (2, 'tempo', 0.20 * h),
            (3, 'easy', 0.18 * h),
            (4, 'strength', 0.12 * h),
            (5, 'long', 0.38 * h),
            (6, 'easy', 0.10 * h),
        ]
    elif block_type == 'peak':
        schedule = [
            (0, 'rest'),
            (1, 'easy', 0.12 * h),
            (2, 'interval', 0.22 * h),
            (3, 'easy', 0.15 * h),
            (4, 'tempo', 0.18 * h),
            (5, 'long', 0.35 * h),
            (6, 'easy', 0.10 * h),
        ]
    else:  # taper
        schedule = [
            (0, 'rest'),
            (1, 'easy', 0.20 * h),
            (2, 'tempo', 0.15 * h),
            (3, 'rest'),
            (4, 'easy', 0.15 * h),
            (5, 'easy', 0.10 * h),
            (6, 'rest'),
        ]

    return _schedule_to_days(schedule, week_start, 'run', goal_type)


# --- Triathlon week templates ---
def _triathlon_week(goal_type, block_type, week_start, total_hours, is_recovery):
    h = total_hours
    # Sport allocation: swim/bike/run
    if block_type == 'base':
        alloc = {'swim': 0.20, 'bike': 0.50, 'run': 0.30}
    elif block_type == 'build':
        alloc = {'swim': 0.20, 'bike': 0.45, 'run': 0.35}
    else:
        alloc = {'swim': 0.18, 'bike': 0.42, 'run': 0.40}

    swim_h = h * alloc['swim']
    bike_h = h * alloc['bike']
    run_h = h * alloc['run']

    if is_recovery:
        schedule = [
            (0, 'rest'),
            (1, 'swim', swim_h * 0.50, 1),
            (2, 'easy', run_h * 0.30, 2),
            (3, 'cycle', bike_h * 0.40, 2),
            (4, 'rest'),
            (5, 'cycle', bike_h * 0.50, 2),
            (6, 'easy', run_h * 0.30, 2),
        ]
    elif block_type in ('base', 'build'):
        schedule = [
            (0, 'rest'),
            (1, 'swim', swim_h * 0.50, 2),
            (2, 'easy', run_h * 0.30, 2),
            (3, 'cycle', bike_h * 0.40, 2),
            (4, 'swim', swim_h * 0.50, 2),
            (5, 'brick', (bike_h * 0.50) + (run_h * 0.25), 3),
            (6, 'long', run_h * 0.45, 2),
        ]
    else:  # peak
        schedule = [
            (0, 'rest'),
            (1, 'swim', swim_h * 0.50, 3),
            (2, 'interval', run_h * 0.30, 4),
            (3, 'cycle', bike_h * 0.40, 3),
            (4, 'swim', swim_h * 0.50, 3),
            (5, 'brick', (bike_h * 0.50) + (run_h * 0.25), 4),
            (6, 'easy', run_h * 0.30, 2),
        ]

    result = []
    for item in schedule:
        day_offset = item[0]
        day_type = item[1]
        day_date = week_start + timedelta(days=day_offset)
        day = {'date': day_date.isoformat(), 'day_type': day_type, 'ai_adjusted': False, 'notes': None}

        if day_type == 'rest':
            result.append({'day': day, 'workouts': []})
            continue

        sport = day_type if day_type not in ('easy', 'interval', 'long', 'tempo') else 'run'
        if day_type == 'brick':
            sport = 'brick'

        duration_h = item[2]
        zone = item[3] if len(item) > 3 else 2
        duration_min = max(20, int(duration_h * 60))
        workout = _make_workout(day_date, sport, day_type, duration_min, zone, goal_type)
        result.append({'day': day, 'workouts': [workout]})

    return result


# --- Cycling week ---
def _cycling_week(block_type, week_start, total_hours, is_recovery):
    h = total_hours
    if is_recovery:
        schedule = [(0, 'rest'), (1, 'easy', 0.20*h), (2, 'rest'), (3, 'easy', 0.25*h),
                    (4, 'rest'), (5, 'long', 0.40*h), (6, 'easy', 0.15*h)]
    elif block_type == 'base':
        schedule = [(0, 'rest'), (1, 'easy', 0.20*h), (2, 'strength', 0.15*h),
                    (3, 'easy', 0.25*h), (4, 'rest'), (5, 'long', 0.40*h), (6, 'easy', 0.15*h)]
    elif block_type == 'build':
        schedule = [(0, 'rest'), (1, 'easy', 0.15*h), (2, 'tempo', 0.22*h),
                    (3, 'easy', 0.18*h), (4, 'rest'), (5, 'long', 0.42*h), (6, 'easy', 0.12*h)]
    else:  # peak or taper
        schedule = [(0, 'rest'), (1, 'easy', 0.18*h), (2, 'interval', 0.20*h),
                    (3, 'easy', 0.15*h), (4, 'rest'), (5, 'long', 0.38*h), (6, 'easy', 0.10*h)]
    return _schedule_to_days(schedule, week_start, 'cycle', 'cycling_event')


# --- Strength week ---
def _strength_week(block_type, week_start, total_hours, is_recovery):
    h = total_hours
    if block_type in ('base', 'build'):
        schedule = [(0, 'rest'), (1, 'strength', 0.30*h), (2, 'core', 0.15*h),
                    (3, 'strength', 0.30*h), (4, 'rest'), (5, 'strength', 0.25*h), (6, 'core', 0.15*h)]
    else:
        schedule = [(0, 'rest'), (1, 'strength', 0.35*h), (2, 'rest'),
                    (3, 'strength', 0.35*h), (4, 'rest'), (5, 'strength', 0.30*h), (6, 'rest')]
    return _schedule_to_days(schedule, week_start, 'strength', 'strength')


# --- General fitness week ---
def _fitness_week(block_type, week_start, total_hours, is_recovery):
    h = total_hours
    schedule = [(0, 'rest'), (1, 'easy', 0.25*h), (2, 'strength', 0.20*h),
                (3, 'easy', 0.25*h), (4, 'rest'), (5, 'long', 0.30*h), (6, 'core', 0.15*h)]
    return _schedule_to_days(schedule, week_start, 'run', 'general_fitness')


def _schedule_to_days(schedule, week_start, default_sport, goal_type):
    result = []
    for item in schedule:
        day_offset = item[0]
        day_type = item[1]
        day_date = week_start + timedelta(days=day_offset)
        day = {'date': day_date.isoformat(), 'day_type': day_type, 'ai_adjusted': False, 'notes': None}

        if day_type == 'rest':
            result.append({'day': day, 'workouts': []})
            continue

        duration_h = item[2] if len(item) > 2 else 0
        duration_min = max(20, int(duration_h * 60))
        sport = _day_type_to_sport(day_type, default_sport)
        zone = _day_type_to_zone(day_type)
        workout = _make_workout(day_date, sport, day_type, duration_min, zone, goal_type)
        result.append({'day': day, 'workouts': [workout]})

    return result


def _make_workout(workout_date, sport, day_type, duration_min, zone, goal_type):
    titles = {
        'easy': f'Easy {_sport_label(sport)}',
        'tempo': f'Tempo {_sport_label(sport)}',
        'interval': f'Interval {_sport_label(sport)}',
        'long': f'Long {_sport_label(sport)}',
        'strength': 'Strength Training',
        'core': 'Core & Mobility',
        'brick': 'Brick Workout (Bike+Run)',
        'race': f'Race — {_sport_label(sport)}',
        'swim': 'Swim',
        'cycle': f'Ride',
    }
    descriptions = {
        'easy': f'Conversational pace, Zone {zone}. Focus on aerobic base.',
        'tempo': f'Comfortably hard, Zone {zone}. Sustained effort.',
        'interval': f'High intensity intervals, Zone {zone}. Quality work.',
        'long': f'Long slow distance, Zone {zone}. Build endurance.',
        'strength': 'Full body strength. Focus on functional movements.',
        'core': 'Core stability and flexibility work.',
        'brick': 'Bike followed immediately by run. Practice transitions.',
        'race': 'Race effort. Execute your plan.',
        'swim': f'Swim workout, Zone {zone}.',
        'cycle': f'Cycling session, Zone {zone}.',
    }
    tss = _calc_tss(duration_min, zone)
    distance_km = _estimate_distance(sport, duration_min, zone)

    return {
        'sport': sport,
        'title': titles.get(day_type, f'{_sport_label(sport)} Workout'),
        'duration_min': duration_min,
        'distance_km': distance_km,
        'intensity_zone': zone,
        'tss': tss,
        'description': descriptions.get(day_type, ''),
        'structure': None,
        '_workout_date': workout_date.isoformat(),
    }


def _run_workout(workout_date, day_type, title, duration_min, zone, tss):
    return {
        'sport': 'run',
        'title': title,
        'duration_min': duration_min,
        'distance_km': None,
        'intensity_zone': zone,
        'tss': tss,
        'description': '',
        'structure': None,
        '_workout_date': workout_date.isoformat(),
    }


def _triathlon_race_workouts(race_date, goal_type):
    distances = {
        'sprint_triathlon': (0.75, 20, 5),
        'half_ironman': (1.9, 90, 21.1),
        'ironman': (3.8, 180, 42.2),
    }
    swim_km, bike_km, run_km = distances.get(goal_type, (1.9, 90, 21.1))
    return [
        {'sport': 'swim', 'title': 'Race Swim', 'duration_min': int(swim_km * 25),
         'distance_km': swim_km, 'intensity_zone': 4, 'tss': 60,
         'description': 'Race start. Sight regularly.', 'structure': None,
         '_workout_date': race_date.isoformat()},
        {'sport': 'cycle', 'title': 'Race Bike', 'duration_min': int(bike_km * 2.5),
         'distance_km': bike_km, 'intensity_zone': 4, 'tss': 150,
         'description': 'Steady effort. Fuel every 20 min.', 'structure': None,
         '_workout_date': race_date.isoformat()},
        {'sport': 'run', 'title': 'Race Run', 'duration_min': int(run_km * 5.5),
         'distance_km': run_km, 'intensity_zone': 4, 'tss': 120,
         'description': 'Run your race. Dig deep.', 'structure': None,
         '_workout_date': race_date.isoformat()},
    ]


# --- Helpers ---
def _assign_block_weeks(total_weeks, ratios):
    blocks = []
    for block_type in ('base', 'build', 'peak', 'taper'):
        n = max(1 if ratios[block_type] > 0 else 0, round(total_weeks * ratios[block_type]))
        if n > 0:
            blocks.append((block_type, n))
    # Adjust total to match
    assigned = sum(n for _, n in blocks)
    diff = total_weeks - assigned
    if diff > 0:
        blocks[1] = (blocks[1][0], blocks[1][1] + diff)
    return blocks


def _default_start_hours(goal_type, fitness_level):
    category = 'run'
    if goal_type in IS_TRIATHLON:
        category = 'triathlon'
    elif goal_type in IS_CYCLING:
        category = 'cycling'
    elif goal_type in IS_STRENGTH:
        category = 'strength'
    elif goal_type == 'general_fitness':
        category = 'fitness'
    return START_HOURS.get(fitness_level, START_HOURS['beginner'])[category]


def _max_hours(goal_type, fitness_level):
    caps = {
        'beginner': 10, 'intermediate': 16, 'advanced': 22, 'elite': 30
    }
    if goal_type in IS_TRIATHLON:
        caps = {'beginner': 14, 'intermediate': 20, 'advanced': 28, 'elite': 35}
    return caps.get(fitness_level, 10)


def _day_type_to_sport(day_type, default_sport):
    mapping = {'strength': 'strength', 'core': 'core', 'swim': 'swim', 'cycle': 'cycle', 'brick': 'brick'}
    return mapping.get(day_type, default_sport)


def _day_type_to_zone(day_type):
    mapping = {'easy': 2, 'long': 2, 'tempo': 3, 'interval': 4, 'strength': 2, 'core': 1, 'brick': 3}
    return mapping.get(day_type, 2)


def _sport_label(sport):
    labels = {'run': 'Run', 'cycle': 'Ride', 'swim': 'Swim', 'strength': 'Strength',
              'core': 'Core', 'brick': 'Brick'}
    return labels.get(sport, sport.title())


def _calc_tss(duration_min, zone):
    intensity_factor = {1: 0.55, 2: 0.75, 3: 0.90, 4: 1.05, 5: 1.15}
    if_val = intensity_factor.get(zone, 0.75)
    return int((duration_min / 60) * (if_val ** 2) * 100)


def _estimate_distance(sport, duration_min, zone):
    pace = {  # minutes per km
        'run': {1: 7.0, 2: 6.5, 3: 5.5, 4: 4.5, 5: 4.0},
        'cycle': {1: 2.5, 2: 2.2, 3: 1.9, 4: 1.7, 5: 1.5},
        'swim': {1: 3.0, 2: 2.5, 3: 2.2, 4: 2.0, 5: 1.8},
    }
    p = pace.get(sport, {}).get(zone)
    if not p:
        return None
    return round(duration_min / p, 2)


def _parse_date(d):
    if isinstance(d, date):
        return d
    from datetime import datetime
    return datetime.strptime(str(d)[:10], '%Y-%m-%d').date()
