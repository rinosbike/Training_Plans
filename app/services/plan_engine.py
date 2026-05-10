"""
Periodization plan generator.
Implements progressive overload, polarized intensity (80/20), and
block periodization (Base→Build→Peak→Taper) for endurance goals.
"""
from datetime import date, timedelta
import math

BLOCK_RATIOS = {
    '5k':               {'base': 0.40, 'build': 0.40, 'peak': 0.10, 'taper': 0.10},
    '10k':              {'base': 0.40, 'build': 0.40, 'peak': 0.10, 'taper': 0.10},
    'half_marathon':    {'base': 0.35, 'build': 0.40, 'peak': 0.15, 'taper': 0.10},
    'marathon':         {'base': 0.30, 'build': 0.40, 'peak': 0.20, 'taper': 0.10},
    'sprint_triathlon': {'base': 0.40, 'build': 0.40, 'peak': 0.10, 'taper': 0.10},
    'half_ironman':     {'base': 0.35, 'build': 0.40, 'peak': 0.15, 'taper': 0.10},
    'ironman':          {'base': 0.25, 'build': 0.45, 'peak': 0.18, 'taper': 0.12},
    'cycling_event':    {'base': 0.35, 'build': 0.40, 'peak': 0.15, 'taper': 0.10},
    'strength':         {'base': 0.40, 'build': 0.40, 'peak': 0.15, 'taper': 0.05},
    'general_fitness':  {'base': 0.50, 'build': 0.50, 'peak': 0.00, 'taper': 0.00},
}

START_HOURS = {
    'beginner':    {'run': 3.0, 'triathlon': 6.0,  'cycling': 4.0, 'strength': 3.0, 'fitness': 2.0},
    'intermediate': {'run': 5.0, 'triathlon': 10.0, 'cycling': 6.0, 'strength': 4.0, 'fitness': 3.5},
    'advanced':    {'run': 8.0, 'triathlon': 14.0, 'cycling': 9.0, 'strength': 5.0, 'fitness': 5.0},
    'elite':       {'run': 12.0, 'triathlon': 18.0, 'cycling': 13.0, 'strength': 6.0, 'fitness': 7.0},
}

MAX_HOURS = {
    'beginner':    {'run': 10,  'triathlon': 12, 'cycling': 10, 'strength': 8,  'fitness': 8},
    'intermediate': {'run': 14, 'triathlon': 16, 'cycling': 14, 'strength': 10, 'fitness': 10},
    'advanced':    {'run': 18,  'triathlon': 22, 'cycling': 18, 'strength': 12, 'fitness': 12},
    'elite':       {'run': 22,  'triathlon': 28, 'cycling': 22, 'strength': 15, 'fitness': 15},
}

IS_TRIATHLON = {'sprint_triathlon', 'half_ironman', 'ironman'}
IS_RUNNING   = {'5k', '10k', 'half_marathon', 'marathon'}
IS_CYCLING   = {'cycling_event'}
IS_STRENGTH  = {'strength'}


