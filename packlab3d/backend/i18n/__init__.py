import json
from pathlib import Path
from typing import Any, Optional

SUPPORTED_LANGUAGES = ("en", "tr", "sw")
DEFAULT_LANGUAGE = "en"

_I18N_DIR = Path(__file__).parent


def _load_language_file(lang: str) -> dict:
    with open(_I18N_DIR / f"{lang}.json", encoding="utf-8") as f:
        return json.load(f)


_TRANSLATIONS = {lang: _load_language_file(lang) for lang in SUPPORTED_LANGUAGES}


def set_language(lang: str) -> str:
    if lang not in SUPPORTED_LANGUAGES:
        raise ValueError(f"Unsupported language: {lang}")
    return lang


def get_message(key_path: str, lang: str = DEFAULT_LANGUAGE) -> str:
    lang = lang if lang in SUPPORTED_LANGUAGES else DEFAULT_LANGUAGE
    node: Optional[Any] = _TRANSLATIONS[lang]
    for key in key_path.split("."):
        if not isinstance(node, dict) or key not in node:
            node = None
            break
        node = node[key]
    if node is None and lang != DEFAULT_LANGUAGE:
        return get_message(key_path, DEFAULT_LANGUAGE)
    return node if node is not None else key_path
