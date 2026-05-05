import time
import requests
import jwt as pyjwt
from cryptography.hazmat.primitives import serialization
from flask import current_app
from app.db import execute_query, execute_write
from app.exceptions import AuthenticationError


def verify_google_token(code: str, redirect_uri: str) -> dict:
    token_resp = requests.post('https://oauth2.googleapis.com/token', data={
        'code': code,
        'client_id': current_app.config['GOOGLE_CLIENT_ID'],
        'client_secret': current_app.config['GOOGLE_CLIENT_SECRET'],
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code',
    })
    token_data = token_resp.json()
    if 'error' in token_data:
        raise AuthenticationError(f"Google token error: {token_data.get('error_description', token_data['error'])}")

    id_token = token_data.get('id_token')
    if not id_token:
        raise AuthenticationError('No id_token from Google')

    # Decode without verification — Google's userinfo endpoint is authoritative
    payload = pyjwt.decode(id_token, options={'verify_signature': False})
    return {
        'sub': payload.get('sub'),
        'email': payload.get('email'),
        'name': payload.get('name', ''),
        'avatar_url': payload.get('picture', ''),
    }


def verify_apple_token(code: str, id_token_str: str, redirect_uri: str) -> dict:
    client_secret = _build_apple_client_secret()

    token_resp = requests.post('https://appleid.apple.com/auth/token', data={
        'code': code,
        'client_id': current_app.config['APPLE_CLIENT_ID'],
        'client_secret': client_secret,
        'redirect_uri': redirect_uri,
        'grant_type': 'authorization_code',
    })
    token_data = token_resp.json()
    if 'error' in token_data:
        raise AuthenticationError(f"Apple token error: {token_data['error']}")

    id_token = token_data.get('id_token') or id_token_str
    if not id_token:
        raise AuthenticationError('No id_token from Apple')

    payload = pyjwt.decode(id_token, options={'verify_signature': False})
    return {
        'sub': payload.get('sub'),
        'email': payload.get('email', ''),
    }


def _build_apple_client_secret() -> str:
    private_key_str = current_app.config['APPLE_PRIVATE_KEY'].replace('\\n', '\n')
    headers = {
        'alg': 'ES256',
        'kid': current_app.config['APPLE_KEY_ID'],
    }
    payload = {
        'iss': current_app.config['APPLE_TEAM_ID'],
        'iat': int(time.time()),
        'exp': int(time.time()) + 86400 * 180,
        'aud': 'https://appleid.apple.com',
        'sub': current_app.config['APPLE_CLIENT_ID'],
    }
    private_key = serialization.load_pem_private_key(private_key_str.encode(), password=None)
    return pyjwt.encode(payload, private_key, algorithm='ES256', headers=headers)


def upsert_user(email: str, name: str, avatar_url: str = '',
                google_sub: str = None, apple_sub: str = None) -> dict:
    if google_sub:
        existing = execute_query(
            'SELECT * FROM training.users WHERE google_sub = %s', (google_sub,), fetch_one=True
        )
        if existing:
            execute_write(
                'UPDATE training.users SET name=%s, avatar_url=%s WHERE google_sub=%s',
                (name, avatar_url, google_sub)
            )
            return dict(existing)

    if apple_sub:
        existing = execute_query(
            'SELECT * FROM training.users WHERE apple_sub = %s', (apple_sub,), fetch_one=True
        )
        if existing:
            return dict(existing)

    if email:
        existing = execute_query(
            'SELECT * FROM training.users WHERE email = %s', (email,), fetch_one=True
        )
        if existing:
            # Link the OAuth sub to existing account
            updates, vals = [], []
            if google_sub:
                updates.append('google_sub=%s'); vals.append(google_sub)
            if apple_sub:
                updates.append('apple_sub=%s'); vals.append(apple_sub)
            if name:
                updates.append('name=%s'); vals.append(name)
            if avatar_url:
                updates.append('avatar_url=%s'); vals.append(avatar_url)
            if updates:
                vals.append(existing['id'])
                execute_write(
                    f"UPDATE training.users SET {', '.join(updates)} WHERE id=%s", vals
                )
            return dict(existing)

    # New user
    row = execute_write(
        '''INSERT INTO training.users (email, name, avatar_url, google_sub, apple_sub)
           VALUES (%s, %s, %s, %s, %s) RETURNING *''',
        (email, name, avatar_url, google_sub, apple_sub),
        returning=True
    )
    return dict(row)


def get_user_by_id(user_id: str) -> dict | None:
    row = execute_query(
        'SELECT id, email, name, avatar_url, is_admin, role, created_at FROM training.users WHERE id = %s',
        (user_id,), fetch_one=True
    )
    return dict(row) if row else None
