import os
import psycopg2
import psycopg2.extras
import psycopg2.extensions
from psycopg2.extras import RealDictCursor, Json
from flask import g

psycopg2.extensions.register_adapter(dict, Json)
psycopg2.extensions.register_adapter(list, Json)


def get_db():
    if 'db' not in g:
        g.db = psycopg2.connect(
            os.getenv('DATABASE_URL'),
            cursor_factory=RealDictCursor
        )
        g.db.autocommit = False
        user_id = getattr(g, 'user_id', None)
        if user_id:
            with g.db.cursor() as cur:
                cur.execute(
                    "SELECT set_config('training.current_user_id', %s, false)",
                    (str(user_id),)
                )
            g.db.commit()
    return g.db


def close_db():
    db = g.pop('db', None)
    if db is not None:
        db.close()


def set_user_context(user_id: str):
    db = get_db()
    with db.cursor() as cur:
        cur.execute(
            "SELECT set_config('training.current_user_id', %s, false)",
            (str(user_id),)
        )
    db.commit()


def execute_query(query, params=None, fetch_one=False):
    db = get_db()
    with db.cursor() as cur:
        cur.execute(query, params)
        if fetch_one:
            return cur.fetchone()
        return cur.fetchall()


def execute_write(query, params=None, returning=False):
    db = get_db()
    with db.cursor() as cur:
        cur.execute(query, params)
        result = cur.fetchone() if returning else None
        db.commit()
        return result


def get_service_connection(user_id: str = None):
    conn = psycopg2.connect(
        os.getenv('DATABASE_URL'),
        cursor_factory=RealDictCursor
    )
    conn.autocommit = False
    if user_id:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT set_config('training.current_user_id', %s, false)",
                (str(user_id),)
            )
        conn.commit()
    return conn