def generate_plan(goal: dict, profile: dict) -> dict:
    goal_type = goal['goal_type']
    target_date = _parse_date(goal['target_date'])
    start_date = date.today()
    total_days = (target_date - start_date).days
    total_weeks = max(4, total_days // 7)

    fitness_level = (profile or {}).get('fitness_level', 'intermediate')
    current_weekly_hours = float((profile or {}).get('current_weekly_hours') or
                                 _default_start_hours(goal_type, fitness_level))

    ratios = BLOCK_RATIOS.get(goal_type, BLOCK_RATIOS['general_fitness'])
    block_weeks = _assign_block_weeks(total_weeks, ratios)

    weeks_data, days_data, workouts_data = [], [], []
    week_num = 1
    current_date = start_date
    weekly_hours = current_weekly_hours
    max_h = MAX_HOURS.get(fitness_level, MAX_HOURS['intermediate'])
    max_h = max_h.get('triathlon' if goal_type in IS_TRIATHLON else
                      'cycling' if goal_type in IS_CYCLING else
                      'strength' if goal_type in IS_STRENGTH else 'run', 14)

    for block_type, num_weeks in block_weeks:
        for w in range(num_weeks):
            is_recovery = (w + 1) % 4 == 0 and block_type in ('base', 'build')
            if is_recovery:
                target_hours = round(weekly_hours * 0.70, 1)
            else:
                if w > 0:
                    weekly_hours = min(weekly_hours * 1.08, max_h)
                target_hours = round(weekly_hours, 1)

            week = {
                'week_number': week_num,
                'week_start': current_date.isoformat(),
                'block_type': block_type,
                'weekly_hours_target': target_hours,
                'weekly_tss_target': int(target_hours * 55),
            }
            weeks_data.append(week)

            days_for_week = _generate_days(
                goal_type, block_type, week_num, current_date,
                target_hours, is_recovery, profile or {}
            )
            for entry in days_for_week:
                days_data.append(entry['day'])
                workouts_data.extend(entry['workouts'])

            current_date += timedelta(weeks=1)
            week_num += 1

    # Race day
    race_day = {'date': target_date.isoformat(), 'day_type': 'race',
                'ai_adjusted': False, 'notes': f"Race day — {goal['goal_name']}"}
    days_data.append(race_day)
    if goal_type in IS_TRIATHLON:
        workouts_data.extend(_triathlon_race_workouts(target_date, goal_type, profile or {}))
    elif goal_type in IS_RUNNING:
        workouts_data.append({
            'sport': 'run', 'title': 'Race', 'duration_min': None,
            'distance_km': None, 'intensity_zone': 5, 'tss': 150,
            'description': 'Race day. Trust your training. Run YOUR race.',
            'structure': None, '_workout_date': target_date.isoformat()
        })

    return {'weeks': weeks_data, 'days': days_data, 'workouts': workouts_data}


def _generate_days(goal_type, block_type, week_num, week_start, total_hours, is_recovery, profile):
    if goal_type in IS_TRIATHLON:
        return _triathlon_week(goal_type, block_type, week_num, week_start, total_hours, is_recovery, profile)
    elif goal_type in IS_RUNNING:
        return _running_week(goal_type, block_type, week_start, total_hours, is_recovery, profile)
    elif goal_type in IS_CYCLING:
        return _cycling_week(block_type, week_start, total_hours, is_recovery, profile)
    elif goal_type in IS_STRENGTH:
        return _strength_week(block_type, week_start, total_hours, is_recovery)
    else:
        return _fitness_week(block_type, week_start, total_hours, is_recovery)


# ---------------------------------------------------------------------------
# Ironman / Triathlon week builder
# ---------------------------------------------------------------------------

def _triathlon_week(goal_type, block_type, week_num, week_start, total_hours, is_recovery, profile=None):
    """
    Returns list of {day, workouts} entries.
    Multiple workouts per day are supported.

    Weekly structure (Mon=0 … Sun=6):
      Mon: Rest
      Tue: Swim + easy run (doubles in Build/Peak)
      Wed: Bike (threshold or easy)
      Thu: Run (tempo/long)
      Fri: Swim
      Sat: Long ride + brick run (Build/Peak)
      Sun: Long run OR easy
    """
    is_ironman = goal_type == 'ironman'
    p = profile or {}
    ftp = _safe_float(p.get('ftp_watts'))
    css = _safe_float(p.get('css_per_100m'))
    thr = _safe_float(p.get('running_threshold_pace_sec_km'))
    max_hr = _safe_float(p.get('max_hr'))
    rhr = _safe_float(p.get('resting_hr'))

    # Personalised target strings (empty string when metric unavailable)
    _b_z2   = f' ({_ftp_zone_watts(ftp, 0.56, 0.75)})' if ftp else ''
    _b_z3   = f' ({_ftp_zone_watts(ftp, 0.76, 0.88)})' if ftp else ''
    _b_z4   = f' ({_ftp_zone_watts(ftp, 0.88, 1.00)})' if ftp else ''
    _b_race = f' ({_ftp_zone_watts(ftp, 0.70, 0.75)})' if ftp else ''
    _r_z2   = f', {_run_zone_pace(thr, 1.18, 1.28)}' if thr else ''
    _r_z3   = f', {_run_zone_pace(thr, 1.02, 1.10)}' if thr else ''
    _r_hr2  = f' (target {_hr_zone(rhr, max_hr, 2)})' if max_hr else ''
    _r_hr3  = f' (target {_hr_zone(rhr, max_hr, 3)})' if max_hr else ''

    # Sport time allocation (% of weekly hours)
    alloc = (
        {'swim': 0.18, 'bike': 0.52, 'run': 0.30} if block_type in ('base',) else
        {'swim': 0.18, 'bike': 0.50, 'run': 0.32} if block_type == 'build' else
        {'swim': 0.16, 'bike': 0.50, 'run': 0.34}   # peak / taper
    )

    sw = total_hours * alloc['swim']
    bk = total_hours * alloc['bike']
    rn = total_hours * alloc['run']

    days = []

    # --- Monday: Core & Mobility (full rest on recovery weeks) ---
    if is_recovery:
        days.append(_rest_day(week_start, 0))
    elif block_type == 'taper':
        days.append(_rest_day(week_start, 0))
    else:
        core_dur = 25 if block_type == 'base' else 30
        core_desc = (
            f'{core_dur} min triathlon-specific core and mobility. '
            'Dead bugs 3×10 each side. '
            'Front plank 3×45 s. Side plank 3×30 s each. '
            'Single-leg glute bridge 3×12 each. '
            'Bird dog 3×10 each side. '
            'Finish with 5 min foam rolling: IT band, quads, calves, hip flexors. '
            'Purpose: swim body position, aero bike hold, run form at km 35.'
        )
        days.append(_single(week_start, 0, 'core', 'core', core_dur, 1,
                            'Core & Mobility', core_desc))

    # --- Tuesday ---
    if is_recovery:
        days.append(_single(week_start, 1, 'swim', 'swim',
                            _hm(sw * 0.45), 2,
                            'Easy Swim',
                            f'Aerobic recovery swim — {_dist_swim(sw*0.45)} m easy. '
                            'Focus on form: high elbow catch, long glide, bilateral breathing.'))
    else:
        # Swim + optional easy run double (Build/Peak)
        swim_dur = _hm(sw * 0.48)
        swim_title, swim_desc = _swim_session(swim_dur, block_type, 'am', css=css)
        wos = [_w('swim', swim_title, swim_dur,
                  3 if block_type != 'base' else 2, swim_desc, week_start + timedelta(1))]
        if block_type != 'base' and rn > 0:
            run_dur = _hm(rn * 0.20)
            wos.append(_w('run', 'Easy Run (PM)',
                          run_dur, 2,
                          f'{run_dur} min easy Z2{_r_z2} run. Shake out the legs after the morning swim. '
                          'Relaxed pace, conversational effort.',
                          week_start + timedelta(1)))
        days.append(_day(week_start, 1, 'swim', wos))

    # --- Wednesday: Bike ---
    if is_recovery:
        dur = _hm(bk * 0.38)
        days.append(_single(week_start, 2, 'cycle', 'cycle', dur, 2,
                            'Easy Recovery Ride',
                            f'{dur} min Z2 ride. Keep HR below 70% max. '
                            'Spin freely, cadence 85-95 rpm. No intensity today.'))
    elif block_type == 'base':
        dur = _hm(bk * 0.40)
        days.append(_single(week_start, 2, 'cycle', 'cycle', dur, 2,
                            'Aerobic Base Ride',
                            f'{dur} min Z2 ride{_b_z2}. Consistent aerobic effort, cadence 85-95 rpm. '
                            'Build fat-burning efficiency. Heart rate 65-75% of max.'))
    elif block_type == 'build':
        dur = _hm(bk * 0.35)
        days.append(_single(week_start, 2, 'tempo', 'cycle', dur, 3,
                            'Bike Tempo Intervals',
                            f'{dur} min total. WU 15 min easy. '
                            f'Main: 3 × 12 min at Z3 (75-85% FTP{_b_z3}) with 4 min recovery. '
                            'CD 10 min easy. Focus on smooth power output.'))
    else:  # peak
        dur = _hm(bk * 0.32)
        days.append(_single(week_start, 2, 'interval', 'cycle', dur, 4,
                            'Bike Threshold Intervals',
                            f'{dur} min total. WU 15 min. '
                            f'Main: 2 × 20 min at race pace (85-90% FTP{_b_z4}) with 5 min easy. '
                            'CD 10 min. This is your Ironman bike pace — practise it.'))

    # --- Thursday: Run ---
    if is_recovery:
        dur = _hm(rn * 0.35)
        days.append(_single(week_start, 3, 'easy', 'run', dur, 2,
                            'Easy Run',
                            f'{dur} min Z2 recovery run{_r_z2}{_r_hr2}. Fully conversational pace. '
                            'If you feel fatigued, cut to 30 min or rest.'))
    elif block_type == 'base':
        dur = _hm(rn * 0.30)
        days.append(_single(week_start, 3, 'easy', 'run', dur, 2,
                            'Aerobic Base Run',
                            f'{dur} min Z2 run{_r_z2}{_r_hr2}. Easy effort, nose-breathing if possible. '
                            'Focus on relaxed form: light footstrike, upright posture, arm swing.'))
    elif block_type == 'build':
        dur = _hm(rn * 0.28)
        days.append(_single(week_start, 3, 'tempo', 'run', dur, 3,
                            'Tempo Run',
                            f'{dur} min total. WU 10 min easy. '
                            f'Main: 20-30 min at Z3{_r_z3}{_r_hr3}. '
                            'CD 10 min easy. This builds your Ironman run pace.'))
    else:  # peak
        dur = _hm(rn * 0.30)
        days.append(_single(week_start, 3, 'long', 'run', dur, 2,
                            'Medium-Long Run',
                            f'{dur} min Z2 run{_r_z2}{_r_hr2}. Controlled effort, Ironman run pace. '
                            'Practice your race-day nutrition strategy during this run.'))

    # --- Friday: Swim ---
    if is_recovery:
        days.append(_rest_day(week_start, 4))
    else:
        dur = _hm(sw * 0.52)
        swim_title, swim_desc = _swim_session(dur, block_type, 'main', css=css)
        days.append(_single(week_start, 4, 'swim', 'swim', dur,
                            2 if block_type == 'base' else 3,
                            swim_title, swim_desc))

    # --- Saturday: Long Ride (+ brick run in Build/Peak) ---
    if is_recovery:
        dur = _hm(bk * 0.50)
        days.append(_single(week_start, 5, 'cycle', 'cycle', dur, 2,
                            'Moderate Long Ride',
                            f'{dur} min recovery long ride. Z2{_b_z2} throughout. '
                            'Practise race nutrition: aim for 60-90 g carbs/hr on the bike. '
                            'Comfortable, controlled pace.'))
    elif block_type == 'base':
        dur = _hm(bk * 0.55)
        days.append(_single(week_start, 5, 'long', 'cycle', dur, 2,
                            'Long Ride',
                            f'{dur} min Z2{_b_z2} long ride. The cornerstone of Ironman training. '
                            'Fuel every 20-30 min. Aim for 60-80 g carbs/hr. '
                            'Focus on comfort and consistent power, not speed.'))
    else:
        # Brick workout: long ride + transition run
        bike_dur = _hm(bk * 0.60)
        run_dur  = _hm(rn * 0.22)
        brick_desc = (
            f'Brick Workout — {bike_dur} min ride immediately followed by {run_dur} min run.\n'
            f'Bike ({bike_dur} min): Z2-Z3{_b_z3}, cadence 85+ rpm. '
            'Fuel aggressively — 70-90 g carbs/hr.\n'
            f'Transition: rack bike, change shoes, GO. No sitting.\n'
            f'Run ({run_dur} min): First 5 min will feel heavy — that\'s normal. '
            f'Settle into Ironman run pace (Z2{_r_z2}). '
            f'Total brick: {bike_dur + run_dur} min of race-simulation.'
        )
        wos = [
            _w('cycle', f'Brick Ride ({bike_dur} min)', bike_dur,
               3 if block_type == 'peak' else 2, '', week_start + timedelta(5)),
            _w('run', f'Brick Run ({run_dur} min)', run_dur, 3, '', week_start + timedelta(5)),
        ]
        wos[0]['description'] = brick_desc
        days.append(_day(week_start, 5, 'brick', wos))

    # --- Sunday: Long Run or Rest (taper) ---
    if block_type == 'taper' or is_recovery:
        dur = _hm(rn * 0.25)
        days.append(_single(week_start, 6, 'easy', 'run', dur, 2,
                            'Easy Recovery Run',
                            f'{dur} min very easy. Z1-Z2{_r_z2}. Shake out the legs. '
                            'This is active recovery — do NOT push the pace.'))
    elif block_type == 'base':
        dur = _hm(rn * 0.40)
        days.append(_single(week_start, 6, 'long', 'run', dur, 2,
                            'Long Run',
                            f'{dur} min long run. Longest run of the week. '
                            f'Start conservatively (Z2{_r_z2}), finish strong. '
                            'Practise your run nutrition — aim for 40-60 g carbs/hr for runs over 90 min.'))
    else:  # build/peak
        dur = _hm(rn * 0.38)
        days.append(_single(week_start, 6, 'long', 'run', dur, 2,
                            'Long Run',
                            f'{dur} min long run at Ironman pace. Z2{_r_z2}, controlled. '
                            'This follows yesterday\'s brick — running on tired legs is intentional. '
                            'Fuel every 30 min. Cool down with easy walking.'))

    return days


def _swim_session(duration_min, block_type, slot, css=None):
    """Generate a named swim workout with structure that adds up exactly to _dist_swim()."""
    dist = _dist_swim(duration_min)
    css_str = f' (target {_fmt_css(css)})' if css else ''
    css_fast = f' (target {_fmt_css(css * 0.95)})' if css else ''

    if block_type == 'base':
        wu = 400
        cd_min = 200
        main_pool = dist - wu - cd_min
        n200 = max(2, main_pool // 200)
        main_m = n200 * 200
        cd = dist - wu - main_m
        title = 'Swim — Aerobic Base'
        desc = (f'{dist} m total. '
                f'WU: {wu} m easy catch-up drill. '
                f'Main: {n200} × 200 m at steady Z2 pace{css_str} with 20 s rest. '
                f'CD: {cd} m easy backstroke or freestyle. '
                'Focus: high elbow catch, bilateral breathing every 3 strokes.')

    elif block_type == 'build':
        wu = 600
        cd = 200
        main_pool = dist - wu - cd
        n400 = max(2, main_pool // 500)
        main_m = n400 * 400
        n50 = max(4, (main_pool - main_m) // 50)
        cd = dist - wu - main_m - n50 * 50
        if cd < 100:
            n50 = max(2, n50 - 2)
            cd = dist - wu - main_m - n50 * 50
        title = 'Swim — Threshold Set'
        desc = (f'{dist} m total. '
                f'WU: 400 m easy + 4 × 50 m build. '
                f'Main: {n400} × 400 m at Z3 (strong but controlled){css_str} with 30 s rest '
                f'+ {n50} × 50 m fast{css_fast} with 20 s rest. '
                f'CD: {cd} m easy. '
                'Focus: maintain form when fatigued.')

    else:  # peak
        wu = 600
        cd = 300
        main_pool = dist - wu - cd
        n800 = max(1, main_pool // 900)
        main_m = n800 * 800
        n100 = max(2, (main_pool - main_m) // 100)
        cd = dist - wu - main_m - n100 * 100
        if cd < 100:
            n100 = max(2, n100 - 2)
            cd = dist - wu - main_m - n100 * 100
        title = 'Swim — Race Pace'
        desc = (f'{dist} m total. '
                f'WU: {wu} m easy including drills. '
                f'Main: {n800} × 800 m at race pace (Z3-Z4){css_str} with 1 min rest '
                f'+ {n100} × 100 m at sprint effort Z4{css_fast} with 30 s rest. '
                f'CD: {cd} m easy. '
                'Simulate open-water race start: first 100 m hard, settle in.')

    return title, desc


def _dist_swim(duration_min):
    """Estimate swim distance in metres from duration."""
    return round(duration_min * 38 / 100) * 100  # ~38 m/min, round to 100m


# ---------------------------------------------------------------------------
# Running week templates
# ---------------------------------------------------------------------------

def _running_week(goal_type, block_type, week_start, total_hours, is_recovery, profile=None):
    h = total_hours
    if is_recovery:
        sched = [(0,'rest'), (1,'easy',h*0.20), (2,'rest'), (3,'easy',h*0.22),
                 (4,'rest'), (5,'long',h*0.42), (6,'easy',h*0.16)]
    elif block_type == 'base':
        sched = [(0,'rest'), (1,'easy',h*0.18), (2,'strength',h*0.15),
                 (3,'easy',h*0.20), (4,'rest'), (5,'long',h*0.40), (6,'easy',h*0.12)]
    elif block_type == 'build':
        sched = [(0,'rest'), (1,'easy',h*0.15), (2,'tempo',h*0.20),
                 (3,'easy',h*0.18), (4,'strength',h*0.12), (5,'long',h*0.38), (6,'easy',h*0.10)]
    elif block_type == 'peak':
        sched = [(0,'rest'), (1,'easy',h*0.12), (2,'interval',h*0.22),
                 (3,'easy',h*0.15), (4,'tempo',h*0.18), (5,'long',h*0.35), (6,'easy',h*0.10)]
    else:  # taper
        sched = [(0,'rest'), (1,'easy',h*0.22), (2,'tempo',h*0.15),
                 (3,'rest'), (4,'easy',h*0.15), (5,'easy',h*0.10), (6,'rest')]
    return _schedule_to_days(sched, week_start, 'run', goal_type, profile)


def _cycling_week(block_type, week_start, total_hours, is_recovery, profile=None):
    h = total_hours
    if is_recovery:
        sched = [(0,'rest'),(1,'easy',h*0.20),(2,'rest'),(3,'easy',h*0.25),
                 (4,'rest'),(5,'long',h*0.40),(6,'easy',h*0.15)]
    elif block_type == 'base':
        sched = [(0,'rest'),(1,'easy',h*0.20),(2,'strength',h*0.15),
                 (3,'easy',h*0.25),(4,'rest'),(5,'long',h*0.40),(6,'easy',h*0.15)]
    elif block_type == 'build':
        sched = [(0,'rest'),(1,'easy',h*0.15),(2,'tempo',h*0.22),
                 (3,'easy',h*0.18),(4,'rest'),(5,'long',h*0.42),(6,'easy',h*0.12)]
    else:
        sched = [(0,'rest'),(1,'easy',h*0.18),(2,'interval',h*0.20),
                 (3,'easy',h*0.15),(4,'rest'),(5,'long',h*0.38),(6,'easy',h*0.10)]
    return _schedule_to_days(sched, week_start, 'cycle', 'cycling_event', profile)


def _strength_week(block_type, week_start, total_hours, is_recovery):
    h = total_hours
    if block_type in ('base', 'build'):
        sched = [(0,'rest'),(1,'strength',h*0.30),(2,'core',h*0.15),
                 (3,'strength',h*0.30),(4,'rest'),(5,'strength',h*0.25),(6,'core',h*0.15)]
    else:
        sched = [(0,'rest'),(1,'strength',h*0.35),(2,'rest'),
                 (3,'strength',h*0.35),(4,'rest'),(5,'strength',h*0.30),(6,'rest')]
    return _schedule_to_days(sched, week_start, 'strength', 'strength')


def _fitness_week(block_type, week_start, total_hours, is_recovery):
    h = total_hours
    sched = [(0,'rest'),(1,'easy',h*0.25),(2,'strength',h*0.20),
             (3,'easy',h*0.25),(4,'rest'),(5,'long',h*0.30),(6,'core',h*0.15)]
    return _schedule_to_days(sched, week_start, 'run', 'general_fitness')


# ---------------------------------------------------------------------------
# Generic schedule builder (for non-triathlon)
# ---------------------------------------------------------------------------

def _schedule_to_days(schedule, week_start, default_sport, goal_type, profile=None):
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
        workout = _make_generic_workout(day_date, sport, day_type, duration_min, zone, goal_type, profile)
        result.append({'day': day, 'workouts': [workout]})
    return result


def _make_generic_workout(workout_date, sport, day_type, duration_min, zone, goal_type, profile=None):
    p = profile or {}
    ftp = _safe_float(p.get('ftp_watts'))
    thr = _safe_float(p.get('running_threshold_pace_sec_km'))
    max_hr = _safe_float(p.get('max_hr'))
    rhr = _safe_float(p.get('resting_hr'))

    _r_z2 = f', {_run_zone_pace(thr, 1.18, 1.28)}' if thr and sport == 'run' else ''
    _r_z3 = f', {_run_zone_pace(thr, 1.02, 1.10)}' if thr and sport == 'run' else ''
    _r_z4 = f', {_run_zone_pace(thr, 0.92, 0.98)}' if thr and sport == 'run' else ''
    _b_z2 = f' ({_ftp_zone_watts(ftp, 0.56, 0.75)})' if ftp and sport == 'cycle' else ''
    _b_z3 = f' ({_ftp_zone_watts(ftp, 0.76, 0.88)})' if ftp and sport == 'cycle' else ''
    _b_z4 = f' ({_ftp_zone_watts(ftp, 0.88, 1.00)})' if ftp and sport == 'cycle' else ''
    _hr2  = f' (target {_hr_zone(rhr, max_hr, 2)})' if max_hr else ''
    _hr3  = f' (target {_hr_zone(rhr, max_hr, 3)})' if max_hr else ''

    labels = {'run': 'Run', 'cycle': 'Ride', 'swim': 'Swim', 'strength': 'Strength', 'core': 'Core'}
    titles = {
        'easy':     f'Easy {labels.get(sport, sport.title())}',
        'tempo':    f'Tempo {labels.get(sport, sport.title())}',
        'interval': f'Interval {labels.get(sport, sport.title())}',
        'long':     f'Long {labels.get(sport, sport.title())}',
        'strength': 'Strength Training',
        'core':     'Core & Mobility',
        'brick':    'Brick (Bike+Run)',
        'swim':     'Aerobic Swim',
        'cycle':    'Aerobic Ride',
    }
    descs = {
        'easy':     f'Z2 easy effort{_r_z2}{_b_z2}{_hr2}, {duration_min} min. Conversational pace throughout.',
        'tempo':    f'Z3 tempo{_r_z3}{_b_z3}{_hr3}, {duration_min} min. Comfortably hard. WU 10 min, main set, CD 10 min.',
        'interval': f'Z4 intervals{_r_z4}{_b_z4}, {duration_min} min total. Short hard efforts with recovery.',
        'long':     f'Z2 long effort{_r_z2}{_b_z2}{_hr2}, {duration_min} min. Pace yourself, fuel every 30 min.',
        'strength': f'{duration_min} min. Full-body strength: squats, hip hinges, push/pull, core.',
        'core':     f'{duration_min} min core stability and flexibility. Plank, glute bridges, hip mobility.',
        'swim':     f'Aerobic swim, ~{_dist_swim(duration_min)} m. Focus on form and breathing.',
        'cycle':    f'Aerobic ride{_b_z2}, {duration_min} min. Z2, cadence 85-95 rpm.',
    }
    return {
        'sport': sport,
        'title': titles.get(day_type, f'{labels.get(sport, sport.title())} Workout'),
        'duration_min': duration_min,
        'distance_km': _estimate_distance(sport, duration_min, zone),
        'intensity_zone': zone,
        'tss': _calc_tss(duration_min, zone),
        'description': descs.get(day_type, ''),
        'structure': None,
        '_workout_date': workout_date.isoformat(),
    }


# ---------------------------------------------------------------------------
# Race day workouts
# ---------------------------------------------------------------------------

def _triathlon_race_workouts(race_date, goal_type, profile=None):
    distances = {
        'sprint_triathlon': (0.75, 20,  5),
        'half_ironman':     (1.9,  90,  21.1),
        'ironman':          (3.8,  180, 42.2),
    }
    swim_km, bike_km, run_km = distances.get(goal_type, (1.9, 90, 21.1))
    p = profile or {}
    ftp = _safe_float(p.get('ftp_watts'))
    css = _safe_float(p.get('css_per_100m'))
    thr = _safe_float(p.get('running_threshold_pace_sec_km'))
    race_watts = f' ({_ftp_zone_watts(ftp, 0.70, 0.75)})' if ftp else ''
    race_pace  = f', {_run_zone_pace(thr, 1.05, 1.15)}' if thr else ''
    css_str    = f' (target {_fmt_css(css)})' if css else ''
    return [
        {
            'sport': 'swim', 'title': f'Race Swim — {swim_km} km',
            'duration_min': int(swim_km * 22), 'distance_km': swim_km,
            'intensity_zone': 4, 'tss': 60,
            'description': (
                f'Race swim — {swim_km} km{css_str}. Start conservatively, find feet, settle into rhythm. '
                'Sight every 8-10 strokes. Bilateral breathing. '
                'Exit the water in control, not sprinting.'
            ),
            'structure': None, '_workout_date': race_date.isoformat()
        },
        {
            'sport': 'cycle', 'title': f'Race Bike — {bike_km} km',
            'duration_min': int(bike_km * 2.8), 'distance_km': bike_km,
            'intensity_zone': 3, 'tss': 250,
            'description': (
                f'Race bike — {bike_km} km. Target 70-75% FTP{race_watts} (never exceed 80%). '
                'Fuel 70-90 g carbs/hr from km 20 onward. Drink 500-750 ml/hr. '
                'Aero position when possible. Save the legs for the run.'
            ),
            'structure': None, '_workout_date': race_date.isoformat()
        },
        {
            'sport': 'run', 'title': f'Race Run — {run_km} km',
            'duration_min': int(run_km * 5.8), 'distance_km': run_km,
            'intensity_zone': 3, 'tss': 180,
            'description': (
                f'Race marathon — {run_km} km. Start at Z2{race_pace} (first 5 km feel easy — trust this). '
                'Walk aid stations, take cola + water after km 25. '
                'Pick up pace in final 10 km. You\'ve prepared for this. Go!'
            ),
            'structure': None, '_workout_date': race_date.isoformat()
        },
    ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _rest_day(week_start, offset):
    d = week_start + timedelta(days=offset)
    return {'day': {'date': d.isoformat(), 'day_type': 'rest', 'ai_adjusted': False, 'notes': None},
            'workouts': []}


def _day(week_start, offset, day_type, workouts):
    d = week_start + timedelta(days=offset)
    return {'day': {'date': d.isoformat(), 'day_type': day_type, 'ai_adjusted': False, 'notes': None},
            'workouts': workouts}


def _single(week_start, offset, day_type, sport, duration_min, zone, title, description):
    d = week_start + timedelta(days=offset)
    return {
        'day': {'date': d.isoformat(), 'day_type': day_type, 'ai_adjusted': False, 'notes': None},
        'workouts': [_w(sport, title, duration_min, zone, description, d)]
    }


def _w(sport, title, duration_min, zone, description, workout_date):
    return {
        'sport': sport,
        'title': title,
        'duration_min': duration_min,
        'distance_km': _estimate_distance(sport, duration_min, zone),
        'intensity_zone': zone,
        'tss': _calc_tss(duration_min, zone),
        'description': description,
        'structure': None,
        '_workout_date': workout_date.isoformat(),
    }


def _hm(hours):
    """Convert fractional hours to whole minutes, minimum 20."""
    return max(20, int(hours * 60))


def _assign_block_weeks(total_weeks, ratios):
    blocks = []
    for block_type in ('base', 'build', 'peak', 'taper'):
        n = max(1 if ratios[block_type] > 0 else 0, round(total_weeks * ratios[block_type]))
        if n > 0:
            blocks.append((block_type, n))
    assigned = sum(n for _, n in blocks)
    diff = total_weeks - assigned
    if diff > 0 and blocks:
        blocks[1] = (blocks[1][0], blocks[1][1] + diff)
    elif diff < 0 and len(blocks) > 1:
        blocks[1] = (blocks[1][0], max(1, blocks[1][1] + diff))
    return blocks


def _default_start_hours(goal_type, fitness_level):
    cat = ('triathlon' if goal_type in IS_TRIATHLON else
           'cycling' if goal_type in IS_CYCLING else
           'strength' if goal_type in IS_STRENGTH else 'run')
    return START_HOURS.get(fitness_level, START_HOURS['intermediate'])[cat]


def _day_type_to_sport(day_type, default_sport):
    mapping = {'strength': 'strength', 'core': 'core', 'swim': 'swim',
               'cycle': 'cycle', 'brick': 'brick'}
    return mapping.get(day_type, default_sport)


def _day_type_to_zone(day_type):
    return {'easy': 2, 'long': 2, 'tempo': 3, 'interval': 4,
            'strength': 2, 'core': 1, 'brick': 3, 'swim': 2, 'cycle': 2}.get(day_type, 2)


def _calc_tss(duration_min, zone):
    if_val = {1: 0.55, 2: 0.75, 3: 0.90, 4: 1.05, 5: 1.15}.get(zone, 0.75)
    return int((duration_min / 60) * (if_val ** 2) * 100)


def _estimate_distance(sport, duration_min, zone):
    if sport == 'swim':
        # Use same formula as _dist_swim so distance_km always matches description
        return round(_dist_swim(duration_min) / 1000, 2)
    pace = {
        'run':   {1: 7.0, 2: 6.5, 3: 5.5, 4: 4.5, 5: 4.0},
        'cycle': {1: 2.5, 2: 2.2, 3: 1.9, 4: 1.7, 5: 1.5},
    }
    p = pace.get(sport, {}).get(zone)
    return round(duration_min / p, 1) if p else None


def _parse_date(d):
    if isinstance(d, date):
        return d
    from datetime import datetime
    return datetime.strptime(str(d)[:10], '%Y-%m-%d').date()


def _safe_float(v):
    """Return float or None — never raises."""
    try:
        return float(v) if v not in (None, '', 0) else None
    except (ValueError, TypeError):
        return None


def _fmt_pace(sec_km):
    """Format seconds/km as M:SS /km string."""
    if not sec_km:
        return ''
    m, s = divmod(int(sec_km), 60)
    return f'{m}:{s:02d} /km'


def _fmt_css(sec_100m):
    """Format CSS (seconds/100m) as M:SS /100m string."""
    if not sec_100m:
        return ''
    m, s = divmod(int(sec_100m), 60)
    return f'{m}:{s:02d} /100m'


def _run_zone_pace(threshold_sec_km, factor_lo, factor_hi):
    """Return a pace range string for a running zone given threshold pace and zone factors."""
    if not threshold_sec_km:
        return ''
    hi_s, lo_s = int(threshold_sec_km * factor_lo), int(threshold_sec_km * factor_hi)
    hi_m, hi_sec = divmod(hi_s, 60)
    lo_m, lo_sec = divmod(lo_s, 60)
    return f'{hi_m}:{hi_sec:02d}–{lo_m}:{lo_sec:02d} /km'


def _ftp_zone_watts(ftp, pct_lo, pct_hi):
    """Return a watt range string for a bike zone given FTP and percentages."""
    if not ftp:
        return ''
    lo = int(ftp * pct_lo)
    hi = int(ftp * pct_hi)
    return f'{lo}–{hi} W'


def _hr_zone(resting_hr, max_hr, zone):
    """Return a HR range string using Karvonen formula if resting_hr available, else % max HR."""
    if not max_hr:
        return ''
    pcts = {1: (0.50, 0.60), 2: (0.60, 0.70), 3: (0.70, 0.80), 4: (0.80, 0.90), 5: (0.90, 1.00)}
    lo_pct, hi_pct = pcts.get(zone, (0.60, 0.70))
    if resting_hr:
        hrr = max_hr - resting_hr
        lo = int(resting_hr + hrr * lo_pct)
        hi = int(resting_hr + hrr * hi_pct)
    else:
        lo = int(max_hr * lo_pct)
        hi = int(max_hr * hi_pct)
    return f'{lo}–{hi} bpm'
