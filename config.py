import os
from datetime import timedelta


class Config:
    SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'change-me-in-production')
    DATABASE_URL = os.getenv('DATABASE_URL', '')
    MAX_CONTENT_LENGTH = 2 * 1024 * 1024 * 1024  # 2 GB for video uploads

    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'change-me-in-production')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=8)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)

    GOOGLE_CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID', '')
    GOOGLE_CLIENT_SECRET = os.getenv('GOOGLE_CLIENT_SECRET', '')
    GOOGLE_REDIRECT_URI = os.getenv('GOOGLE_REDIRECT_URI', 'http://localhost:5002/api/auth/google/callback')

    APPLE_CLIENT_ID = os.getenv('APPLE_CLIENT_ID', '')
    APPLE_TEAM_ID = os.getenv('APPLE_TEAM_ID', '')
    APPLE_KEY_ID = os.getenv('APPLE_KEY_ID', '')
    APPLE_PRIVATE_KEY = os.getenv('APPLE_PRIVATE_KEY', '')
    APPLE_REDIRECT_URI = os.getenv('APPLE_REDIRECT_URI', 'http://localhost:5002/api/auth/apple/callback')

    GITHUB_COPILOT_TOKEN = os.getenv('GITHUB_COPILOT_TOKEN', '')

    FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:3000')

    CORS_ORIGINS = ['http://localhost:3000', 'http://localhost:5002', 'https://training.rinosbike.com']


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False
    CORS_ORIGINS = ['https://training.rinosbike.com']
    GOOGLE_REDIRECT_URI = 'https://training.rinosbike.com/api/auth/google/callback'
    APPLE_REDIRECT_URI = 'https://training.rinosbike.com/api/auth/apple/callback'
    FRONTEND_URL = 'https://training.rinosbike.com'


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig,
}
