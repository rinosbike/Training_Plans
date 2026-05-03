"""
GitHub Copilot API client for the AI coaching feature.
Replicates ERP copilot_client.py pattern exactly.
"""
import os
import json
import requests


COPILOT_API_URL = 'https://api.githubcopilot.com/chat/completions'
DEFAULT_MODEL = 'gpt-4o'


class CopilotAPIError(Exception):
    def __init__(self, status_code, message):
        self.status_code = status_code
        self.message = message
        super().__init__(message)


def build_system_prompt(user: dict, goal: dict, profile: dict, context: dict = None) -> str:
    goal_name = goal.get('goal_name', 'your goal')
    goal_type = goal.get('goal_type', '')
    target_date = goal.get('target_date', '')
    fitness_level = (profile or {}).get('fitness_level', 'beginner')
    weight = (profile or {}).get('weight_kg', '')
    weekly_hours = (profile or {}).get('current_weekly_hours', '')

    day_context = ''
    if context and context.get('date'):
        day_context = f"""
Current day context:
- Date: {context['date']}
- Day type: {context.get('day_type', '')}
- Block: {context.get('block_type', '')}
- Workouts: {json.dumps(context.get('workouts', []), indent=2)}
"""

    return f"""You are an expert endurance sports coach and nutrition advisor for training app training.rinosbike.com.

Athlete profile:
- Name: {user.get('name', 'Athlete')}
- Goal: {goal_name} ({goal_type})
- Target date: {target_date}
- Fitness level: {fitness_level}
- Weight: {weight} kg
- Current weekly training hours: {weekly_hours}h

{day_context}

Coaching principles you follow:
- Safe progressive overload: max 10% weekly volume increase
- Polarized training: 80% Zone 1-2, 20% Zone 3-5
- Periodization: Base → Build → Peak → Taper blocks
- Recovery weeks every 4th week (70% volume)
- Multi-sport balance for triathlon goals

You can help the athlete:
- Adjust or swap workouts in their plan
- Explain intensity zones and purpose of each session
- Give nutrition advice tailored to their training load
- Suggest recovery strategies
- Answer questions about their goal

Always be encouraging, practical, and safety-conscious. Keep responses concise and actionable.
"""


def chat_stream(messages: list, model: str = DEFAULT_MODEL):
    """Generator that yields SSE-format lines for streaming."""
    token = os.getenv('GITHUB_COPILOT_TOKEN', '')
    if not token:
        raise CopilotAPIError(0, 'GITHUB_COPILOT_TOKEN not set')

    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
        'Copilot-Integration-Id': 'vscode-chat',
        'Editor-Version': 'training-app/1.0',
    }
    payload = {
        'model': model,
        'messages': messages,
        'stream': True,
        'max_tokens': 1024,
        'temperature': 0.7,
    }

    resp = requests.post(COPILOT_API_URL, headers=headers, json=payload, stream=True, timeout=60)
    if resp.status_code != 200:
        raise CopilotAPIError(resp.status_code, f'Copilot API error: {resp.status_code}')

    for line in resp.iter_lines():
        if line:
            yield line.decode('utf-8')


def chat_complete(messages: list, model: str = DEFAULT_MODEL) -> tuple[str, int]:
    """Returns (content, tokens_used)."""
    token = os.getenv('GITHUB_COPILOT_TOKEN', '')
    if not token:
        raise CopilotAPIError(0, 'GITHUB_COPILOT_TOKEN not set')

    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json',
        'Copilot-Integration-Id': 'vscode-chat',
    }
    payload = {
        'model': model,
        'messages': messages,
        'stream': False,
        'max_tokens': 1024,
    }
    resp = requests.post(COPILOT_API_URL, headers=headers, json=payload, timeout=30)
    data = resp.json()
    content = data['choices'][0]['message']['content']
    tokens = data.get('usage', {}).get('total_tokens', 0)
    return content, tokens


def parse_sse_chunk(line: str) -> str | None:
    """Extract text token from SSE data line."""
    if not line.startswith('data: '):
        return None
    data = line[6:]
    if data == '[DONE]':
        return None
    try:
        chunk = json.loads(data)
        delta = chunk['choices'][0].get('delta', {})
        return delta.get('content')
    except Exception:
        return None
