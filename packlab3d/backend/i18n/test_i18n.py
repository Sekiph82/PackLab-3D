import importlib.util
import json
from pathlib import Path

import pytest

_I18N_DIR = Path(__file__).parent
_MODULE_PATH = _I18N_DIR / "__init__.py"
_spec = importlib.util.spec_from_file_location("packlab3d_backend_i18n", _MODULE_PATH)
i18n = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(i18n)

get_message = i18n.get_message
set_language = i18n.set_language
SUPPORTED_LANGUAGES = i18n.SUPPORTED_LANGUAGES


def _flatten_keys(d, prefix=""):
    keys = []
    for k, v in d.items():
        full_key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            keys.extend(_flatten_keys(v, full_key))
        else:
            keys.append(full_key)
    return sorted(keys)


def _load(lang):
    return json.loads((_I18N_DIR / f"{lang}.json").read_text(encoding="utf-8"))


def test_key_parity_across_languages():
    key_sets = [_flatten_keys(_load(lang)) for lang in SUPPORTED_LANGUAGES]
    for keys in key_sets[1:]:
        assert keys == key_sets[0]


def test_get_message_per_language():
    for lang in SUPPORTED_LANGUAGES:
        data = _load(lang)
        assert get_message("errors.invalidDimensions", lang) == data["errors"]["invalidDimensions"]
        assert get_message("api.exportComplete", lang) == data["api"]["exportComplete"]


def test_get_message_default_language_is_english():
    assert get_message("api.languageSet") == _load("en")["api"]["languageSet"]


def test_fallback_to_default_on_missing_key():
    assert get_message("nonexistent.key") == "nonexistent.key"


def test_set_language_accepts_supported():
    for lang in SUPPORTED_LANGUAGES:
        assert set_language(lang) == lang


def test_set_language_rejects_unsupported():
    with pytest.raises(ValueError):
        set_language("fr")
