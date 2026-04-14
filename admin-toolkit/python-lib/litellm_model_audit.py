"""LiteLLM pricing-based model audit helpers.

This module is intentionally small and JSON-friendly so the webapp backend can
classify discovered Dataiku LLM Mesh model references without shelling out to
the standalone in-progress audit script.
"""

from __future__ import annotations

import datetime as dt
import json
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable
from urllib.request import Request, urlopen


LITELLM_PRICING_URL = (
    "https://raw.githubusercontent.com/BerriAI/litellm/main/"
    "model_prices_and_context_window.json"
)

USER_AGENT = "Mozilla/5.0 (compatible; admin-toolkit-litellm-model-audit/1.0)"

PROVIDERS = {
    "openai": {
        "display": "OpenAI",
        "litellm_providers": {"openai", "text-completion-openai"},
        "strip_prefixes": (),
    },
    "anthropic": {
        "display": "Anthropic",
        "litellm_providers": {"anthropic"},
        "strip_prefixes": (),
    },
    "gemini": {
        "display": "Google Gemini",
        "litellm_providers": {"gemini"},
        "strip_prefixes": ("gemini/",),
    },
}

ALLOWED_MODES = {"chat", "completion", "responses"}

NON_LLM_NAME_TERMS = {
    "audio",
    "computer-use",
    "dall-e",
    "embedding",
    "image",
    "imagen",
    "learnlm",
    "live-preview",
    "lyria",
    "moderation",
    "native-audio",
    "realtime",
    "robotics",
    "sora",
    "speech",
    "tts",
    "transcribe",
    "veo",
    "whisper",
}

SPECIALIZED_NAME_TERMS = {
    "codex",
    "deep-research",
    "experimental",
    "gemini-exp",
    "gemma",
    "search-api",
    "search-preview",
}

MODEL_KEY_TERMS = {
    "llmid",
    "llm_id",
    "model",
    "modelid",
    "model_id",
    "modelname",
    "model_name",
    "chatmodel",
    "chat_model",
    "completionmodel",
    "completion_model",
}

MODEL_TEXT_RE = re.compile(
    r"\b(?:"
    r"gpt-\d[\w.-]*|chatgpt-\d[\w.-]*|o\d(?:-[\w.-]+)?|"
    r"claude-[\w.-]*|gemini-\d[\w.-]*|"
    r"(?:openai|anthropic|gemini)/[A-Za-z0-9_.:/-]+"
    r")\b",
    re.IGNORECASE,
)


@dataclass
class ModelGroup:
    provider: str
    family: str
    canonical_model: str
    input_price: Decimal
    output_price: Decimal
    version: tuple[Decimal, ...]
    aliases: set[str] = field(default_factory=set)
    deprecated: bool = False
    deprecation_dates: set[str] = field(default_factory=set)


@dataclass
class AuditFamily:
    provider: str
    family: str
    current: ModelGroup
    current_aliases: list[str]
    ripoff: list[ModelGroup]
    obsolete: list[ModelGroup]


def fetch_pricing_json(timeout: int = 20) -> dict[str, Any]:
    request = Request(
        LITELLM_PRICING_URL,
        headers={"User-Agent": USER_AGENT, "Accept": "application/json,*/*"},
    )
    with urlopen(request, timeout=timeout) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return json.loads(response.read().decode(charset, "replace"))


def decimal_from_cost(value: Any) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def per_million(value: Any) -> Decimal | None:
    cost = decimal_from_cost(value)
    if cost is None:
        return None
    return cost * Decimal("1000000")


def decimal_number(value: Decimal) -> int | float:
    if value == value.to_integral_value():
        return int(value)
    return float(value)


def strip_provider_prefix(model: str, provider_key: str) -> str:
    for prefix in PROVIDERS[provider_key]["strip_prefixes"]:
        if model.startswith(prefix):
            return model[len(prefix) :]
    return model


def strip_date_suffix(model: str) -> str:
    model = re.sub(r"-\d{4}-\d{2}-\d{2}$", "", model)
    model = re.sub(r"-\d{8}$", "", model)
    model = re.sub(r"-(?:preview-)?\d{2}-\d{4}$", "-preview", model)
    model = re.sub(r"-(?:preview-)?\d{4}$", "-preview", model)
    model = re.sub(r"-(\d{4})(?=-preview$)", "", model)
    model = re.sub(r"-001$", "", model)
    return model


