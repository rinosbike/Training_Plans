import datetime
import decimal
from flask import Flask, g, jsonify
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS
from flask_jwt_extended import JWTManager, verify_jwt_in_request, get_jwt_identity
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from config import config
from app.db import close_db, set_user_context


class ISODateJSONProvider(DefaultJSONProvider):
    def default(self, o):
        if isinstance(o, datetime.datetime):
            return o.isoformat()
        if isinstance(o, datetime.date):
            return o.isoformat()
        if isinstance(o, decimal.Decimal):
            return float(o)
        return super().default(o)

jwt = JWTManager()
limiter = Limiter(key_func=get_remote_address, default_limits=['200 per minute'])


def create_app(config_name='default'):
    app = Flask(__name__)
    app.json_provider_class = ISODateJSONProvider
    app.json = ISODateJSONProvider(app)
    app.config.from_object(config[config_name])

    CORS(app, origins=app.config['CORS_ORIGINS'], supports_credentials=True)
    jwt.init_app(app)
    limiter.init_app(app)

    _register_jwt_callbacks(app)
    _register_blueprints(app)
    _register_error_handlers(app)

    @app.before_request
    def set_user_context_middleware():
        try:
            verify_jwt_in_request(optional=True)
            user_id = get_jwt_identity()
            g.user_id = user_id
        except Exception:
            g.user_id = None

    @app.teardown_appcontext
    def teardown_db(exc):
        close_db()

    @app.route('/api/health')
    def health():
        return jsonify({'status': 'ok', 'service': 'training'})

    return app


def _register_blueprints(app):
    from app.api.auth import auth_bp
    from app.api.goals import goals_bp
    from app.api.plans import plans_bp
    from app.api.workouts import workouts_bp
    from app.api.nutrition import nutrition_bp
    from app.api.sleep import sleep_bp
    from app.api.ai_coach import ai_coach_bp
    from app.api.sync import sync_bp
    from app.api.progress import progress_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(goals_bp)
    app.register_blueprint(plans_bp)
    app.register_blueprint(workouts_bp)
    app.register_blueprint(nutrition_bp)
    app.register_blueprint(sleep_bp)
    app.register_blueprint(ai_coach_bp)
    app.register_blueprint(sync_bp)
    app.register_blueprint(progress_bp)


def _register_jwt_callbacks(app):
    @jwt.expired_token_loader
    def expired_token_callback(jwt_header, jwt_payload):
        return jsonify({'error': 'Token expired', 'code': 'token_expired'}), 401

    @jwt.invalid_token_loader
    def invalid_token_callback(error):
        return jsonify({'error': 'Invalid token', 'code': 'invalid_token'}), 401

    @jwt.unauthorized_loader
    def missing_token_callback(error):
        return jsonify({'error': 'Authorization required', 'code': 'authorization_required'}), 401


def _register_error_handlers(app):
    from app.exceptions import APIError, NotFoundError, ValidationError, AuthenticationError

    @app.errorhandler(APIError)
    def handle_api_error(e):
        return jsonify({'error': e.message}), e.status_code

    @app.errorhandler(404)
    def handle_404(e):
        return jsonify({'error': 'Not found'}), 404

    @app.errorhandler(500)
    def handle_500(e):
        return jsonify({'error': 'Internal server error'}), 500
