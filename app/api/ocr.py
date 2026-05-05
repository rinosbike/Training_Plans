"""
OCR endpoint: accepts a food label image, extracts text via tesseract,
then uses Claude to parse out the per-100g nutritional values.
Returns a structured preview the frontend shows for human confirmation.
"""
import io
import re
import json
import logging
import base64
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from app.services import ai_coach_service as svc
from app.exceptions import ValidationError

ocr_bp = Blueprint('ocr', __name__)
log = logging.getLogger(__name__)

MAX_IMAGE_BYTES = 8 * 1024 * 1024   # 8 MB
ALLOWED_MIMES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}

NUTRIENT_COLS = {
    'calories_per_100g', 'protein_per_100g', 'carbs_per_100g', 'fat_per_100g',
    'fiber_per_100g', 'sodium_per_100g', 'iron_per_100g', 'calcium_per_100g',
    'vitamin_d_per_100g', 'vitamin_b12_per_100g', 'vitamin_c_per_100g',
    'magnesium_per_100g', 'potassium_per_100g', 'zinc_per_100g',
}

PARSE_PROMPT = """You are reading OCR text extracted from a food nutrition label.
Extract the per-100g (or per 100ml) values for each nutrient listed below.
If the label shows "per serving" only and not per 100g, convert using the serving size if stated.
If a value is not present on the label, omit it.

Return ONLY valid JSON — no other text:
{{
  "food_name_guess": "best guess at the food name from the label text",
  "per_100g": {{
    "calories_per_100g": 64,
    "protein_per_100g": 3.2,
    "carbs_per_100g": 4.8,
    "fat_per_100g": 3.5,
    "fiber_per_100g": 0,
    "sodium_per_100g": 40,
    "iron_per_100g": 0.03,
    "calcium_per_100g": 120,
    "vitamin_d_per_100g": 1.2,
    "vitamin_b12_per_100g": 0.4,
    "vitamin_c_per_100g": 1,
    "magnesium_per_100g": 11,
    "potassium_per_100g": 150,
    "zinc_per_100g": 0.4
  }},
  "warnings": ["any notes about ambiguous values or conversions made"]
}}

OCR text from label:
{ocr_text}"""


def _run_ocr(image_bytes: bytes, mime: str) -> str:
    """Extract text from image bytes using pytesseract (primary) with fitz fallback for PDFs."""
    try:
        import pytesseract
        from PIL import Image, ImageFilter, ImageOps
        img = Image.open(io.BytesIO(image_bytes))
        # Upscale small images for better OCR accuracy
        w, h = img.size
        if max(w, h) < 1200:
            scale = 1200 / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        # Convert to greyscale + enhance contrast
        img = ImageOps.autocontrast(img.convert('L'))
        text = pytesseract.image_to_string(img, config='--psm 6')
        return text.strip()
    except Exception as e:
        log.warning('OCR failed: %s', e)
        return ''


def _parse_with_claude(ocr_text: str) -> dict:
    """Use Claude to structure the raw OCR text into per-100g nutrient values."""
    if not ocr_text:
        return {}
    prompt = PARSE_PROMPT.format(ocr_text=ocr_text[:3000])
    try:
        content, _ = svc.chat_complete(
            [{'role': 'user', 'content': prompt}],
            max_tokens=600,
        )
        content = content.strip()
        if content.startswith('```'):
            content = re.sub(r'^```[a-z]*\n?', '', content)
            content = re.sub(r'\n?```$', '', content)
        return json.loads(content)
    except Exception as e:
        log.warning('Claude parse failed: %s', e)
        return {}


@ocr_bp.route('/api/ocr/food-label', methods=['POST'])
@jwt_required()
def scan_food_label():
    """
    Accept multipart/form-data with field 'image'.
    Returns structured per-100g values + raw OCR text for user review.
    """
    if 'image' not in request.files:
        raise ValidationError('image file required')

    f = request.files['image']
    if f.content_type not in ALLOWED_MIMES:
        raise ValidationError(f'Unsupported image type: {f.content_type}')

    image_bytes = f.read()
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValidationError('Image too large (max 8 MB)')

    ocr_text = _run_ocr(image_bytes, f.content_type)
    if not ocr_text:
        return jsonify({'error': 'Could not extract text from image', 'ocr_text': ''}), 422

    parsed = _parse_with_claude(ocr_text)

    # Sanitize: only return whitelisted nutrient keys
    per_100g = {
        k: float(v) for k, v in (parsed.get('per_100g') or {}).items()
        if k in NUTRIENT_COLS and v is not None
    }

    return jsonify({
        'food_name_guess': parsed.get('food_name_guess', ''),
        'per_100g': per_100g,
        'warnings': parsed.get('warnings', []),
        'ocr_text': ocr_text,          # shown to user so they can spot OCR errors
    })
