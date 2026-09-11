import datetime
import urllib.parse
import urllib.request
import zoneinfo


# 1. Tool implementations
def get_current_time(city: str) -> str:
    """Get current date and time for a given city using Python stdlib."""
    normalized = city.strip().replace(" ", "_").lower()
    tz_name = next(
        (tz for tz in zoneinfo.available_timezones() if normalized in tz.lower()),
        "UTC",
    )
    now = datetime.datetime.now(zoneinfo.ZoneInfo(tz_name))
    return now.strftime(f"%Y-%m-%d %H:%M:%S ({tz_name})")


def get_current_weather(city: str) -> str:
    """Get current weather conditions for a city using wttr.in."""
    encoded_city = urllib.parse.quote(city.strip())
    url = f"https://wttr.in/{encoded_city}?format=%l:+%C+%t,+humidity+%h"
    req = urllib.request.Request(url, headers={"User-Agent": "curl/7.68.0"})
    with urllib.request.urlopen(req, timeout=5) as response:
        return response.read().decode("utf-8").strip()


# 2. Tool dispatch registry mapping function names to callable Python functions
AVAILABLE_TOOLS = {
    "get_current_time": get_current_time,
    "get_current_weather": get_current_weather,
}

# 3. OpenAI-compatible tool definitions schema exposed to the model
TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "Get the current date and time for a given city or timezone.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "City name (e.g. Tokyo, London, New York, Kolkata)",
                    }
                },
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "Get current weather conditions for a given city.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "City name (e.g. Paris, Tokyo, Gandhinagar)",
                    }
                },
                "required": ["city"],
            },
        },
    },
]
