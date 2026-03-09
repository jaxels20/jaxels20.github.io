#!/usr/bin/env python3
"""Export SQL reports to polished, shareable PDF files.

Examples:
  python3 export_stats_report_pdf.py \
    --report player \
    --name "Anna Simonsen"

  python3 export_stats_report_pdf.py \
    --report team \
    --name "Viby J 2" \
    --output reports/viby_j_2_report.pdf

  python3 export_stats_report_pdf.py \
    --report team_h2h \
    --name "Vendsyssel 2" \
    --name-b "Christiansbjerg" \
    --season-id 2025 \
    --also-save-html
"""

from __future__ import annotations

import argparse
import html
import re
import shutil
import subprocess
import tempfile
import textwrap
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
SQL_DIR = ROOT_DIR / "sql"

REPORT_CONFIG = {
    "player": {
        "sql_file": SQL_DIR / "player_stats_report.sql",
        "sql_vars": ["player_name"],
    },
    "team": {
        "sql_file": SQL_DIR / "team_stats_report.sql",
        "sql_vars": ["team_name"],
    },
    "team_h2h": {
        "sql_file": SQL_DIR / "team_head_to_head_report.sql",
        "sql_vars": ["team_a", "team_b"],
    },
}

PSQL_FALLBACK_CANDIDATES = [
    "psql",
    "psql-18",
    "/opt/homebrew/bin/psql",
    "/opt/homebrew/bin/psql-18",
    "/usr/local/bin/psql",
]


@dataclass
class HeadingBlock:
    text: str


@dataclass
class ParagraphBlock:
    text: str


@dataclass
class TableBlock:
    headers: list[str]
    rows: list[list[str]]
    row_count: str | None


Block = HeadingBlock | ParagraphBlock | TableBlock


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run SQL stats report and export to polished PDF."
    )
    parser.add_argument(
        "--report",
        choices=sorted(REPORT_CONFIG.keys()),
        required=True,
        help="Report type: player, team, or team_h2h.",
    )
    parser.add_argument(
        "--name",
        required=True,
        help="Primary name. For team_h2h this is Team A.",
    )
    parser.add_argument(
        "--name-b",
        help="Secondary name. Required for team_h2h (Team B).",
    )
    parser.add_argument(
        "--output",
        help="Output PDF path. Default: reports/<report>_<name>_<timestamp>.pdf",
    )
    parser.add_argument(
        "--season-id",
        type=int,
        help="Optional season filter passed to SQL report (example: 2025).",
    )
    parser.add_argument(
        "--db",
        default="badminton_dw_individual",
        help="PostgreSQL database name (default: badminton_dw_individual).",
    )
    parser.add_argument(
        "--host",
        default="/tmp",
        help="PostgreSQL host/socket directory (default: /tmp).",
    )
    parser.add_argument(
        "--port",
        type=int,
        help="PostgreSQL port (optional).",
    )
    parser.add_argument(
        "--user",
        help="PostgreSQL user (optional).",
    )
    parser.add_argument(
        "--psql-bin",
        default="psql",
        help="psql executable path/name (default: psql; fallback also tries psql-18).",
    )
    parser.add_argument(
        "--also-save-txt",
        action="store_true",
        help="Also save the raw text report beside the PDF.",
    )
    parser.add_argument(
        "--also-save-html",
        action="store_true",
        help="Also save the rendered HTML source beside the PDF.",
    )
    return parser.parse_args()