def canonical_model(provider_key: str, model: str) -> str:
    model = strip_provider_prefix(model.lower(), provider_key)
    model = strip_date_suffix(model)

    if provider_key == "openai":
        model = re.sub(r"^gpt-(5(?:\.\d+)?)-chat(?:-latest)?$", r"gpt-\1", model)
        model = re.sub(r"^gpt-(3\.5-turbo)-instruct(?:-preview)?$", r"gpt-\1-instruct", model)
        model = re.sub(r"^gpt-(3\.5-turbo)(?:-preview)?$", r"gpt-\1", model)

    if provider_key == "anthropic":
        model = re.sub(r"^claude-4-(opus|sonnet|haiku)$", r"claude-\1-4", model)
        model = re.sub(r"^claude-(opus|sonnet|haiku)-4$", r"claude-\1-4", model)
        model = re.sub(r"^claude-3-5-haiku$", "claude-haiku-3-5", model)

    if provider_key == "gemini":
        model = re.sub(r"-customtools$", "", model)

    return model


def accepts_text_input(info: dict[str, Any]) -> bool:
    modalities = info.get("supported_modalities")
    if modalities is None:
        return True
    return isinstance(modalities, list) and "text" in modalities


def has_text_output(info: dict[str, Any]) -> bool:
    modalities = info.get("supported_output_modalities")
    if modalities is None:
        return True
    return isinstance(modalities, list) and "text" in modalities


def model_name_has_term(model: str, terms: set[str]) -> bool:
    normalized = model.lower().replace("_", "-")
    return any(term in normalized for term in terms)


def is_deprecated(info: dict[str, Any], today: dt.date) -> tuple[bool, str]:
    deprecation_date = str(info.get("deprecation_date") or "")
    if not deprecation_date:
        return False, ""
    try:
        return dt.date.fromisoformat(deprecation_date) <= today, deprecation_date
    except ValueError:
        return True, deprecation_date


def provider_key_for(info: dict[str, Any]) -> str | None:
    litellm_provider = info.get("litellm_provider")
    for provider_key, rule in PROVIDERS.items():
        if litellm_provider in rule["litellm_providers"]:
            return provider_key
    return None


def extract_numbers(value: str) -> tuple[Decimal, ...]:
    return tuple(Decimal(part) for part in re.findall(r"\d+(?:\.\d+)?", value))


def extract_anthropic_version(model: str) -> tuple[Decimal, ...]:
    if model.startswith(("claude-opus-", "claude-sonnet-", "claude-haiku-")):
        return extract_numbers(model.split("-", 2)[2])
    return extract_numbers(model)


def extract_gemini_version(model: str) -> tuple[Decimal, ...]:
    match = re.match(r"^gemini-(\d+(?:\.\d+)?)(?:-|$)", model)
    if not match:
        return (Decimal("-1"),)
    return tuple(Decimal(part) for part in match.group(1).split("."))


def extract_openai_gpt_version(model: str) -> tuple[Decimal, ...]:
    if model.startswith("chatgpt-4o"):
        return (Decimal("4"), Decimal("0"))
    match = re.match(r"^gpt-(\d+(?:\.\d+)?)", model)
    if not match:
        return (Decimal("-1"),)
    return tuple(Decimal(part) for part in match.group(1).split("."))


def extract_openai_o_version(model: str) -> tuple[Decimal, ...]:
    match = re.match(r"^o(\d+)", model)
    if not match:
        return (Decimal("-1"),)
    return (Decimal(match.group(1)),)


def family_for(provider_key: str, model: str) -> tuple[str, tuple[Decimal, ...]] | None:
    if provider_key == "anthropic":
        if "opus" in model:
            return "Opus", extract_anthropic_version(model)
        if "sonnet" in model:
            return "Sonnet", extract_anthropic_version(model)
        if "haiku" in model:
            return "Haiku", extract_anthropic_version(model)
        return None

    if provider_key == "gemini":
        if "flash-lite" in model:
            return "Flash-Lite", extract_gemini_version(model)
        if "flash" in model:
            return "Flash", extract_gemini_version(model)
        if "pro" in model:
            return "Pro", extract_gemini_version(model)
        return None

    if provider_key == "openai":
        if re.match(r"^gpt-\d+(?:\.\d+)?-pro\b", model):
            return "GPT pro", extract_openai_gpt_version(model)
        if "-nano" in model and model.startswith("gpt-"):
            return "GPT nano", extract_openai_gpt_version(model)
        if "-mini" in model and model.startswith("gpt-"):
            return "GPT mini", extract_openai_gpt_version(model)
        if re.match(r"^o\d+-pro\b", model):
            return "Reasoning pro", extract_openai_o_version(model)
        if re.match(r"^o\d+-mini\b", model):
            return "Reasoning mini", extract_openai_o_version(model)
        if re.match(r"^o\d+\b", model):
            return "Reasoning", extract_openai_o_version(model)
        if model.startswith(("gpt-", "chatgpt-", "davinci-", "babbage-")):
            return "GPT flagship", extract_openai_gpt_version(model)
        return None

    return None


