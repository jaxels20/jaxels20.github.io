from __future__ import annotations

import re
from dataclasses import dataclass


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
        "INSERT 0 2",
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
        stripped = lines[i].strip()

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


def blocks_to_jsonable(blocks: list[Block]) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    for block in blocks:
        if isinstance(block, HeadingBlock):
            result.append({"type": "heading", "text": block.text})
        elif isinstance(block, ParagraphBlock):
            result.append({"type": "paragraph", "text": block.text})
        else:
            result.append(
                {
                    "type": "table",
                    "headers": block.headers,
                    "rows": block.rows,
                    "row_count": block.row_count,
                }
            )
    return result
