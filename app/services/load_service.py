"""
Training load computation: ATL (Acute), CTL (Chronic), TSB (Form).
ATL = 7-day exponential weighted moving average of daily TSS
CTL = 42-day exponential weighted moving average of daily TSS
TSB = CTL - ATL (positive = fresh, negative = fatigued)
"""
from datetime import date, timedelta
from app.db import execute_query, execute_write


def compute_load_for_user(user_id: str, from_date: date = None):
    if not from_date:
        from_date = date.today() - timedelta(days=90)

    rows = execute_query(
        '''SELECT log_date::date as d, COALESCE(SUM(
               CASE WHEN w.tss IS NOT NULL THEN w.tss
                    ELSE COALESCE(wl.actual_duration_min, w.duration_min, 0) *
                         POWER(CASE w.intensity_zone
                               WHEN 1 THEN 0.55 WHEN 2 THEN 0.75 WHEN 3 THEN 0.90
                               WHEN 4 THEN 1.05 ELSE 1.15 END, 2)
               END), 0)::float as daily_tss
           FROM training.workout_logs wl
           LEFT JOIN training.workouts w ON w.id = wl.workout_id
           WHERE wl.user_id = %s AND wl.log_date >= %s
           GROUP BY log_date ORDER BY log_date''',
        (user_id, from_date)
    )

    tss_map = {str(r['d']): float(r['daily_tss']) for r in rows}

    atl, ctl = 0.0, 0.0
    k_atl = 2 / (7 + 1)
    k_ctl = 2 / (42 + 1)

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
