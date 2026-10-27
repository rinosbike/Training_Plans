"""
Z.ai plan usage.
- GET /api/zai/usage        → remaining plan quota (5-hour + weekly window); any signed-in user, so everyone who uses the
                              AI/media functions can see how much is left.
- GET /api/admin/zai-usage  → the same plus 30-day totals per feature and per user; admin / super_admin only.
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.db import execute_query
from app.exceptions import AuthorizationError
from app.services import zai_plan_service

zai_usage_bp = Blueprint('zai_usage', __name__)


@zai_usage_bp.route('/api/zai/usage', methods=['GET'])
@jwt_required()
def quota():
    return jsonify({'quota': zai_plan_service.quota_status()})


@zai_usage_bp.route('/api/admin/zai-usage', methods=['GET'])
@jwt_required()
def admin_usage():
    row = execute_query('SELECT role FROM training.users WHERE id = %s', (get_jwt_identity(),), fetch_one=True)
    if (row or {}).get('role') not in ('admin', 'super_admin'):
        raise AuthorizationError('Admin only')
    days = min(max(request.args.get('days', 30, type=int), 1), 365)
    return jsonify({'quota': zai_plan_service.quota_status(), **zai_plan_service.usage_summary(days)})