def slugify(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", value.strip().lower()).strip("_")
    return cleaned or "report"


def resolve_psql_bin(psql_bin_arg: str) -> str:
    candidate = psql_bin_arg.strip()

    if candidate:
        found = shutil.which(candidate)
        if found:
            return found

        direct = Path(candidate).expanduser()
        if direct.exists() and direct.is_file():
            return str(direct.resolve())

    for fallback in PSQL_FALLBACK_CANDIDATES:
        found = shutil.which(fallback)
        if found:
            return found

        direct = Path(fallback)
        if direct.exists() and direct.is_file():
            return str(direct.resolve())

    raise RuntimeError(
        "Could not find psql executable. "
        "Install PostgreSQL client tools or pass --psql-bin with a full path "
        "(example: --psql-bin /opt/homebrew/bin/psql-18)."
    )


def run_report(args: argparse.Namespace) -> str:
    cfg = REPORT_CONFIG[args.report]
    sql_file = Path(cfg["sql_file"])
    sql_vars = list(cfg["sql_vars"])

    if not sql_file.exists():
        raise FileNotFoundError(f"Missing SQL report file: {sql_file}")

    if args.report == "team_h2h" and not args.name_b:
        raise ValueError("team_h2h requires --name-b (Team B).")

    if len(sql_vars) == 1:
        var_assignments = [f"{sql_vars[0]}={args.name}"]
    elif args.report == "team_h2h":
        var_assignments = [f"team_a={args.name}", f"team_b={args.name_b}"]
    else:
        raise ValueError(
            f"Unsupported sql var configuration for report type: {args.report}"
        )

    psql_bin = resolve_psql_bin(args.psql_bin)

    command: list[str] = [psql_bin]
    if args.host:
        command.extend(["-h", args.host])
    if args.port:
        command.extend(["-p", str(args.port)])
    if args.user:
        command.extend(["-U", args.user])

    command.extend(["-d", args.db])
    for assignment in var_assignments:
        command.extend(["--set", assignment])
    if args.season_id is not None:
        command.extend(["--set", f"season_id={args.season_id}"])
    command.extend(["-f", str(sql_file)])

    completed = subprocess.run(
        command,
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
        check=False,
    )

    if completed.returncode != 0:
        stderr = completed.stderr.strip()
        stdout = completed.stdout.strip()
        details = stderr or stdout or "Unknown psql error"
        raise RuntimeError(f"psql failed (exit {completed.returncode}): {details}")

    return completed.stdout


def get_report_label(report: str) -> str:
    if report == "team_h2h":
        return "Team Head-to-Head"
    return report.replace("_", " ").title()


def get_subject_display_name(args: argparse.Namespace) -> str:
    if args.report == "team_h2h":
        return f"{args.name} vs {args.name_b}"
    return args.name


def is_noise_line(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False

    if stripped.startswith("Border style is"):
        return True
    if stripped.startswith("Line style is"):
        return True
    if stripped.startswith("Null display is"):
        return True
    if stripped.startswith("Pager usage is"):
        return True
    if stripped in {
        "SET",
        "DROP VIEW",
        "CREATE VIEW",
        "DROP TABLE",
        "CREATE TABLE",
        "DROP INDEX",
        "CREATE INDEX",
    }:
        return True
    if stripped.startswith("psql-") and "NOTICE:" in stripped:
        return True

    return False


def clean_report_lines(report_text: str) -> list[str]:
    cleaned = [
        line.rstrip() for line in report_text.splitlines() if not is_noise_line(line)
    ]

    while cleaned and cleaned[0].strip() == "":
        cleaned.pop(0)
    while cleaned and cleaned[-1].strip() == "":
        cleaned.pop()

    return cleaned


def is_table_border_line(line: str) -> bool:
    return bool(re.match(r"^\+-[-+]+\+$", line.strip()))


def split_table_row(row_line: str) -> list[str]:
    row = row_line.strip()
    if not (row.startswith("|") and row.endswith("|")):
        return []
    return [cell.strip() for cell in row[1:-1].split("|")]


def parse_table_block(
    lines: list[str], start_idx: int
) -> tuple[TableBlock | None, int]:
    if start_idx + 2 >= len(lines):
        return None, start_idx

    if not is_table_border_line(lines[start_idx]):
        return None, start_idx
    if not lines[start_idx + 1].strip().startswith("|"):
        return None, start_idx
    if not is_table_border_line(lines[start_idx + 2]):
        return None, start_idx

    headers = split_table_row(lines[start_idx + 1])
    rows: list[list[str]] = []

    i = start_idx + 3
    while i < len(lines) and lines[i].strip().startswith("|"):
        rows.append(split_table_row(lines[i]))
        i += 1

    if i < len(lines) and is_table_border_line(lines[i]):
        i += 1

    row_count = None
    if i < len(lines) and re.match(r"^\(\d+ rows?\)$", lines[i].strip()):
        row_count = lines[i].strip()
        i += 1

    return TableBlock(headers=headers, rows=rows, row_count=row_count), i


def next_non_empty_idx(lines: list[str], start_idx: int) -> int | None:
    i = start_idx
    while i < len(lines):
        if lines[i].strip() != "":
            return i
        i += 1
    return None


def extract_title(lines: list[str], fallback: str) -> tuple[str, list[str]]:
    title = fallback
    working = list(lines)

    for i in range(0, len(working) - 2):
        a = working[i].strip()
        b = working[i + 1].strip()
        c = working[i + 2].strip()
        if a and c and set(a) == {"="} and set(c) == {"="} and b:
            title = b
            del working[i : i + 3]
            break

    while working and working[0].strip() == "":
        working.pop(0)

    return title, working


def parse_blocks(lines: list[str]) -> list[Block]:
    blocks: list[Block] = []
    i = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped == "":
            i += 1
            continue

        table, next_idx = parse_table_block(lines, i)
        if table is not None:
            blocks.append(table)
            i = next_idx
            continue

        nxt = next_non_empty_idx(lines, i + 1)
        if nxt is not None and is_table_border_line(lines[nxt]):
            blocks.append(HeadingBlock(text=stripped))
        else:
            blocks.append(ParagraphBlock(text=stripped))

        i += 1

    return blocks


def is_numeric_value(value: str) -> bool:
    v = value.strip()
    if v in {"", "-"}:
        return False
    return bool(re.fullmatch(r"-?\d+(?:\.\d+)?", v))


def get_numeric_columns(table: TableBlock) -> set[int]:
    if not table.rows:
        return set()

    max_cols = max(len(table.headers), max(len(r) for r in table.rows))
    numeric_cols: set[int] = set()

    for col_idx in range(max_cols):
        seen = 0
        numeric = 0
        for row in table.rows:
            val = row[col_idx] if col_idx < len(row) else ""
            if val.strip() in {"", "-"}:
                continue
            seen += 1
            if is_numeric_value(val):
                numeric += 1
        if seen > 0 and numeric == seen:
            numeric_cols.add(col_idx)

    return numeric_cols


def normalize_table_shape(table: TableBlock) -> TableBlock:
    max_cols = max(len(table.headers), max((len(r) for r in table.rows), default=0))
    headers = list(table.headers)
    while len(headers) < max_cols:
        headers.append(f"col_{len(headers) + 1}")

    rows: list[list[str]] = []
    for row in table.rows:
        padded = list(row)
        while len(padded) < max_cols:
            padded.append("")
        rows.append(padded)

    return TableBlock(headers=headers, rows=rows, row_count=table.row_count)


def render_table_html(table: TableBlock) -> str:
    normalized = normalize_table_shape(table)
    numeric_cols = get_numeric_columns(normalized)

    parts: list[str] = []
    parts.append('<div class="table-card">')
    parts.append("<table>")
    parts.append("<thead><tr>")

    for idx, header in enumerate(normalized.headers):
        cls = "num" if idx in numeric_cols else ""
        parts.append(f'<th class="{cls}">{html.escape(header)}</th>')

    parts.append("</tr></thead>")
    parts.append("<tbody>")

    for row in normalized.rows:
        parts.append("<tr>")
        for idx, cell in enumerate(row):
            cls = "num" if idx in numeric_cols else ""
            parts.append(f'<td class="{cls}">{html.escape(cell)}</td>')
        parts.append("</tr>")

    parts.append("</tbody>")
    parts.append("</table>")

    if normalized.row_count:
        parts.append(f'<div class="rowcount">{html.escape(normalized.row_count)}</div>')

    parts.append("</div>")
    return "\n".join(parts)


def build_html_document(
    *,
    report_title: str,
    report_type_label: str,
    subject_name: str,
    season_id: int | None,
    db_name: str,
    generated_at: datetime,
    blocks: list[Block],
) -> str:
    css = """
    :root {
      --ink: #102542;
      --muted: #5f6c7b;
      --line: #dce4ee;
      --card: #ffffff;
      --bg-soft: #f6f9fc;
      --accent: #1f4e79;
      --accent-soft: #eaf2fa;
      --stripe: #fafcff;
    }

    @page {
      size: A4 landscape;
      margin: 12mm;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      color: var(--ink);
      font-family: "Aptos", "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: 10pt;
      background: white;
    }

    .report {
      width: 100%;
    }

    .report-header {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: linear-gradient(180deg, #ffffff 0%, var(--bg-soft) 100%);
      padding: 14px 16px;
      margin-bottom: 12px;
      page-break-inside: avoid;
    }

    .report-title {
      margin: 0 0 8px 0;
      font-size: 19pt;
      line-height: 1.2;
      color: #0f3558;
      letter-spacing: 0.2px;
    }

    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px 20px;
      font-size: 9.3pt;
    }

    .meta-label {
      color: var(--muted);
      font-weight: 600;
      margin-right: 6px;
    }

    h2 {
      margin: 14px 0 6px;
      padding-bottom: 4px;
      border-bottom: 1px solid var(--line);
      color: var(--accent);
      font-size: 13pt;
      letter-spacing: 0.1px;
      page-break-after: avoid;
    }

    p.note {
      margin: 6px 0;
      color: var(--ink);
      font-size: 10pt;
    }

    .table-card {
      border: 1px solid var(--line);
      border-radius: 10px;
      overflow: hidden;
      margin: 6px 0 10px;
      background: var(--card);
      page-break-inside: avoid;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 8.8pt;
    }

    thead {
      display: table-header-group;
    }

    thead th {
      background: var(--accent);
      color: #ffffff;
      text-align: left;
      font-weight: 700;
      padding: 6px 7px;
      border-right: 1px solid rgba(255, 255, 255, 0.20);
      line-height: 1.25;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    thead th:last-child {
      border-right: none;
    }

    tbody td {
      border-top: 1px solid #e8eef5;
      padding: 5px 7px;
      vertical-align: top;
      line-height: 1.3;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    tbody tr:nth-child(even) td {
      background: var(--stripe);
    }

    td.num,
    th.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .rowcount {
      border-top: 1px solid var(--line);
      background: var(--accent-soft);
      color: #38526e;
      font-size: 8.2pt;
      text-align: right;
      padding: 5px 8px;
      font-weight: 600;
    }

    tr {
      page-break-inside: avoid;
      break-inside: avoid;
    }
    """

    parts: list[str] = []
    parts.append("<!doctype html>")
    parts.append('<html lang="en">')
    parts.append("<head>")
    parts.append('<meta charset="utf-8">')
    parts.append('<meta name="viewport" content="width=device-width, initial-scale=1">')
    parts.append(f"<title>{html.escape(report_title)}</title>")
    parts.append(f"<style>{css}</style>")
    parts.append("</head>")
    parts.append("<body>")
    parts.append('<main class="report">')
    parts.append('<header class="report-header">')
    parts.append(f'<h1 class="report-title">{html.escape(report_title)}</h1>')
    parts.append('<div class="meta-grid">')
    parts.append(
        f'<div><span class="meta-label">Report Type:</span>{html.escape(report_type_label)}</div>'
    )
    parts.append(
        f'<div><span class="meta-label">Name:</span>{html.escape(subject_name)}</div>'
    )
    parts.append(
        f'<div><span class="meta-label">Season Filter:</span>{html.escape(str(season_id) if season_id is not None else "All")}</div>'
    )
    parts.append(
        f'<div><span class="meta-label">Database:</span>{html.escape(db_name)}</div>'
    )
    parts.append(
        f'<div><span class="meta-label">Generated:</span>{generated_at.strftime("%Y-%m-%d %H:%M:%S")}</div>'
    )
    parts.append("</div>")
    parts.append("</header>")

    for block in blocks:
        if isinstance(block, HeadingBlock):
            parts.append(f"<h2>{html.escape(block.text)}</h2>")
        elif isinstance(block, ParagraphBlock):
            parts.append(f'<p class="note">{html.escape(block.text)}</p>')
        else:
            parts.append(render_table_html(block))

    parts.append("</main>")
    parts.append("</body>")
    parts.append("</html>")
    return "\n".join(parts)


def render_pdf_with_playwright_in_process(
    html_file: Path, output_pdf: Path
) -> tuple[bool, str | None]:
    try:
        from playwright.sync_api import sync_playwright  # type: ignore
    except Exception as exc:  # noqa: BLE001
        return False, f"playwright import failed: {exc}"

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(html_file.resolve().as_uri(), wait_until="networkidle")
            page.pdf(
                path=str(output_pdf),
                format="A4",
                landscape=True,
                print_background=True,
                prefer_css_page_size=True,
            )
            browser.close()
        return True, None
    except Exception as exc:  # noqa: BLE001
        return False, f"playwright rendering failed: {exc}"


def render_pdf_with_venv_playwright(
    html_file: Path, output_pdf: Path
) -> tuple[bool, str | None]:
    venv_python = ROOT_DIR / ".venv" / "bin" / "python"
    if not venv_python.exists():
        return False, "no local .venv python found for playwright fallback"

    inline_script = textwrap.dedent(
        """
        import pathlib
        import sys
        from playwright.sync_api import sync_playwright

        html_path = pathlib.Path(sys.argv[1]).resolve()
        pdf_path = pathlib.Path(sys.argv[2]).resolve()

        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(html_path.as_uri(), wait_until='networkidle')
            page.pdf(
                path=str(pdf_path),
                format='A4',
                landscape=True,
                print_background=True,
                prefer_css_page_size=True,
            )
            browser.close()
        """
    ).strip()

    completed = subprocess.run(
        [str(venv_python), "-c", inline_script, str(html_file), str(output_pdf)],
        cwd=str(ROOT_DIR),
        capture_output=True,
        text=True,
        check=False,
    )

    if completed.returncode == 0:
        return True, None

    details = completed.stderr.strip() or completed.stdout.strip() or "unknown error"
    return False, f"venv playwright rendering failed: {details}"


def pdf_escape_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def wrap_lines(text: str, max_chars: int) -> list[str]:
    lines: list[str] = []
    for raw in text.splitlines():
        if not raw:
            lines.append("")
            continue

        wrapped = textwrap.wrap(
            raw,
            width=max_chars,
            replace_whitespace=False,
            drop_whitespace=False,
            break_long_words=True,
            break_on_hyphens=False,
        )
        lines.extend(wrapped or [""])

    return lines


def paginate(lines: list[str], lines_per_page: int) -> list[list[str]]:
    if not lines:
        return [["(empty report)"]]
    return [lines[i : i + lines_per_page] for i in range(0, len(lines), lines_per_page)]


def build_plain_text_pdf_bytes(text: str) -> bytes:
    page_width = 595
    page_height = 842
    margin = 36
    font_size = 8.8
    line_height = 11.0

    usable_width = page_width - (2 * margin)
    max_chars = max(40, int(usable_width / (font_size * 0.6)))
    lines_per_page = max(20, int((page_height - (2 * margin)) / line_height))

    wrapped_lines = wrap_lines(text, max_chars=max_chars)
    pages = paginate(wrapped_lines, lines_per_page=lines_per_page)

    objects: list[bytes] = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(b"<< /Type /Pages /Kids [] /Count 0 >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")

    page_object_ids: list[int] = []

    for page_lines in pages:
        stream_lines = [
            b"BT",
            f"/F1 {font_size:.2f} Tf".encode("ascii"),
            f"{line_height:.2f} TL".encode("ascii"),
            f"{margin} {page_height - margin - font_size:.2f} Td".encode("ascii"),
        ]

        for idx, line in enumerate(page_lines):
            if idx > 0:
                stream_lines.append(b"T*")
            escaped = pdf_escape_text(line)
            stream_lines.append(f"({escaped}) Tj".encode("latin-1", errors="replace"))

        stream_lines.append(b"ET")
        stream_data = b"\n".join(stream_lines)

        content_obj_id = len(objects) + 1
        page_obj_id = len(objects) + 2

        content_obj = (
            b"<< /Length "
            + str(len(stream_data)).encode("ascii")
            + b" >>\nstream\n"
            + stream_data
            + b"\nendstream"
        )
        page_obj = (
            b"<< /Type /Page /Parent 2 0 R "
            + f"/MediaBox [0 0 {page_width} {page_height}] ".encode("ascii")
            + b"/Resources << /Font << /F1 3 0 R >> >> "
            + f"/Contents {content_obj_id} 0 R >>".encode("ascii")
        )

        objects.append(content_obj)
        objects.append(page_obj)
        page_object_ids.append(page_obj_id)

    kids = " ".join(f"{obj_id} 0 R" for obj_id in page_object_ids)
    objects[1] = (
        f"<< /Type /Pages /Kids [{kids}] /Count {len(page_object_ids)} >>".encode(
            "ascii"
        )
    )

    buffer = bytearray()
    buffer.extend(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")

    offsets = [0]
    for idx, obj in enumerate(objects, start=1):
        offsets.append(len(buffer))
        buffer.extend(f"{idx} 0 obj\n".encode("ascii"))
        buffer.extend(obj)
        buffer.extend(b"\nendobj\n")

    xref_start = len(buffer)
    buffer.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    buffer.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        buffer.extend(f"{off:010d} 00000 n \n".encode("ascii"))

    buffer.extend(
        (
            "trailer\n"
            f"<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            "startxref\n"
            f"{xref_start}\n"
            "%%EOF\n"
        ).encode("ascii")
    )

    return bytes(buffer)


def resolve_output_path(args: argparse.Namespace) -> Path:
    if args.output:
        return Path(args.output).expanduser().resolve()

    output_dir = ROOT_DIR / "reports"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    if args.report == "team_h2h" and args.name_b:
        name_slug = f"{slugify(args.name)}_vs_{slugify(args.name_b)}"
    else:
        name_slug = slugify(args.name)
    filename = f"{args.report}_{name_slug}_{timestamp}.pdf"
    return (output_dir / filename).resolve()


def main() -> int:
    args = parse_args()

    try:
        report_text = run_report(args)
    except Exception as exc:  # noqa: BLE001
        print(f"Error while running report: {exc}")
        return 1

    output_pdf = resolve_output_path(args)
    output_pdf.parent.mkdir(parents=True, exist_ok=True)

    cleaned_lines = clean_report_lines(report_text)
    if args.report == "team_h2h":
        default_title = "Team Head-to-Head Comparison Report"
    else:
        default_title = f"{args.report.title()} Stats Report"
    report_title, titleless_lines = extract_title(cleaned_lines, fallback=default_title)
    blocks = parse_blocks(titleless_lines)
    generated_at = datetime.now()

    html_document = build_html_document(
        report_title=report_title,
        report_type_label=get_report_label(args.report),
        subject_name=get_subject_display_name(args),
        season_id=args.season_id,
        db_name=args.db,
        generated_at=generated_at,
        blocks=blocks,
    )

    html_path_for_pdf: Path | None = None
    saved_html_path: Path | None = None

    if args.also_save_html:
        saved_html_path = output_pdf.with_suffix(".html")
        saved_html_path.write_text(html_document, encoding="utf-8")
        html_path_for_pdf = saved_html_path
    else:
        tmp = tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".html",
            prefix="stats_report_",
            delete=False,
            encoding="utf-8",
            dir=str(output_pdf.parent),
        )
        with tmp:
            tmp.write(html_document)
        html_path_for_pdf = Path(tmp.name)

    ok, err = render_pdf_with_playwright_in_process(html_path_for_pdf, output_pdf)
    if not ok:
        ok, err2 = render_pdf_with_venv_playwright(html_path_for_pdf, output_pdf)
        if not ok:
            fallback_pdf = build_plain_text_pdf_bytes(report_text)
            output_pdf.write_bytes(fallback_pdf)
            print("Warning: Could not render polished HTML PDF with Playwright.")
            print(f"Warning details: {err2 or err or 'unknown error'}")
            print("Generated fallback plain-text PDF instead.")

    if not args.also_save_html and html_path_for_pdf and html_path_for_pdf.exists():
        html_path_for_pdf.unlink(missing_ok=True)

    print(f"Saved PDF report: {output_pdf}")

    if args.also_save_txt:
        output_txt = output_pdf.with_suffix(".txt")
        output_txt.write_text(report_text, encoding="utf-8")
        print(f"Saved text report: {output_txt}")

    if saved_html_path is not None:
        print(f"Saved HTML report: {saved_html_path}")

    print("You can now send the PDF file to others (email, chat, cloud drive, etc.).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
