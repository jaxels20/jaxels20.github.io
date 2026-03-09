#!/usr/bin/env python3
"""Fetch BadmintonPlayer team match data via the same WebService endpoint as the site.

Example:
  python fetch_match_via_api.py \
    --url "https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/#5,2025,17917,1,1,,485505,-3,"
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen

DEFAULT_URL = "https://www.badmintonplayer.dk/DBF/HoldTurnering/Stilling/#5,2025,17917,1,1,,485505,-3,"
SERVICE_PATH = "/SportsResults/Components/WebService1.asmx/GetLeagueStanding"
CALLBACK_RE = re.compile(r"SR_CallbackContext\s*=\s*'([^']+)'")

HASH_FIELDS = [
    "subPage",
    "seasonID",
    "leagueGroupID",
    "ageGroupID",
    "regionID",
    "leagueGroupTeamID",
    "leagueMatchID",
    "clubID",
    "playerID",
]


def get_base_page_url(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


def parse_hash_payload(url: str) -> dict[str, Any]:
    fragment = urlsplit(url).fragment
    if not fragment:
        raise ValueError("URL is missing hash parameters. Expected e.g. #5,2025,17917,1,1,,485505,-3,")

    parts = [part.strip() for part in fragment.split(",")]
    while len(parts) < len(HASH_FIELDS):
        parts.append("")
    parts = parts[: len(HASH_FIELDS)]

    payload: dict[str, Any] = {}
    for field, raw in zip(HASH_FIELDS, parts):
        if raw == "":
            payload[field] = None
        elif raw.lstrip("-").isdigit():
            payload[field] = int(raw)
        else:
            payload[field] = raw

    return payload


def http_get_text(url: str, timeout: int) -> str:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; badminton-api-script/1.0)",
        },
    )
    with urlopen(request, timeout=timeout) as response:  # noqa: S310 - URL is user provided CLI input.
        return response.read().decode("utf-8", errors="replace")


def http_post_json(url: str, payload: dict[str, Any], timeout: int) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "Mozilla/5.0 (compatible; badminton-api-script/1.0)",
        },
    )
    with urlopen(request, timeout=timeout) as response:  # noqa: S310 - URL is derived from user input.
        raw = response.read().decode("utf-8", errors="replace")

    return json.loads(raw)


def extract_callback_context(page_html: str) -> str:
    match = CALLBACK_RE.search(page_html)
    if not match:
        raise ValueError("Could not find SR_CallbackContext in page HTML.")
    return match.group(1)


def write_text(path: str | None, text: str) -> None:
    if not path:
        return
    target = Path(path)
    target.write_text(text, encoding="utf-8")


def build_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Call BadmintonPlayer GetLeagueStanding with hash parameters from a Stilling URL.",
    )
    parser.add_argument("--url", default=DEFAULT_URL, help="Stilling URL containing a hash like #5,2025,...")
    parser.add_argument(
        "--timeout",
        type=int,
        default=30,
        help="Network timeout in seconds (default: 30).",
    )
    parser.add_argument(
        "--print-json",
        action="store_true",
        help="Print the full JSON response instead of decoded HTML.",
    )
    parser.add_argument(
        "--output-html",
        help="Optional path to save decoded HTML (d.html).",
    )
    parser.add_argument(
        "--output-json",
        help="Optional path to save the full JSON response.",
    )
    return parser


def main() -> int:
    parser = build_argument_parser()
    args = parser.parse_args()

    try:
        payload = parse_hash_payload(args.url)
        base_page_url = get_base_page_url(args.url)
        page_html = http_get_text(base_page_url, timeout=args.timeout)
        callback_context = extract_callback_context(page_html)

        service_url = urljoin(base_page_url, SERVICE_PATH)
        request_payload = {"callbackcontextkey": callback_context, **payload}
        response_json = http_post_json(service_url, request_payload, timeout=args.timeout)
    except Exception as exc:  # noqa: BLE001 - CLI script should fail with clear message.
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    if "d" not in response_json:
        print("Unexpected response shape (missing 'd').", file=sys.stderr)
        if "Message" in response_json:
            print(f"Server message: {response_json['Message']}", file=sys.stderr)
        return 1

    response_html = str(response_json["d"].get("html", ""))
    decoded_html = html.unescape(response_html)
    pretty_json = json.dumps(response_json, ensure_ascii=False, indent=2)

    write_text(args.output_json, pretty_json)
    write_text(args.output_html, decoded_html)

    if args.print_json:
        print(pretty_json)
    else:
        print(decoded_html)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
