from __future__ import annotations

from datetime import date, datetime
from typing import Any


class ValidationError(ValueError):
    def __init__(self, message: str, field: str | None = None, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.field = field
        self.status_code = status_code


def iso_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat(sep=" ")


def row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row) if row is not None else {}


def rows_to_dicts(rows: list[Any]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def require_object(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("Request body must be a JSON object.")
    return payload


def get_required_string(
    payload: dict[str, Any],
    field: str,
    *,
    max_length: int = 255,
) -> str:
    value = payload.get(field)
    if not isinstance(value, str):
        raise ValidationError(f"{field.replace('_', ' ').title()} is required.", field)

    clean_value = value.strip()
    if not clean_value:
        raise ValidationError(f"{field.replace('_', ' ').title()} is required.", field)
    if len(clean_value) > max_length:
        raise ValidationError(f"{field.replace('_', ' ').title()} must be at most {max_length} characters.", field)
    return clean_value


def get_optional_string(
    payload: dict[str, Any],
    field: str,
    *,
    max_length: int = 2000,
    default: str | None = None,
) -> str | None:
    value = payload.get(field, default)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{field.replace('_', ' ').title()} must be a string.", field)

    clean_value = value.strip()
    if len(clean_value) > max_length:
        raise ValidationError(f"{field.replace('_', ' ').title()} must be at most {max_length} characters.", field)
    return clean_value


def get_optional_int(
    payload: dict[str, Any],
    field: str,
    *,
    default: int | None = None,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int | None:
    value = payload.get(field, default)
    if value is None or value == "":
        return default

    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"{field.replace('_', ' ').title()} must be a whole number.", field) from exc

    if minimum is not None and parsed < minimum:
        raise ValidationError(f"{field.replace('_', ' ').title()} must be at least {minimum}.", field)
    if maximum is not None and parsed > maximum:
        raise ValidationError(f"{field.replace('_', ' ').title()} must be at most {maximum}.", field)
    return parsed


def get_optional_choice(
    payload: dict[str, Any],
    field: str,
    *,
    allowed: set[str],
    default: str | None = None,
) -> str | None:
    value = payload.get(field, default)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{field.replace('_', ' ').title()} must be a string.", field)

    clean_value = value.strip()
    if clean_value not in allowed:
        allowed_values = ", ".join(sorted(allowed))
        raise ValidationError(f"{field.replace('_', ' ').title()} must be one of: {allowed_values}.", field)
    return clean_value


def get_optional_bool(
    payload: dict[str, Any],
    field: str,
    *,
    default: bool | None = None,
) -> bool | None:
    value = payload.get(field, default)
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    raise ValidationError(f"{field.replace('_', ' ').title()} must be true or false.", field)


def get_optional_date(payload: dict[str, Any], field: str) -> str | None:
    value = payload.get(field)
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{field.replace('_', ' ').title()} must be a date string.", field)

    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise ValidationError(f"{field.replace('_', ' ').title()} must use YYYY-MM-DD format.", field) from exc
    return parsed.isoformat()


def get_optional_datetime(payload: dict[str, Any], field: str) -> str | None:
    value = payload.get(field)
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{field.replace('_', ' ').title()} must be a datetime string.", field)

    parsed = parse_datetime(value)
    if parsed is None:
        raise ValidationError(
            f"{field.replace('_', ' ').title()} must use YYYY-MM-DDTHH:MM format.",
            field,
        )
    return parsed.replace(second=0, microsecond=0).isoformat(sep=" ")


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None

    normalized = value.replace("Z", "+00:00")
    for parser in (datetime.fromisoformat,):
        try:
            return parser(normalized)
        except ValueError:
            continue

    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return None
