from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.db import execute_query
from app.services.load_service import compute_load_for_user, get_load_history
from datetime import date

progress_bp = Blueprint('progress', __name__)


@progress_bp.route('/api/progress/load')
@jwt_required()
def get_load():
    user_id = get_jwt_identity()
    days = int(request.args.get('days', 90))
    # Recompute for accuracy
    compute_load_for_user(user_id)
    return jsonify(get_load_history(user_id, days))
