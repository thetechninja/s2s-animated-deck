"""Classify a sermon source document into semantic slide elements.

This is a SELF-CONTAINED reimplementation of the scene-based classification
heuristics used by the main `sermon2slides` pipeline (see that project's
deck.py), so this animated-deck repo never imports from the sermon-generation
repo. It reads the SAME source the .pro generator does (docx or markdown) and
yields the semantic "story beats" that drive meaningful animation.

Document model (mirrors the .pro pipeline):
  - A *scene* is a blank-line-separated group of lines.
  - Each scene is classified line-by-line into an ordered list of ELEMENTS:
      verse   = a line starting with a verse number, or a passage paragraph that
                is immediately followed by a reference line
      reference = "Book Chapter[:Verses] [TRANSLATION]" (KJV if absent)
      bullet  = a "*- " commentary bullet
      heading = a "Lifework Assignment:" / "Expected Behavior:" section heading
      note    = any other prose
  - A reference line applies to pending verses (written after them) or can lead
    a run (whole-chapter style, e.g. "John 17 (AMPC)").
  - A "term: definition" within a note is split out so the player can highlight
    the term.

For the animated deck, one scene becomes a chain of build-up slides exactly
like the .pro scene builder does: slide k shows the scene's first k elements,
and the LAST slide is the "complete" one (photo-worthy). The animated deck
naturally uses this build-up to *animate elements in one-by-one*.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

# ---- classifier regexes (mirror the generation repo's deck.py heuristics) ----

_REF_TAIL = r"(\(?[A-Z]{2,8}\)?)?\s*\.?"
REF_RE = re.compile(r"^(.+?)\s+(\d{1,3})(?::([0-9,\-]+))?\s*" + _REF_TAIL + r"$", re.I)
VERSE_START_RE = re.compile(r"^(\d{1,3})(\s|\.|\)|-)")
TERM_RE = re.compile(r"^\s*([A-Za-z][A-Za-z\s'’-]{0,40}?):\s(.{1,240})$", re.S)

_RTL = "\u200f\u202b\u202e\u202c"


def _clean(text: str) -> str:
    for ch in _RTL:
        text = text.replace(ch, "")
    text = text.replace("\u200b", "").replace("\ufeff", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_ref(text: str) -> str:
    cleaned = _clean(text)
    m = REF_RE.match(cleaned)
    if not m:
        return cleaned
    book, ch, verses, trans = m.groups()
    trans = (trans or "KJV").strip("()")
    body = f"{book} {ch}" + (f":{verses}" if verses else "")
    return f"{body} ({trans})"


def is_reference(text: str) -> bool:
    return bool(REF_RE.match(_clean(text)))


def is_verse(text: str) -> bool:
    return bool(VERSE_START_RE.match(text))


def is_bullet(text: str) -> bool:
    return text.lstrip().startswith("*-")


def is_heading(text: str) -> Optional[str]:
    low = _clean(text).lower()
    for name in ("lifework assignment", "expected behavior"):
        if low == name or low.startswith(name + ":"):
            return name
    return None


def split_definition(line: str) -> Optional[Tuple[str, str]]:
    """Return (term, body) if line is a 'term: definition', else None."""
    if ":" not in line:
        return None
    m = TERM_RE.match(line.strip())
    if not m:
        return None
    term, body = m.group(1).strip(), m.group(2).strip()
    if len(term) > 6 and len(body) < 3:
        return None
    if len(term.split()) > 4:
        return None
    return term, body


def strip_verse_number(text: str) -> str:
    m = VERSE_START_RE.match(text)
    if not m:
        return text
    return text[m.end():].lstrip()


# ---- element model -------------------------------------------------------------

@dataclass
class Elem:
    kind: str            # "verse" | "note" | "bullet" | "heading"
    text: str
    ref: str = ""
    term: str = ""       # for a definition note: the highlighted term
    label: str = ""      # heading label (Lifework Assignment / Expected Behavior)


@dataclass
class Scene:
    elems: List[Elem] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not self.elems


# ---- parsing --------------------------------------------------------------------

def scenes_from_text(text: str) -> List[List[str]]:
    scenes: List[List[str]] = []
    current: List[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            if current:
                scenes.append(current)
                current = []
            continue
        current.append(line)
    if current:
        scenes.append(current)
    return scenes


def classify_scene(lines: List[str]) -> Scene:
    """Turn one scene's raw lines into its ordered verse/note elements."""
    scene = Scene()
    pending: List[Elem] = []
    lead_ref: Optional[str] = None

    for idx, raw in enumerate(lines):
        cleaned = _clean(raw)
        if not cleaned:
            continue
        if is_reference(cleaned):
            ref = normalize_ref(cleaned)
            for el in pending:
                if not el.ref:
                    el.ref = ref
            pending.clear()
            lead_ref = ref
            continue
        if is_bullet(cleaned):
            scene.elems.append(Elem("bullet", cleaned.lstrip()[2:].strip()))
            continue
        if is_heading(cleaned):
            label = cleaned.rstrip(":").strip()
            scene.elems.append(Elem("heading", label, label=label))
            continue
        if is_verse(cleaned):
            el = Elem("verse", cleaned)
            if lead_ref and not el.ref:
                el.ref = lead_ref
            scene.elems.append(el)
            pending.append(el)
            continue
        # passage paragraph: verse when a reference follows within two lines
        following = [_clean(x) for x in lines[idx + 1 : idx + 3]]
        if any(is_reference(x) for x in following):
            el = Elem("verse", cleaned)
            if lead_ref and not el.ref:
                el.ref = lead_ref
            scene.elems.append(el)
            pending.append(el)
        else:
            # definition note or plain prose
            d = split_definition(cleaned)
            if d:
                scene.elems.append(Elem("note", cleaned, term=d[0]))
            else:
                scene.elems.append(Elem("note", cleaned))

    return scene


def scenes_from_text_classified(text: str) -> List[Scene]:
    return [classify_scene(lines) for lines in scenes_from_text(text)]


def scenes_from_docx_classified(path: str) -> List[Scene]:
    import docx

    document = docx.Document(path)
    lines = []
    for para in document.paragraphs:
        text = para.text or ""
        lines.append(text.strip() if text.strip() else "")
    return scenes_from_text_classified("\n".join(lines))
