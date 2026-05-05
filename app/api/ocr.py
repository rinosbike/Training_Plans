"""
OCR endpoint: accepts a food label image, sends it directly to Claude vision
to extract per-100g nutritional values. No tesseract dependency.
"""
import io
import re
import json
import logging
import base64
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from app.services import ai_coach_service as svc
from app.db import execute_write
from app.exceptions import ValidationError

ocr_bp = Blueprint('ocr', __name__)
log = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 8 * 1024 * 1024   # 8 MB
MAX_SEND_BYTES  = 3 * 1024 * 1024   # resize if over 3 MB before sending
ALLOWED_MIMES   = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}

NUTRIENT_COLS = {
    'calories_per_100g', 'protein_per_100g', 'carbs_per_100g', 'fat_per_100g',
    'fiber_per_100g', 'sodium_per_100g', 'iron_per_100g', 'calcium_per_100g',
    'vitamin_d_per_100g', 'vitamin_b12_per_100g', 'vitamin_c_per_100g',
    'magnesium_per_100g', 'potassium_per_100g', 'zinc_per_100g',
}

VISION_PROMPT = """You are reading a food product nutrition label from the photo provided.

Extract the nutritional values **per 100g** (or per 100ml for liquids).
- If the label only shows per-serving values, convert using the serving size stated.
- If a nutrient is not visible on the label, omit it from the JSON.
- For the food name, use the product name printed on the packaging.

Return ONLY valid JSON — no markdown fences, no other text:
{
  "food_name_guess": "product name from the label",
  "per_100g": {
    "calories_per_100g": 150,
    "protein_per_100g": 8.5,
    "carbs_per_100g": 20.0,
    "fat_per_100g": 4.2,
    "fiber_per_100g": 1.8,
    "sodium_per_100g": 0.35,
    "iron_per_100g": 1.2,
    "calcium_per_100g": 180,
    "vitamin_d_per_100g": 0.5,
    "vitamin_b12_per_100g": 0.3,
    "vitamin_c_per_100g": 2.0,
    "magnesium_per_100g": 22,
    "potassium_per_100g": 280,
    "zinc_per_100g": 0.8
  },
  "warnings": ["any notes about ambiguous values or conversions"]
}"""


def _prepare_image(image_bytes: bytes, mime: str) -> tuple[bytes, str]:
    """Resize image to under MAX_SEND_BYTES to stay within Claude's limits."""
    if len(image_bytes) <= MAX_SEND_BYTES:
        return image_bytes, mime
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes))
        # Downscale iteratively until under limit
        w, h = img.size
        scale = (MAX_SEND_BYTES / len(image_bytes)) ** 0.5
        new_w, new_h = max(400, int(w * scale)), max(400, int(h * scale))
        img = img.resize((new_w, new_h), Image.LANCZOS)
        buf = io.BytesIO()
        img.convert('RGB').save(buf, format='JPEG', quality=82)
        return buf.getvalue(), 'image/jpeg'
    except Exception as e:
        log.warning('Image resize failed: %s — sending original', e)
        return image_bytes, mime


def _read_label_with_vision(image_bytes: bytes, mime: str) -> dict:
    """Send image to Claude vision and extract structured nutrition data."""
    image_bytes, mime = _prepare_image(image_bytes, mime)
    b64 = base64.b64encode(image_bytes).decode()
    data_url = f"data:{mime};base64,{b64}"

    messages = [{
        'role': 'user',
        'content': [
            {'type': 'image_url', 'image_url': {'url': data_url}},
            {'type': 'text', 'text': VISION_PROMPT},
        ],
    }]

    content, _ = svc.chat_complete(messages, max_tokens=700)
    content = content.strip()
    # Strip markdown fences if present
    if content.startswith('```'):
        content = re.sub(r'^```[a-z]*\n?', '', content)
        content = re.sub(r'\n?```$', '', content)
    return json.loads(content)


@ocr_bp.route('/api/ocr/food-label', methods=['POST'])
@jwt_required()
def scan_food_label():
    """
    Accept multipart/form-data with field 'image'.
    Returns structured per-100g values parsed directly by Claude vision.
    """
    if 'image' not in request.files:
        raise ValidationError('image file required')

    f = request.files['image']
    mime = f.content_type or 'image/jpeg'
    if mime not in ALLOWED_MIMES:
        raise ValidationError(f'Unsupported image type: {mime}')

    image_bytes = f.read()
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValidationError('Image too large (max 8 MB)')

    try:
        parsed = _read_label_with_vision(image_bytes, mime)
    except Exception as e:
        log.error('Vision label read failed: %s', e)
        return jsonify({'error': 'Could not read the label — try a clearer, well-lit photo'}), 422

    # Sanitize: only return whitelisted nutrient keys with float values
    per_100g = {
        k: float(v) for k, v in (parsed.get('per_100g') or {}).items()
        if k in NUTRIENT_COLS and v is not None
    }

    food_name = parsed.get('food_name_guess', '').strip()
    food_id = None

    # Save to food_database immediately so AI coach can log it with correct macros
    if food_name and per_100g.get('calories_per_100g') is not None:
        try:
            cols = ['name', 'source'] + list(per_100g.keys())
            vals = [food_name, 'user'] + list(per_100g.values())
            placeholders = ', '.join(['%s'] * len(vals))
            col_names = ', '.join(cols)
            row = execute_write(
                f'INSERT INTO training.food_database ({col_names}) VALUES ({placeholders}) RETURNING id',
                vals, returning=True
            )
            food_id = row['id'] if row else None
            log.info('Saved scanned food "%s" to food_database id=%s', food_name, food_id)
        except Exception as e:
            log.warning('Could not save scanned food to DB: %s', e)

    return jsonify({
        'food_name_guess': food_name,
        'per_100g': per_100g,
        'warnings': parsed.get('warnings', []),
        'food_id': food_id,
    })
