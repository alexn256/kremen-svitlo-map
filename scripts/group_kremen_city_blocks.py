"""
Групує рядки з kremen_filiya_raw.txt у цілісні адресні блоки (склеює
перенесені рядки одного запису) і залишає тільки блоки, де локація —
саме "м. Кременчук" (інші населені пункти філії — не цей проєкт).

Евристика розбиття на блоки: новий блок починається з рядка, де одразу
після тегу [cherga.pidcherga | ...] йде "м." або "с." — це завжди початок
нового логічного запису в цьому документі. Усі наступні рядки без такого
маркера — продовження того самого запису (перенесення в таблиці PDF).
"""
import re

SRC = "data/kremen_filiya_raw.txt"
OUT = "data/kremen_city_blocks.txt"

tag_locality_re = re.compile(r"^(\[[^\]]+\]) *((?:м|с)\.\s*\S.*)$")
tag_only_re = re.compile(r"^(\[[^\]]+\]) *(.*)$")

blocks = []
current_tag = None
current_text = []

def flush():
    if current_tag is not None and current_text:
        blocks.append((current_tag, " ".join(current_text)))

with open(SRC, encoding="utf-8") as f:
    for raw in f:
        line = raw.rstrip("\n")
        if not line.strip():
            continue
        m = tag_locality_re.match(line)
        if m:
            flush()
            current_tag = m.group(1)
            current_text = [m.group(2)]
            continue
        m2 = tag_only_re.match(line)
        if m2 and current_tag is not None:
            current_text.append(m2.group(2))
flush()

kremen_blocks = [
    (tag, text) for tag, text in blocks
    if re.match(r"^м\.?\s*Кременчук", text, re.IGNORECASE)
]

with open(OUT, "w", encoding="utf-8") as f:
    for tag, text in kremen_blocks:
        f.write(f"{tag} {text}\n\n")

print(f"total_blocks={len(blocks)}")
print(f"kremen_city_blocks={len(kremen_blocks)}")
print(f"output_chars={sum(len(t) for _, t in kremen_blocks)}")
