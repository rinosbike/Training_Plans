"""
Credential service — reads/writes training.api_credentials.

No RLS on this table (no user_id); uses service connection.
"""
from app.db import get_service_connection


def get_credential(platform: str, key_name: str) -> str | None:
    conn = get_service_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'SELECT key_value FROM training.api_credentials WHERE platform=%s AND key_name=%s',
                (platform, key_name),
            )
            row = cur.fetchone()
            return row['key_value'] if row else None
    finally:
        conn.close()


def set_credential(platform: str, key_name: str, key_value: str,
                   is_secret: bool = True, description: str = '') -> None:
    conn = get_service_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                '''INSERT INTO training.api_credentials (platform, key_name, key_value, is_secret, description)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (platform, key_name) DO UPDATE
                       SET key_value = EXCLUDED.key_value,
                           is_secret = EXCLUDED.is_secret,
                           description = EXCLUDED.description,
                           updated_at = NOW()''',
                (platform, key_name, key_value, is_secret, description),
            )
        conn.commit()
    finally:
        conn.close()


def list_credentials(platform: str = None) -> list[dict]:
    conn = get_service_connection()
    try:
        with conn.cursor() as cur:
            if platform:
                cur.execute(
                    '''SELECT platform, key_name, is_secret, description, updated_at
                       FROM training.api_credentials WHERE platform=%s ORDER BY key_name''',
                    (platform,),
                )
            else:
                cur.execute(
                    '''SELECT platform, key_name, is_secret, description, updated_at
                       FROM training.api_credentials ORDER BY platform, key_name''',
                )
            cols = [d[0] for d in cur.description]
            rows = cur.fetchall()
            result = []
            for row in rows:
                r = dict(zip(cols, row))
                if r['updated_at']:
                    r['updated_at'] = r['updated_at'].isoformat()
                result.append(r)
            return result
    finally:
        conn.close()


def delete_credential(platform: str, key_name: str) -> bool:
    conn = get_service_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'DELETE FROM training.api_credentials WHERE platform=%s AND key_name=%s',
                (platform, key_name),
            )
            deleted = cur.rowcount > 0
        conn.commit()
        return deleted
    finally:
        conn.close()