def keep_pricing_entry(
    model: str,
    info: dict[str, Any],
    provider_key: str,
    today: dt.date,
    include_specialized: bool = False,
    include_fine_tunes: bool = False,
    exclude_deprecated: bool = False,
) -> tuple[bool, bool, str]:
    if info.get("mode") not in ALLOWED_MODES:
        return False, False, ""
    if not accepts_text_input(info) or not has_text_output(info):
        return False, False, ""

    canonical = canonical_model(provider_key, model)
    if model.startswith("ft:") and not include_fine_tunes:
        return False, False, ""
    if model_name_has_term(canonical, NON_LLM_NAME_TERMS):
        return False, False, ""
    if not include_specialized and model_name_has_term(canonical, SPECIALIZED_NAME_TERMS):
        return False, False, ""

    deprecated, date = is_deprecated(info, today)
    if deprecated and exclude_deprecated:
        return False, deprecated, date
    return True, deprecated, date


def collect_groups(raw: dict[str, Any]) -> dict[tuple[str, str], dict[str, ModelGroup]]:
    today = dt.datetime.now(dt.timezone.utc).date()
    grouped: dict[tuple[str, str], dict[str, ModelGroup]] = {}

    for raw_model, info in raw.items():
        if not isinstance(info, dict):
            continue

        provider_key = provider_key_for(info)
        if provider_key is None:
            continue

        keep, deprecated, deprecation_date = keep_pricing_entry(raw_model, info, provider_key, today)
        if not keep:
            continue

        canonical = canonical_model(provider_key, raw_model)
        family_info = family_for(provider_key, canonical)
        if family_info is None:
            continue
        family, version = family_info

        input_price = per_million(info.get("input_cost_per_token"))
        output_price = per_million(info.get("output_cost_per_token"))
        if input_price is None or output_price is None:
            continue

        provider = PROVIDERS[provider_key]["display"]
        by_model = grouped.setdefault((provider, family), {})
        existing = by_model.get(canonical)
        if existing is None:
            by_model[canonical] = ModelGroup(
                provider=provider,
                family=family,
                canonical_model=canonical,
                input_price=input_price,
                output_price=output_price,
                version=version,
                aliases={raw_model},
                deprecated=deprecated,
                deprecation_dates={deprecation_date} if deprecation_date else set(),
            )
            continue

        existing.aliases.add(raw_model)
        existing.deprecated = existing.deprecated or deprecated
        if deprecation_date:
            existing.deprecation_dates.add(deprecation_date)

    return grouped


def model_sort_key(group: ModelGroup) -> tuple[Any, ...]:
    return (tuple(-part for part in group.version), group.canonical_model)


def build_audit(grouped: dict[tuple[str, str], dict[str, ModelGroup]]) -> list[AuditFamily]:
    audit: list[AuditFamily] = []
    for (provider, family), models in grouped.items():
        candidates = [group for group in models.values() if group.version and group.version[0] >= 0]
        if not candidates:
            continue

        current = max(candidates, key=lambda group: (group.version, -group.input_price, -group.output_price))
        ripoff: list[ModelGroup] = []
        obsolete: list[ModelGroup] = []

        for group in models.values():
            if group.canonical_model == current.canonical_model:
                continue
            if group.input_price > current.input_price or group.output_price > current.output_price:
                ripoff.append(group)
            else:
                obsolete.append(group)

        audit.append(
            AuditFamily(
                provider=provider,
                family=family,
                current=current,
                current_aliases=sorted(current.aliases),
                ripoff=sorted(ripoff, key=model_sort_key),
                obsolete=sorted(obsolete, key=model_sort_key),
            )
        )

    audit.sort(key=lambda item: (item.provider, item.family))
    return audit


def _price_obj(group: ModelGroup) -> dict[str, int | float]:
    return {
        "input_usd_per_1m_tokens": decimal_number(group.input_price),
        "output_usd_per_1m_tokens": decimal_number(group.output_price),
    }


