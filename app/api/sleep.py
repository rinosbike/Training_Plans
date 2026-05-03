from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query, execute_write
from datetime import date

sleep_bp = Blueprint('sleep', __name__)


@sleep_bp.route('/api/sleep/log', methods=['GET'])
@jwt_required()
def get_sleep_log():
    user_id = get_jwt_identity()
    start = request.args.get('start', str(date.today()))
    end = request.args.get('end', str(date.today()))
    rows = execute_query(
        '''SELECT * FROM training.sleep_log
           WHERE user_id = %s AND log_date BETWEEN %s::date AND %s::date
           ORDER BY log_date''',
        (user_id, start, end)
    )
    return jsonify([dict(r) for r in rows])


@sleep_bp.route('/api/sleep/log', methods=['POST'])
@jwt_required()
def upsert_sleep_log():
    user_id = get_jwt_identity()
    data = request.get_json()
    log_date = data.get('log_date', str(date.today()))

    row = execute_write(
        '''INSERT INTO training.sleep_log (user_id, log_date, target_hours, actual_hours, quality, notes)
           VALUES (%s, %s::date, %s, %s, %s, %s)
           ON CONFLICT (user_id, log_date) DO UPDATE
             SET actual_hours=EXCLUDED.actual_hours, quality=EXCLUDED.quality,
                 notes=EXCLUDED.notes, target_hours=EXCLUDED.target_hours
           RETURNING *''',
        (user_id, log_date, data.get('target_hours'), data.get('actual_hours'),
         data.get('quality'), data.get('notes')),
        returning=True
    )
    return jsonify(dict(row)), 201
