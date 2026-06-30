"""
Training load computation: ATL (Acute), CTL (Chronic), TSB (Form).

ATL = 7-day Banister exponential moving average  (k = 1 - exp(-1/7))
CTL = 42-day Banister exponential moving average (k = 1 - exp(-1/42))
TSB = CTL - ATL  (positive = fresh/recovered, negative = fatigued)

Daily TSS is derived from actual activity data using this priority chain:

  1. wl.tss          — device-reported or manually entered TSS (most accurate)
  2. Power-based     — (duration_h × (avg_watts / FTP)²) × 100
                       requires avg_power_watts in workout_logs AND ftp_watts in profile
  3. HR-based        — (duration_h × (avg_hr / LTHR)²) × 100
                       LTHR is approximated as 90 % of max_hr (profile)
                       avg_hr capped at 1.20 × LTHR to guard against bad data
  4. Perceived effort — maps RPE 1-10 to intensity factor then TSS formula
  5. Planned zone    — uses the linked planned workout's intensity_zone as a last resort
                       (least accurate — falls back when no actual data is available)

Note: the planned workout's tss column (training.workouts.tss) is intentionally
NOT used here. It reflects the planned stimulus, not the actual physiological load.
"""
import math
from datetime import date, timedelta
from app.db import execute_query, execute_write


def compute_load_for_user(user_id: str, from_date: date = None):
    if not from_date:
        from_date = date.today() - timedelta(days=90)

    rows = execute_query(
        '''SELECT wl.log_date::date AS d, COALESCE(SUM(
               CASE
                 -- 1. Device/manual TSS (most accurate)
                 WHEN wl.tss IS NOT NULL
                   THEN wl.tss

                 -- 2. Power-based TSS: IF = avg_watts / FTP
                 WHEN wl.avg_power_watts IS NOT NULL
                      AND p.ftp_watts    IS NOT NULL
                      AND p.ftp_watts    > 0
                   THEN (COALESCE(wl.actual_duration_min, 0) / 60.0)
                        * POWER(LEAST(wl.avg_power_watts::float / p.ftp_watts, 1.50), 2)
                        * 100

                 -- 3. HR-based TSS: LTHR ≈ 90%% of max_hr
                 WHEN wl.avg_hr   IS NOT NULL
                      AND p.max_hr IS NOT NULL
                      AND p.max_hr > 0
                   THEN (COALESCE(wl.actual_duration_min, 0) / 60.0)
                        * POWER(LEAST(wl.avg_hr::float / (p.max_hr * 0.90), 1.20), 2)
                        * 100

                 -- 4. Perceived effort (RPE 1-10 → intensity factor)
                 WHEN wl.perceived_effort IS NOT NULL
                   THEN (COALESCE(wl.actual_duration_min, 0) / 60.0)
                        * POWER(CASE
                            WHEN wl.perceived_effort <= 2 THEN 0.55
                            WHEN wl.perceived_effort <= 4 THEN 0.75
                            WHEN wl.perceived_effort <= 6 THEN 0.90
                            WHEN wl.perceived_effort <= 8 THEN 1.05
                            ELSE 1.15
                          END, 2)
                        * 100

                 -- 5. Planned zone (last resort — actual duration, planned intensity)
                 ELSE (COALESCE(wl.actual_duration_min, w.duration_min, 0) / 60.0) * 100.0
                      * POWER(CASE w.intensity_zone
                              WHEN 1 THEN 0.55 WHEN 2 THEN 0.75 WHEN 3 THEN 0.90
                              WHEN 4 THEN 1.05 WHEN 5 THEN 1.15 ELSE 0.75 END, 2)
               END), 0)::float AS daily_tss
           FROM training.workout_logs wl
           LEFT JOIN training.workouts  w ON w.id       = wl.workout_id
           LEFT JOIN training.profiles  p ON p.user_id  = wl.user_id
           WHERE wl.user_id  = %s
             AND wl.log_date >= %s
           GROUP BY wl.log_date
           ORDER BY wl.log_date''',
        (user_id, from_date)
    )

    tss_map = {str(r['d']): float(r['daily_tss']) for r in rows}

    atl, ctl = 0.0, 0.0
    k_atl = 1 - math.exp(-1 / 7)
    k_ctl = 1 - math.exp(-1 / 42)

    current = from_date
    end = date.today()
    while current <= end:
        ds = str(current)
        daily_tss = tss_map.get(ds, 0.0)
        atl = daily_tss * k_atl + atl * (1 - k_atl)
        ctl = daily_tss * k_ctl + ctl * (1 - k_ctl)
        tsb = ctl - atl

        execute_write(
            '''INSERT INTO training.training_load (user_id, date, atl, ctl, tsb)
               VALUES (%s, %s::date, %s, %s, %s)
               ON CONFLICT (user_id, date) DO UPDATE
                 SET atl=EXCLUDED.atl, ctl=EXCLUDED.ctl, tsb=EXCLUDED.tsb''',
            (user_id, ds, round(atl, 2), round(ctl, 2), round(tsb, 2))
        )
        current += timedelta(days=1)


def get_load_history(user_id: str, days: int = 90) -> list:
    from_date = date.today() - timedelta(days=days)
    rows = execute_query(
        '''SELECT date, atl, ctl, tsb
           FROM training.training_load
           WHERE user_id = %s AND date >= %s
           ORDER BY date''',
        (user_id, from_date)
    )
    return [dict(r) for r in rows]
