"""
Cloudflare R2 storage for Training Plans.
Uses the same bucket as the ERP (rinosbike), under the 'training/' prefix.

Folders:
  training/food-labels/   — scanned food label photos
  training/icons/         — platform/app icons
"""
import io
import os
import uuid
import logging
import boto3
from botocore.config import Config as BotoConfig

log = logging.getLogger(__name__)

R2_ACCOUNT_ID    = os.getenv('R2_ACCOUNT_ID', '')
R2_ACCESS_KEY_ID = os.getenv('R2_ACCESS_KEY_ID', '')
R2_SECRET_ACCESS_KEY = os.getenv('R2_SECRET_ACCESS_KEY', '')
R2_BUCKET        = os.getenv('R2_IMAGE_BUCKET', 'rinosbike')
R2_PUBLIC_URL    = os.getenv('R2_IMAGE_PUBLIC_URL', '')

_MIME_EXT = {
    'image/jpeg': 'jpg',
    'image/png':  'png',
    'image/webp': 'webp',
    'image/gif':  'gif',
    'image/svg+xml': 'svg',
}


def _client():
    endpoint = f'https://{R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com'
    return boto3.client(
        's3',
        endpoint_url=endpoint,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=BotoConfig(signature_version='s3v4'),
        region_name='auto',
    )


def upload_image(data: bytes, folder: str, content_type: str,
                 filename: str = None) -> str:
    """
    Upload image bytes to R2 under training/<folder>/<filename>.
    Returns the public URL.
    filename defaults to a UUID + appropriate extension.
    """
    ext = _MIME_EXT.get(content_type, 'bin')
    if not filename:
        filename = f'{uuid.uuid4().hex}.{ext}'
    key = f'training/{folder.strip("/")}/{filename}'

    _client().put_object(
        Bucket=R2_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
        CacheControl='public, max-age=31536000',
    )
    url = f'{R2_PUBLIC_URL}/{key}'
    log.info('Uploaded %d bytes to R2: %s', len(data), url)
    return url


def delete_image(url: str) -> bool:
    """Delete an image from R2 by its public URL. Returns True on success."""
    if not url or not R2_PUBLIC_URL or R2_PUBLIC_URL not in url:
        return False
    key = url.replace(f'{R2_PUBLIC_URL}/', '')
    try:
        _client().delete_object(Bucket=R2_BUCKET, Key=key)
        log.info('Deleted R2 object: %s', key)
        return True
    except Exception as e:
        log.warning('R2 delete failed for %s: %s', key, e)
        return False
