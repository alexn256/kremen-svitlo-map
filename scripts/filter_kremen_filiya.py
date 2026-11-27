import os
import re
import subprocess
import sys

PDF = os.path.join(os.path.dirname(__file__), "..", "public", "HPV_26_27-sajt.pdf")

text = subprocess.run(
    ["pdftotext", "-layout", PDF, "-"], capture_output=True, text=True, check=True
).stdout

CHERGA_WORDS = {
    "Перша": 1, "Друга": 2, "Третя": 3,
    "Четверта": 4, "П'ята": 5, "Пята": 5, "Шоста": 6,
}

cherga_re = re.compile(
    r"^\s*(Перша|Друга|Третя|Четверта|П['’]?ята|Шоста)\s+черга(?:\s+([IІi]+)\s+підчерга)?\s*$"
)
# \w*-закінчення, щоб ловити і називний ("об'єднана філія"), і родовий відмінок
# ("об'єднаної філії") — другий трапляється в заголовках районів/дільниць
# ("Гадяцька дільниця Миргородської об'єднаної філії"), і його пропуск раніше
# залишав "хвіст" чужого філіалу приклеєним до кременчуцького блоку.
other_filiya_re = re.compile(
    r"(Полтавськ|Лубенськ|Миргородськ)\w*\s+об['’]?єднан\w*\s+філі\w*"
)
kremen_main_re = re.compile(r"Кременчуц\w*\s+об['’]?єднан\w*\s+філі\w*")
kremen_district_re = re.compile(r"(\S.*?)\s+дільниц\w*\s+Кременчуц\w*\s+об['’]?єднан\w*\s+філі\w*")

def norm_roman(tok):
    tok = tok.replace("I", "I").replace("і", "I").replace("І", "I")
    return len(tok)  # "I" -> 1, "II" -> 2

cherga = None
pidcherga = None
filiya = "UNKNOWN"
district = ""
out_lines = []
stats = {"kremen_lines": 0, "pages_seen": set()}

page = 1
for raw in text.split("\n"):
    line = raw.rstrip()
    stripped = line.strip()

    if "\x0c" in raw:
        page += 1

    m = cherga_re.match(stripped)
    if m:
        cherga = CHERGA_WORDS.get(m.group(1).replace("’", "'"), cherga)
        if m.group(2):
            pidcherga = norm_roman(m.group(2))
        else:
            pidcherga = None
        # Нова черга/підчерга завжди починається заново зі свого філія-банера
        # (Полтавська/Кременчуцька/...) — не тягнемо стан з попередньої секції.
        filiya = "UNKNOWN"
        district = ""
        continue

    if other_filiya_re.search(stripped):
        filiya = "OTHER"
        district = ""
        continue

    if kremen_main_re.search(stripped):
        filiya = "KREMEN"
        district = ""
        continue

    dm = kremen_district_re.search(stripped)
    if dm:
        filiya = "KREMEN"
        district = dm.group(1).strip(" .,:;-")
        continue

    if not stripped:
        continue

    # Пропускаємо рядки-номери сторінок типу самотньої цифри внизу.
    if stripped.isdigit() and len(stripped) <= 3:
        continue

    if filiya == "KREMEN" and cherga is not None:
        tag = f"[{cherga}.{pidcherga if pidcherga else '?'}{' | ' + district if district else ''}]"
        out_lines.append(f"{tag} {stripped}")
        stats["kremen_lines"] += 1
        stats["pages_seen"].add(page)

out_path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/kremen_filtered.txt"
with open(out_path, "w", encoding="utf-8") as f:
    f.write("\n".join(out_lines) + "\n")

print(f"kremen_lines={stats['kremen_lines']}")
print(f"approx_pages_touched={len(stats['pages_seen'])}")
print(f"output_chars={sum(len(l) for l in out_lines)}")
print(f"written_to={out_path}")
