from flask import Blueprint, request, jsonify, redirect, current_app, session
from flask_jwt_extended import (
    create_access_token, create_refresh_token,
    jwt_required, get_jwt_identity
)
from urllib.parse import urlencode
import secrets
from app.services import auth_service as svc
from app.exceptions import AuthenticationError

auth_bp = Blueprint('auth', __name__)

GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'


@auth_bp.route('/api/auth/google')
def google_login():
    state = secrets.token_urlsafe(16)
    session['oauth_state'] = state
    params = {
        'client_id': current_app.config['GOOGLE_CLIENT_ID'],
        'redirect_uri': current_app.config['GOOGLE_REDIRECT_URI'],
        'response_type': 'code',
        'scope': 'openid email profile',
        'state': state,
        'access_type': 'offline',
        'prompt': 'select_account',
    }
    return redirect(f"{GOOGLE_AUTH_URL}?{urlencode(params)}")


@auth_bp.route('/api/auth/google/callback')
def google_callback():
    error = request.args.get('error')
    if error:
        return redirect(f"{current_app.config['FRONTEND_URL']}/login?error={error}")

    code = request.args.get('code')
    if not code:
        return redirect(f"{current_app.config['FRONTEND_URL']}/login?error=no_code")

    try:
        user_info = svc.verify_google_token(code, current_app.config['GOOGLE_REDIRECT_URI'])
        user = svc.upsert_user(
            email=user_info['email'],
            name=user_info['name'],
            avatar_url=user_info['avatar_url'],
            google_sub=user_info['sub'],
        )
        return _issue_tokens_redirect(user)
    except AuthenticationError as e:
        return redirect(f"{current_app.config['FRONTEND_URL']}/login?error=auth_failed")
    except Exception as e:
        current_app.logger.error(f'Google callback error: {e}')
        return redirect(f"{current_app.config['FRONTEND_URL']}/login?error=server_error")


@auth_bp.route('/api/auth/apple')
def apple_login():
    state = secrets.token_urlsafe(16)
    session['oauth_state'] = state
    params = {
        'client_id': current_app.config['APPLE_CLIENT_ID'],
        'redirect_uri': current_app.config['APPLE_REDIRECT_URI'],
        'response_type': 'code id_token',
        'scope': 'name email',
        'state': state,
        'response_mode': 'form_post',
    }
    return redirect(f"https://appleid.apple.com/auth/authorize?{urlencode(params)}")


@auth_bp.route('/api/auth/apple/callback', methods=['POST'])
def apple_callback():
    error = request.form.get('error')
    if error:
        return redirect(f"{current_app.config['FRONTEND_URL']}/login?error={error}")

    code = request.form.get('code')
    id_token = request.form.get('id_token', '')

    # Apple sends user name JSON only on first auth
    user_json = request.form.get('user', '{}')
    try:
        import json
        user_data = json.loads(user_json)
        first = user_data.get('name', {}).get('firstName', '')
        last = user_data.get('name', {}).get('lastName', '')
        name = f"{first} {last}".strip()
    except Exception:
        name = ''

    try:
        user_info = svc.verify_apple_token(code, id_token, current_app.config['APPLE_REDIRECT_URI'])
        user = svc.upsert_user(
            email=user_info.get('email', ''),
            name=name,
            apple_sub=user_info['sub'],
        )
        return _issue_tokens_redirect(user)
    except AuthenticationError as e:
        return redirect(f"{current_app.config['FRONTEND_URL']}/login?error=auth_failed")
    except Exception as e:
        current_app.logger.error(f'Apple callback error: {e}')
        return redirect(f"{current_app.config['FRONTEND_URL']}/login?error=server_error")


@auth_bp.route('/api/auth/me')
@jwt_required()
def me():
    user_id = get_jwt_identity()
    user = svc.get_user_by_id(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404
    return jsonify(user)


@auth_bp.route('/api/auth/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    user_id = get_jwt_identity()
    access_token = create_access_token(identity=user_id)
    return jsonify({'access_token': access_token})


@auth_bp.route('/api/auth/logout', methods=['POST'])
@jwt_required(optional=True)
def logout():
    return jsonify({'message': 'Logged out'})


def _issue_tokens_redirect(user: dict):
    user_id = str(user['id'])
    access_token = create_access_token(identity=user_id)
    refresh_token = create_refresh_token(identity=user_id)
    frontend = current_app.config['FRONTEND_URL']
    params = urlencode({'access_token': access_token, 'refresh_token': refresh_token})
    return redirect(f"{frontend}/auth/callback?{params}")