def build_lookup_from_pricing(raw: dict[str, Any]) -> dict[str, Any]:
    lookup: dict[str, dict[str, Any]] = {}
    audit = build_audit(collect_groups(raw))
    for item in audit:
        for status, groups in (("current", [item.current]), ("ripoff", item.ripoff), ("obsolete", item.obsolete)):
            for group in groups:
                payload = {
                    "status": status,
                    "provider": item.provider,
                    "family": item.family,
                    "canonicalModel": group.canonical_model,
                    "currentModel": item.current.canonical_model,
                    "currentPrice": _price_obj(item.current),
                    "modelPrice": _price_obj(group),
                    "deprecated": group.deprecated,
                    "deprecationDates": sorted(group.deprecation_dates),
                }
                keys = {group.canonical_model, *group.aliases}
                for provider_key in PROVIDERS:
                    keys.add(canonical_model(provider_key, group.canonical_model))
                    for alias in group.aliases:
                        keys.add(canonical_model(provider_key, alias))
                for key in keys:
                    clean = normalize_candidate(key)
                    if clean:
                        lookup[clean] = payload
    return dict(sorted(lookup.items()))


def fetch_pricing_lookup(timeout: int = 20) -> dict[str, Any]:
    fetched_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    raw = fetch_pricing_json(timeout=timeout)
    return {
        "sourceUrl": LITELLM_PRICING_URL,
        "fetchedAt": fetched_at,
        "lookup": build_lookup_from_pricing(raw),
    }


def normalize_candidate(value: Any) -> str:
    text = str(value or "").strip().strip("'\"`")
    text = text.strip(" ,;()[]{}<>")
    text = text.replace("\\/", "/")
    if not text:
        return ""
    return text.lower()


def candidate_model_ids(value: Any) -> list[str]:
    raw = normalize_candidate(value)
    if not raw:
        return []

    candidates: list[str] = []

    def add(item: str) -> None:
        normalized = normalize_candidate(item)
        if normalized and normalized not in candidates:
            candidates.append(normalized)

    add(raw)

    for provider in ("openai/", "anthropic/", "gemini/"):
        if raw.startswith(provider):
            add(raw[len(provider) :])

    parts = [part for part in re.split(r"[:|]", raw) if part]
    if len(parts) >= 2:
        add(parts[-1])
        add(":".join(parts[2:]))

    slash_parts = [part for part in raw.split("/") if part]
    if len(slash_parts) >= 2:
        add(slash_parts[-1])

    for match in MODEL_TEXT_RE.findall(raw):
        add(match)

    return candidates


def classify_model_reference(value: Any, lookup: dict[str, Any]) -> dict[str, Any]:
    candidates = candidate_model_ids(value)
    for candidate in candidates:
        direct = lookup.get(candidate)
        if direct:
            return {
                "matched": True,
                "matchedCandidate": candidate,
                **direct,
            }
        for provider_key in PROVIDERS:
            canonical = canonical_model(provider_key, candidate)
            direct = lookup.get(canonical)
            if direct:
                return {
                    "matched": True,
                    "matchedCandidate": candidate,
                    **direct,
                }

    return {
        "matched": False,
        "matchedCandidate": candidates[0] if candidates else normalize_candidate(value),
        "status": "unknown",
        "provider": "",
        "family": "",
        "canonicalModel": candidates[0] if candidates else normalize_candidate(value),
        "currentModel": "",
        "currentPrice": None,
        "modelPrice": None,
        "unknownReason": "No matching OpenAI, Anthropic, or Gemini LiteLLM pricing entry",
    }


def looks_like_model_reference(value: Any) -> bool:
    return bool(candidate_model_ids(value))


def key_looks_model_related(key: Any) -> bool:
    text = str(key or "").replace("-", "_").lower()
    compact = text.replace("_", "")
    return text in MODEL_KEY_TERMS or compact in MODEL_KEY_TERMS or (
        "llm" in text and ("id" in text or "model" in text)
    )


def iter_structured_model_values(payload: Any, path: str = "$") -> Iterable[tuple[str, str]]:
    if isinstance(payload, dict):
        for key, value in payload.items():
            child_path = f"{path}.{key}"
            if key_looks_model_related(key):
                if isinstance(value, str) and looks_like_model_reference(value):
                    yield child_path, value
                elif isinstance(value, list):
                    for idx, item in enumerate(value):
                        if isinstance(item, str) and looks_like_model_reference(item):
                            yield f"{child_path}[{idx}]", item
            yield from iter_structured_model_values(value, child_path)
    elif isinstance(payload, list):
        for idx, item in enumerate(payload):
            yield from iter_structured_model_values(item, f"{path}[{idx}]")


def extract_model_strings_from_text(text: str, limit: int = 200) -> list[str]:
    seen: list[str] = []
    for match in MODEL_TEXT_RE.findall(text or ""):
        normalized = normalize_candidate(match)
        if normalized and normalized not in seen:
            seen.append(normalized)
        if len(seen) >= limit:
            break
    return seen
