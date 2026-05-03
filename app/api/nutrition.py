from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query, execute_write
from app.services.nutrition_service import calc_targets, calc_nutrients_from_log
from app.exceptions import NotFoundError, ValidationError
from datetime import date

nutrition_bp = Blueprint('nutrition', __name__)


@nutrition_bp.route('/api/food/search')
@jwt_required()
def food_search():
    q = request.args.get('q', '').strip()
    if len(q) < 2:
        return jsonify([])
    rows = execute_query(
        '''SELECT id, name, category, calories_per_100g, protein_per_100g,
                  carbs_per_100g, fat_per_100g
           FROM training.food_database
           WHERE name ILIKE %s OR name_de ILIKE %s OR name_pl ILIKE %s
           ORDER BY name LIMIT 20''',
        (f'%{q}%', f'%{q}%', f'%{q}%')
    )
    return jsonify([dict(r) for r in rows])


@nutrition_bp.route('/api/food/log', methods=['GET'])
@jwt_required()
def get_food_log():
    user_id = get_jwt_identity()
    log_date = request.args.get('date', str(date.today()))
    rows = execute_query(
        '''SELECT fl.*, fd.calories_per_100g, fd.protein_per_100g, fd.carbs_per_100g,
                  fd.fat_per_100g, fd.fiber_per_100g, fd.iron_per_100g, fd.calcium_per_100g,
                  fd.vitamin_d_per_100g, fd.vitamin_b12_per_100g, fd.vitamin_c_per_100g,
                  fd.magnesium_per_100g, fd.potassium_per_100g, fd.zinc_per_100g,
                  fd.sodium_per_100g
           FROM training.food_log fl
           LEFT JOIN training.food_database fd ON fd.id = fl.food_id
           WHERE fl.user_id = %s AND fl.log_date = %s::date
           ORDER BY fl.created_at''',
        (user_id, log_date)
    )
    entries = [dict(r) for r in rows]
    totals = calc_nutrients_from_log(entries)
    return jsonify({'entries': entries, 'totals': totals})


@nutrition_bp.route('/api/food/log', methods=['POST'])
@jwt_required()
def add_food_log():
    user_id = get_jwt_identity()
    data = request.get_json()

    food_id = data.get('food_id')
    amount_g = data.get('amount_g')
    if not amount_g:
        raise ValidationError('amount_g required')

    # Compute nutrients at log time
    if food_id:
        food = execute_query(
            'SELECT * FROM training.food_database WHERE id = %s', (food_id,), fetch_one=True
        )
        if food:
            ratio = float(amount_g) / 100.0
            nutrients = calc_nutrients_from_log([{**dict(food), 'amount_g': amount_g}])
        else:
            food, nutrients = None, {}
    else:
        food, nutrients = None, {}

    row = execute_write(
        '''INSERT INTO training.food_log
             (user_id, log_date, meal_type, food_id, food_name, amount_g,
              calories, protein_g, carbs_g, fat_g, fiber_g, nutrients)
           VALUES (%s, %s::date, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           RETURNING *''',
        (user_id, data.get('log_date', str(date.today())),
         data.get('meal_type', 'snack'),
         food_id,
         data.get('food_name') or (dict(food)['name'] if food else 'Custom'),
         amount_g,
         nutrients.get('calories'), nutrients.get('protein_g'),
         nutrients.get('carbs_g'), nutrients.get('fat_g'), nutrients.get('fiber_g'),
         nutrients),
        returning=True
    )
    return jsonify(dict(row)), 201


@nutrition_bp.route('/api/food/log/<entry_id>', methods=['DELETE'])
@jwt_required()
def delete_food_log(entry_id):
    user_id = get_jwt_identity()
    execute_write(
        'DELETE FROM training.food_log WHERE id = %s AND user_id = %s',
        (entry_id, user_id)
    )
    return jsonify({'message': 'Deleted'})


@nutrition_bp.route('/api/nutrition/targets', methods=['GET'])
@jwt_required()
def get_nutrition_targets():
    user_id = get_jwt_identity()
    target_date = request.args.get('date', str(date.today()))

    profile = execute_query(
        'SELECT * FROM training.profiles WHERE user_id = %s', (user_id,), fetch_one=True
    )
    plan_day = execute_query(
        '''SELECT pd.day_type, pw.block_type
           FROM training.plan_days pd
           LEFT JOIN training.plan_weeks pw
             ON pw.plan_id = pd.plan_id
             AND pd.date >= pw.week_start AND pd.date < pw.week_start + interval '7 days'
           WHERE pd.user_id = %s AND pd.date = %s::date
           LIMIT 1''',
        (user_id, target_date), fetch_one=True
    )

    # Fetch actual workouts for the day to use MET-based calorie calculation
    workout_rows = execute_query(
        '''SELECT sport, duration_min, intensity_zone
           FROM training.workouts w
           JOIN training.plan_days pd ON pd.id = w.plan_day_id
           WHERE pd.user_id = %s AND pd.date = %s::date''',
        (user_id, target_date)
    )
    workouts = [dict(r) for r in workout_rows] if workout_rows else []

    day_type  = plan_day['day_type']  if plan_day else 'rest'
    block_type = plan_day['block_type'] if plan_day else 'base'

    targets = calc_targets(
        dict(profile) if profile else {},
        workouts=workouts,
        day_type=day_type,
        block_type=block_type,
    )
    sleep_hours = targets.pop('sleep_target_hours', 8.0)
    omega3_g    = targets.pop('omega3_g', 2.0)
    formula     = targets.pop('formula', {})

    execute_write(
        '''INSERT INTO training.nutrition_targets
             (user_id, date, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml,
              iron_mg, calcium_mg, vitamin_d_mcg, vitamin_b12_mcg, vitamin_c_mg,
              magnesium_mg, potassium_mg, zinc_mg, sodium_mg)
           VALUES (%s, %s::date, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (user_id, date) DO UPDATE
             SET calories_kcal=EXCLUDED.calories_kcal, protein_g=EXCLUDED.protein_g,
                 carbs_g=EXCLUDED.carbs_g, fat_g=EXCLUDED.fat_g, fiber_g=EXCLUDED.fiber_g,
                 water_ml=EXCLUDED.water_ml, iron_mg=EXCLUDED.iron_mg,
                 calcium_mg=EXCLUDED.calcium_mg, vitamin_d_mcg=EXCLUDED.vitamin_d_mcg,
                 vitamin_b12_mcg=EXCLUDED.vitamin_b12_mcg, vitamin_c_mg=EXCLUDED.vitamin_c_mg,
                 magnesium_mg=EXCLUDED.magnesium_mg, potassium_mg=EXCLUDED.potassium_mg,
                 zinc_mg=EXCLUDED.zinc_mg, sodium_mg=EXCLUDED.sodium_mg''',
        (user_id, target_date, targets['calories_kcal'], targets['protein_g'],
         targets['carbs_g'], targets['fat_g'], targets['fiber_g'], targets['water_ml'],
         targets['iron_mg'], targets['calcium_mg'], targets['vitamin_d_mcg'],
         targets['vitamin_b12_mcg'], targets['vitamin_c_mg'], targets['magnesium_mg'],
         targets['potassium_mg'], targets['zinc_mg'], targets['sodium_mg'])
    )

    targets['sleep_target_hours'] = sleep_hours
    targets['omega3_g'] = omega3_g
    targets['formula'] = formula
    return jsonify(targets)
