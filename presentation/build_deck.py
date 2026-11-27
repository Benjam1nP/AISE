"""Builds the AISE presentation from the HSG template (layouts, master, logo, footer)."""
import copy
import sys

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

if len(sys.argv) != 3:
    sys.exit("usage: python build_deck.py <template.pptx> <out.pptx>  (template: presentation/template/, gitignored)")
TPL, OUT = sys.argv[1], sys.argv[2]

GREEN = RGBColor(0x00, 0x80, 0x2F)
DARK = RGBColor(0x0A, 0x5F, 0x2D)
INK = RGBColor(0x1A, 0x1A, 0x1A)
GREY = RGBColor(0x55, 0x55, 0x55)
CARD = RGBColor(0xF7, 0xF7, 0xF7)
BOX = RGBColor(0xEC, 0xEC, 0xEC)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
MINT = RGBColor(0xE6, 0xF2, 0xEA)

prs = Presentation(TPL)

# Drop every template slide; layouts, master and theme stay.
sld_ids = prs.slides._sldIdLst
for sid in list(sld_ids):
    prs.part.drop_rel(sid.get(qn("r:id")))
    sld_ids.remove(sid)

LAYOUT = {l.name: l for l in prs.slide_layouts}


def new_slide(layout, number=True):
    s = prs.slides.add_slide(LAYOUT[layout])
    if number:
        for ph in LAYOUT[layout].placeholders:
            if ph.placeholder_format.type is not None and "SLIDE_NUMBER" in str(ph.placeholder_format.type):
                el = copy.deepcopy(ph._element)
                ids = [int(e.get("id")) for e in s.shapes._spTree.iter(qn("p:cNvPr"))]
                el.find(".//" + qn("p:cNvPr")).set("id", str(max(ids, default=1) + 1))
                s.shapes._spTree.append(el)
    return s


def plain(shape):
    """Template look: no theme shadow or bevel."""
    spPr = shape._element.spPr
    for e in spPr.findall(qn("a:effectLst")):
        spPr.remove(e)
    spPr.append(etree.SubElement(spPr, qn("a:effectLst")))


def text(slide, x, y, w, h, runs, size=14, color=INK, bold=False, align=PP_ALIGN.LEFT,
         anchor=MSO_ANCHOR.TOP, space_after=6, name=None):
    """runs: str, or list of paragraphs; a paragraph is str or list of (text, opts) tuples."""
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        tb.name = name
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = anchor
    fill_paragraphs(tf, runs, size, color, bold, align, space_after)
    return tb


def fill_paragraphs(tf, runs, size, color, bold, align, space_after):
    paras = runs if isinstance(runs, list) else [runs]
    for i, para in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        p.space_after = Pt(space_after)
        parts = [(para, {})] if isinstance(para, str) else para
        for t, o in parts:
            r = p.add_run()
            r.text = t
            f = r.font
            f.size = Pt(o.get("size", size))
            f.bold = o.get("bold", bold)
            f.italic = o.get("italic", False)
            f.color.rgb = o.get("color", color)
            if o.get("mono"):
                f.name = "Consolas"


def box(slide, x, y, w, h, fill=BOX, line=None, line_w=1.5, shape=MSO_SHAPE.ROUNDED_RECTANGLE,
        runs=None, size=14, color=INK, bold=False, align=PP_ALIGN.CENTER, anchor=MSO_ANCHOR.MIDDLE,
        inset=0.06, radius=0.18, name=None):
    s = slide.shapes.add_shape(shape, Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        s.name = name
    if shape == MSO_SHAPE.ROUNDED_RECTANGLE:
        s.adjustments[0] = radius
    if fill is None:
        s.fill.background()
    else:
        s.fill.solid()
        s.fill.fore_color.rgb = fill
    if line is None:
        s.line.fill.background()
    else:
        s.line.color.rgb = line
        s.line.width = Pt(line_w)
    plain(s)
    tf = s.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(inset)
    tf.margin_top = tf.margin_bottom = Inches(0.04)
    tf.vertical_anchor = anchor
    if runs is not None:
        fill_paragraphs(tf, runs, size, color, bold, align, 0)
    return s


def arrow(slide, x1, y1, x2, y2, color=GREY, width=1.5, both=False, dash=False, head=True):
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = color
    c.line.width = Pt(width)
    ln = c.line._get_or_add_ln()
    if dash:
        etree.SubElement(ln, qn("a:prstDash")).set("val", "dash")
    if both:
        etree.SubElement(ln, qn("a:headEnd")).set("type", "triangle")
    if head:
        etree.SubElement(ln, qn("a:tailEnd")).set("type", "triangle")
    return c


def header(slide, title, lead):
    slide.shapes.title.text = title
    text(slide, 0.52, 1.34, 12.29, 0.65, lead, size=18, color=DARK, name="Lead")


def source(slide, t):
    text(slide, 2.4, 6.9, 9.0, 0.3, t, size=10, color=GREY, anchor=MSO_ANCHOR.MIDDLE, name="Source")


def card(slide, x, y, w, h, num, title, body, num_color=GREEN, fill=CARD, outline=None):
    box(slide, x, y, w, h, fill=fill, line=outline, shape=MSO_SHAPE.RECTANGLE, name=f"Card {num}")
    text(slide, x + 0.25, y + 0.2, w - 0.5, 0.5, num, size=28, color=num_color, bold=True)
    text(slide, x + 0.25, y + 0.72, w - 0.5, 0.4, title, size=18, color=GREEN, bold=True)
    text(slide, x + 0.25, y + 1.17, w - 0.5, h - 1.3, body, size=14)


def notes(slide, t):
    slide.notes_slide.notes_text_frame.text = t


# 1 Title ------------------------------------------------------------------
s = new_slide("Titel Slide 1", number=False)
tf = s.shapes.title.text_frame
tf.text = "AISE"
p = tf.add_paragraph()
r = p.add_run()
r.text = "An AI-assisted software engineering environment, from a vague idea to a maintained system"
r.font.size = Pt(20)
ph = [p for p in s.placeholders if p.placeholder_format.idx == 10][0]
ph.text_frame.text = "St. Gallen, December 2026"
for line in ["Benjamin Pfister, Arthur Van Petegem", "Coding with AI, Prof. Dr. Guido Salvaneschi"]:
    ph.text_frame.add_paragraph().text = line
notes(s, "0:15. We are Benjamin and Arthur. AISE takes a project from a vague description to tested, deployed and maintained software, with the developer approving every phase.")

# 2 Problem and idea ---------------------------------------------------------
s = new_slide("Nur Titel")
header(s, "Problem and idea", "AI writes code well. The hard part is everything around the code.")
phases = ["Requirements", "Design", "Refinement", "Code", "Tests", "Deployment", "Maintenance"]
x0, w, gap = 0.52, 1.6, 0.18
text(s, x0, 2.2, 3 * w + 2 * gap, 0.3, "Before the code", size=14, color=GREEN, bold=True)
text(s, x0 + 4 * (w + gap), 2.2, 3 * w + 2 * gap, 0.3, "After the code", size=14, color=GREEN, bold=True)
for i, name in enumerate(phases):
    code = name == "Code"
    box(s, x0 + i * (w + gap), 2.6, w, 0.6,
        fill=BOX if code else WHITE, line=None if code else GREEN,
        runs=name, size=14, color=GREY if code else INK, bold=not code, name=f"Wing {name}")
text(s, x0 + 3 * (w + gap), 3.28, w, 0.3, "the baseline", size=12, color=GREY, align=PP_ALIGN.CENTER)
cw, cg = 3.9, 0.295
card(s, 0.52, 4.05, cw, 2.35, "01", "Design first",
     "Code is generated from the approved design model, never from the raw description.")
card(s, 0.52 + cw + cg, 4.05, cw, 2.35, "02", "Developer approves",
     "Every phase ends at a gate: automatic checks plus the developer's approval.")
card(s, 0.52 + 2 * (cw + cg), 4.05, cw, 2.35, "03", "Traceable by ID",
     "REQ → use case → design element → @trace in the code → test. Follow it both ways.")
notes(s, "0:45. Code generation is solved well enough by today's models. The wings around it, requirements, design, tests, deployment and maintenance, are where projects go wrong. Our answer has three parts: design first, the developer approves every phase, and every artefact carries an ID so it can be traced.")

# 3 Architecture --------------------------------------------------------------
s = new_slide("Nur Titel")
header(s, "Architecture", "Agents never talk to each other: the orchestrator briefs them, they share the artefacts.")
# left: developer and orchestrator
box(s, 0.52, 2.15, 2.3, 0.85, fill=BOX, runs=[[("Developer", {"bold": True})], "SvelteKit UI"], size=14, name="Developer")
arrow(s, 1.67, 3.02, 1.67, 3.83, both=True)
text(s, 1.8, 3.2, 1.1, 0.45, ["HTTP", "SSE events"], size=12, color=GREY, space_after=0)
box(s, 0.52, 3.85, 2.3, 1.4, fill=GREEN,
    runs=[[("Orchestrator", {"bold": True, "size": 16})], "plain code", "phases, gates,", "staleness, fix loop"],
    size=13, color=WHITE, name="Orchestrator")
# agents
ax, aw = 3.45, 4.35
text(s, ax, 1.95, aw, 0.25, "Agents, own loop on the Anthropic SDK", size=12, color=GREY)
agents = [
    ("P1–P3", "Requirements, design, review", "Sonnet 5.5"),
    ("P4", "Code workers, code agent", "Haiku, Sonnet"),
    ("P5", "Test workers, test agent", "Haiku, Sonnet"),
    ("P6", "Deploy agent", "Sonnet 5.5"),
    ("P7", "Maintenance agent", "Opus 5.5"),
]
ah, ag, ay = 0.52, 0.1, 2.22
for i, (ph_, role, model) in enumerate(agents):
    y = ay + i * (ah + ag)
    box(s, ax, y, aw, ah, fill=WHITE, line=GREEN,
        runs=[[(ph_ + "  ", {"bold": True, "color": GREEN}), (role, {})]],
        size=14, align=PP_ALIGN.LEFT, inset=0.12, name=f"Agent {ph_}")
    text(s, ax + aw - 1.62, y, 1.5, ah, model, size=13, color=GREEN, bold=True, align=PP_ALIGN.RIGHT,
         anchor=MSO_ANCHOR.MIDDLE)
text(s, ax, ay + 5 * (ah + ag) + 0.0, aw, 0.3, "Workers on Haiku 5.5 move to Sonnet on attempt 3", size=12, color=GREY)
arrow(s, 2.84, 4.55, 3.43, 4.55)
text(s, 2.86, 4.62, 0.6, 0.3, "brief", size=12, color=GREY)
# tool registry, MCP, docker
tx, tw = 8.35, 2.15
box(s, tx, 2.15, tw, 0.72, fill=BOX, runs=[[("MCP client", {"bold": True})], "Claude Code"], size=13, name="MCP client")
arrow(s, tx + tw / 2, 2.89, tx + tw / 2, 3.23)
text(s, tx + tw / 2 + 0.1, 2.92, 0.8, 0.3, "stdio", size=12, color=GREY)
box(s, tx, 3.25, tw, 1.3, fill=GREEN,
    runs=[[("Tool registry", {"bold": True, "size": 16})], "zod schema per tool", "scope per agent"],
    size=13, color=WHITE, name="Tool registry")
arrow(s, ax + aw + 0.02, 3.9, tx - 0.02, 3.9)
text(s, ax + aw + 0.05, 3.58, 0.55, 0.3, "tools", size=12, color=GREY)
arrow(s, tx + tw / 2, 4.57, tx + tw / 2, 4.88)
box(s, tx, 4.9, tw, 0.72, fill=BOX, runs=[[("Docker", {"bold": True})], "typecheck, tests, deploy"], size=13, name="Docker")
# artefacts
rx, rw = 10.95, 1.86
box(s, rx, 2.15, rw, 1.85, fill=MINT, shape=MSO_SHAPE.RECTANGLE, anchor=MSO_ANCHOR.TOP, align=PP_ALIGN.LEFT, inset=0.18,
    runs=[[(".aise/", {"bold": True, "color": GREEN, "size": 16})], "requirements.json", "design.json", "tickets.json", "state.json, checks/"],
    size=13, name="Artefacts state")
box(s, rx, 4.15, rw, 1.47, fill=MINT, shape=MSO_SHAPE.RECTANGLE, anchor=MSO_ANCHOR.TOP, align=PP_ALIGN.LEFT, inset=0.18,
    runs=[[("Project", {"bold": True, "color": GREEN, "size": 16})], "src/, test/", "Dockerfile, compose"],
    size=13, name="Artefacts files")
arrow(s, tx + tw + 0.02, 3.65, rx - 0.02, 3.1)
arrow(s, tx + tw + 0.02, 4.2, rx - 0.02, 4.75)
notes(s, "1:00. The developer works in a SvelteKit UI; HTTP actions go in, events come back over SSE. The orchestrator is plain code: it owns the phases, the gates and staleness, and starts one agent per run with a brief. Sonnet 5.5 runs the phase agents. Haiku 5.5 runs the parallel workers, one file each, cheap and fast, and escalates to Sonnet on the third attempt; Haiku also writes the short gate summary. Opus 5.5 runs maintenance, because it has to reason over every artefact at once. Every write goes through one tool registry: zod-validated tools with a scope per agent, the same tools served over stdio as an MCP server. Docker runs typecheck, tests and the deploy check. How the artefacts stay in sync is the next slide.")

# 4 Traceability and sync -----------------------------------------------------------
s = new_slide("Nur Titel")
header(s, "One ID through every artefact", "Shared IDs link each requirement to its design, code and tests; code is compared with the design.")
chain = [
    ("Requirement", ".aise/requirements.json",
     [[("REQ-002", {"bold": True, "color": GREEN, "mono": True}), ("  must", {"color": GREY})],
      "Mark task done or not done", [("AC1: ticking makes it done", {"color": GREY})]]),
    ("Design", ".aise/design.json",
     [[("UC-003", {"bold": True, "color": GREEN, "mono": True}), ("  use case", {})],
      [("SEQ-003", {"bold": True, "color": GREEN, "mono": True}), ("  calls setDone", {})],
      [("DSN-007", {"bold": True, "color": GREEN, "mono": True}), ("  TaskService", {})],
      [("renders 4 UML diagrams", {"color": GREY})]]),
    ("Code", "src/tasks-app/TaskService.ts",
     [[("@trace DSN-007", {"color": GREEN, "mono": True, "bold": True})],
      [("REQ-001 REQ-002 …", {"color": GREEN, "mono": True, "bold": True})],
      [("class TaskService", {"mono": True})]]),
    ("Test", "test/UC-003.test.ts",
     [[("UC-003", {"bold": True, "color": GREEN, "mono": True}), (" groups the tests", {})],
      [("it(\"", {"mono": True}), ("REQ-002 AC1", {"bold": True, "color": GREEN, "mono": True}), (": …\")", {"mono": True})],
      [("runs green in Docker", {"color": GREY})]]),
]
kw, kh, ky = 2.6, 2.45, 2.25
kg = (12.29 - 4 * kw) / 3
for i, (head, path, body) in enumerate(chain):
    x = 0.52 + i * (kw + kg)
    box(s, x, ky, kw, kh, fill=WHITE, line=GREEN, shape=MSO_SHAPE.RECTANGLE, name=f"Chain {head}")
    text(s, x + 0.2, ky + 0.15, kw - 0.4, 0.4, head, size=18, color=GREEN, bold=True)
    text(s, x + 0.2, ky + 0.55, kw - 0.4, 0.3, path, size=11, color=GREY)
    text(s, x + 0.2, ky + 0.95, kw - 0.3, kh - 1.0, body, size=14, space_after=4)
    if i < len(chain) - 1:
        arrow(s, x + kw + 0.06, ky + kh / 2, x + kw + kg - 0.06, ky + kh / 2, color=GREEN, width=2)
# drift: design and code compared both ways
dx1, dx2, dy = 0.52 + (kw + kg) + kw / 2, 0.52 + 2 * (kw + kg) + kw / 2, ky + kh + 0.35
for x in (dx1, dx2):
    arrow(s, x, dy, x, ky + kh + 0.04, color=DARK, width=1.75, dash=True)
arrow(s, dx1, dy, dx2, dy, color=DARK, width=1.75, dash=True, head=False)
text(s, dx1 - 1.0, dy + 0.12, dx2 - dx1 + 2.0, 0.6,
     [[("Drift check: ", {"bold": True, "color": GREEN}), ("the class model read from the code is compared with design.json; the developer repairs either side.", {})]],
     size=14, align=PP_ALIGN.CENTER)
box(s, 0.52, 5.85, 12.29, 0.62, fill=CARD, shape=MSO_SHAPE.RECTANGLE, align=PP_ALIGN.LEFT, inset=0.25,
    runs=[[("Source of truth: ", {"bold": True, "color": GREEN}),
           ("one JSON design model behind every diagram; agents edit it through a zod-checked tool, never Mermaid.", {})]],
    size=14, name="Source of truth")
notes(s, "0:30. Every artefact carries the same IDs. REQ-002 in the to do app: its use case UC-003 and sequence SEQ-003 call setDone on TaskService, DSN-007; the class carries an @trace comment with its IDs; the test for acceptance criterion 1 is named after it. The diagrams are rendered from one JSON model, so they cannot disagree. And because the code names its design element, we compare the code with the design and the developer repairs either side. You will follow this chain live in demo step 4.")

# 5 Workflow ------------------------------------------------------------------
s = new_slide("Nur Titel")
header(s, "Workflow P1 to P7", "Seven phases with a gate after each: the checks pass and the developer approves.")
flow = [("P1", "Requirements", "asks instead of guessing"),
        ("P2", "Design", "UML from the JSON model"),
        ("P3", "Refinement", "review proposals, one model"),
        ("P4", "Code", "mirrors the diagrams"),
        ("P5", "Tests", "per use case, fix loop"),
        ("P6", "Deployment", "proven by a deploy check"),
        ("P7", "Maintenance", "tickets, drift repair")]
fw, fg, fy = 1.5, 0.315, 2.35
for i, (pid, name, line) in enumerate(flow):
    x = 0.52 + i * (fw + fg)
    base = pid == "P4"
    box(s, x, fy, fw, 1.2, fill=BOX if base else WHITE, line=None if base else GREEN, inset=0.03,
        runs=[[(pid, {"bold": True, "size": 24, "color": GREY if base else GREEN})],
              [(name, {"bold": True})]], size=14, name=f"Phase {pid}")
    text(s, x, fy + 1.35, fw, 0.7, line, size=13, color=GREY if base else INK, align=PP_ALIGN.CENTER)
    if i < len(flow) - 1:
        cx = x + fw + fg / 2
        box(s, cx - 0.14, fy + 0.46, 0.28, 0.28, fill=GREEN, shape=MSO_SHAPE.OVAL, runs="✓", size=12,
            color=WHITE, bold=True, inset=0, name=f"Gate {i + 1}")
box(s, 0.52, 4.6, 0.32, 0.32, fill=GREEN, shape=MSO_SHAPE.OVAL, runs="✓", size=12, color=WHITE, bold=True, inset=0,
    name="Legend gate")
text(s, 0.98, 4.58, 5.2, 0.4, "Gate: checks plus the developer's Approve", size=14, anchor=MSO_ANCHOR.MIDDLE)
box(s, 6.45, 4.6, 0.32, 0.32, fill=BOX, shape=MSO_SHAPE.ROUNDED_RECTANGLE, name="Legend baseline")
text(s, 6.91, 4.58, 5.9, 0.4, "Code generation: the baseline, not the focus", size=14, anchor=MSO_ANCHOR.MIDDLE)
box(s, 0.52, 5.3, 12.29, 0.85, fill=CARD, shape=MSO_SHAPE.RECTANGLE, align=PP_ALIGN.LEFT, inset=0.25,
    runs=[[("Under change: ", {"bold": True, "color": GREEN}),
           ("an edit upstream marks every later phase stale. The developer chooses Update or Still valid; a P7 ticket walks the phases again from its entry phase.", {})]],
    size=14, name="Change note")
notes(s, "0:30. This is the map for the demo. Seven phases, and between each pair a gate: automatic checks plus the developer's approval. Code generation is grey on purpose, it is the baseline. When something changes upstream, later phases turn stale and the developer decides: update them or confirm they are still valid.")

# 6 Live demo -----------------------------------------------------------------
s = new_slide("Kapiteltrenner 1", number=False)
text(s, 0.52, 0.55, 12.29, 0.89, "Live demo", size=32, color=WHITE, anchor=MSO_ANCHOR.MIDDLE)
t = s.shapes.title
t.left, t.top, t.width, t.height = Inches(2.26), Inches(1.7), Inches(9.72), Inches(1.0)
t.text = "Switch to the app"
text(s, 2.26, 2.85, 9.72, 0.4, "Showcase: the to do project, prepared up to the start of each step", size=18, color=WHITE)
for p in list(s.placeholders):
    if p.placeholder_format.idx == 1:
        p._element.getparent().remove(p._element)
steps = [("1", "Clarifying questions", "P1 · C1"), ("2", "UML diagrams in the UI", "P2 · C1"),
         ("3", "Change a diagram", "P3 · C2"), ("4", "Requirement → diagram → code → test", "C5"),
         ("5", "Tests running green", "P5 · C1"), ("6", "Injected bug, explained and fixed", "C7"),
         ("7", "Deployment and deploy check", "P6 · C1"), ("8", "Maintenance ticket and report", "P7 · C2"),
         ("9", "Drift detected and repaired", "C2")]
for i, (n, t, c) in enumerate(steps):
    col, row = divmod(i, 5)
    x, y = 2.26 + col * 5.0, 3.7 + row * 0.5
    text(s, x, y, 4.8, 0.4, [[(n + "  ", {"bold": True}), (t + "  ", {}), (c, {"color": RGBColor(0xB8, 0xDB, 0xC4)})]],
         size=15, color=WHITE, space_after=0)
notes(s, "7:30, no slides. Switch to the app. Order: 1 clarifying questions in P1; 2 the diagrams, ask why about one choice; 3 change a diagram and show it update everywhere; 4 follow one requirement into diagram, code and test and back; 5 tests grouped by use case running green; 6 break the code, run tests, explain, apply fix, green; 7 Dockerfile, compose.yaml, RUN.md and the passing deploy check; 8 a P7 ticket through requirements, diagrams, code and tests to the change report; 9 hand edit the code and repair the drift. Skip a step rather than rush.")

# 7 Showcases and limits --------------------------------------------------------
s = new_slide("Nur Titel")
header(s, "Showcases and limits", "Three projects of growing size; the larger one exposes where the checks stop.")
cols = [
    ("Small · to do", "48", "tests green after a P7 change ticket", "10 requirements, 5 classes, $1.73 in total"),
    ("Medium · booking", "13", "classes and 11 use cases", "12 requirements, room booking rules"),
    ("Larger · auction", "57", "tests green after a P7 change ticket", "23 classes, 4 nodes, 2 live services"),
]
cw, cg = 3.9, 0.295
for i, (head, big, label, sub) in enumerate(cols):
    x = 0.52 + i * (cw + cg)
    box(s, x, 2.15, cw, 2.0, fill=CARD, shape=MSO_SHAPE.RECTANGLE, name=f"Showcase {i + 1}")
    text(s, x + 0.25, 2.3, cw - 0.5, 0.3, head, size=14, color=GREEN, bold=True)
    text(s, x + 0.25, 2.65, cw - 0.5, 0.65, big, size=36, color=GREEN, bold=True)
    text(s, x + 0.25, 3.33, cw - 0.5, 0.35, label, size=14, bold=True)
    text(s, x + 0.25, 3.68, cw - 0.5, 0.35, sub, size=13, color=GREY)
text(s, 0.52, 4.42, 6, 0.3, "Where it broke, and why", size=14, color=GREEN, bold=True)
limits = [
    ("Green gate, wrong code", "Concurrent bids could overwrite a higher bid. The generated tests never race requests; a code review found it."),
    ("Design outside the stack", "The design agent added a message broker and a database server the fixed stack cannot deploy."),
    ("Gates that blocked the walk", "A signature change failed P4 on old tests; P6 missed code changes. Both found by the auction ticket, both fixed."),
]
for i, (h, b) in enumerate(limits):
    x = 0.52 + i * (cw + cg)
    box(s, x, 4.8, cw, 1.5, fill=WHITE, line=GREEN, shape=MSO_SHAPE.RECTANGLE, name=f"Limit {i + 1}")
    text(s, x + 0.2, 4.93, cw - 0.4, 0.3, h, size=14, bold=True, color=GREEN)
    text(s, x + 0.2, 5.3, cw - 0.4, 1.2, b, size=13)
source(s, "showcases/, evidence/scaling-comparison.md (to do: 22 runs, $1.73; auction: 35 runs, $6.33 in total)")
notes(s, "0:45. To do is the small one we just demoed: 10 requirements and 5 classes, taken through a due date change ticket with 48 tests green, for 1.73 dollars over 22 runs. Booking is medium: 12 requirements, 11 use cases, 13 classes. Auction is the larger one: 23 classes on four nodes, two live services, taken through a reserve price change ticket with 57 tests green, for 6.33 dollars over 35 runs. Where it broke: the gates were green while concurrent bids could overwrite each other, because generated tests do not race requests; the design agent adds infrastructure outside our stack; and the auction ticket showed two gate problems, which we have since fixed. CHECK BEFORE THE TALK: update the booking numbers once issue #4 is done.")

# 8 Lessons learned -----------------------------------------------------------
s = new_slide("Nur Titel")
header(s, "Lessons learned", "AI did the volume; plain code and hard checks kept it honest.")
card(s, 0.52, 2.2, cw, 2.75, "01", "Small jobs, hard checks",
     "Cheap Haiku workers write one file each; typecheck, drift and tests decide, not the model. Sonnet only steps in on attempt 3.")
card(s, 0.52 + cw + cg, 2.2, cw, 2.75, "02", "Structure in, structure out",
     "Agents edit a zod-validated JSON model, never Mermaid. The diagrams cannot disagree, and every rejected edit names its error.")
card(s, 0.52 + 2 * (cw + cg), 2.2, cw, 2.75, "03", "Green is not correct",
     "Generated tests check what the model thought of. Human review still found real bugs: a bid race, a cached outage, dead timers.",
     num_color=DARK, fill=WHITE, outline=GREEN)
for i, tag in enumerate(["Where AI helped", "Where AI helped", "Where AI failed"]):
    text(s, 0.52 + i * (cw + cg) + 1.3, 2.42, cw - 1.55, 0.3, tag, size=12, color=GREY, align=PP_ALIGN.RIGHT)
stats = [("$6.33", "auction, P1 to P7 and one change ticket"), ("57", "generated tests green after the change"), ("3", "real bugs only a human review found")]
for i, (big, lab) in enumerate(stats):
    x = 0.52 + i * (cw + cg)
    text(s, x, 5.25, cw, 0.7, big, size=36, color=GREEN, bold=True)
    text(s, x, 5.98, cw, 0.35, lab, size=14, color=GREY)
notes(s, "0:30. Three points. One: AI is great at volume when each job is small and a hard check decides, not the model. Two: give the model structure; a validated JSON design model kept every diagram consistent. Three: a green gate is not correct code; review still found a race condition, a cached outage and dead timers in the auction showcase.")

# 9 Thanks --------------------------------------------------------------------
s = new_slide("Dank", number=False)
s.shapes.title.text = "Thank You!"
phs = {p.placeholder_format.idx: p for p in s.placeholders}
for idx, top, h in ((14, 3.05, 0.74), (13, 3.83, 1.26)):
    ph_ = phs[idx]
    ph_.left, ph_.top, ph_.width, ph_.height = Inches(1.21), Inches(top), Inches(9), Inches(h)
phs[14].text_frame.text = "Benjamin Pfister, Arthur Van Petegem"
phs[13].text_frame.text = "github.com/Benjam1nP/AISE"
for idx in (16, 17, 18, 19):
    if idx in phs:
        phs[idx]._element.getparent().remove(phs[idx]._element)
notes(s, "0:15. Thank you. The repository has every showcase with its artefacts, the architecture and the evidence per criterion. Questions?")

# Backup (hidden) ---------------------------------------------------------------
s = new_slide("Kapiteltrenner 1", number=False)
s.shapes.title.text = "Backup"
for p in list(s.placeholders):
    if p.placeholder_format.idx == 1:
        p._element.getparent().remove(p._element)
s._element.set("show", "0")

s = new_slide("Nur Titel")
header(s, "Backup: questions we expect", "Short answers, details in ARCHITECTURE.md and docs/decisions.md.")
qa = [("Why our own agent loop?", "About 110 lines we can explain: turn limit, cost guard and tool scope per agent, no framework magic."),
      ("Why JSON, not Mermaid?", "JSON can be validated and diffed by ID; one model renders every diagram, so they stay consistent."),
      ("What does a run cost?", "Auction end to end: $6.33 over 35 runs. Guards: $3 code, $2 tests, $1 deploy."),
      ("What breaks at scale?", "Large class diagrams get hard to read, and generated tests miss concurrency; review is still needed.")]
qw, qh = 6.0, 1.7
for i, (q, a) in enumerate(qa):
    col, row = i % 2, i // 2
    x, y = 0.52 + col * (qw + 0.29), 2.2 + row * (qh + 0.25)
    box(s, x, y, qw, qh, fill=CARD, shape=MSO_SHAPE.RECTANGLE, name=f"QA {i + 1}")
    text(s, x + 0.25, y + 0.2, qw - 0.5, 0.35, q, size=18, color=GREEN, bold=True)
    text(s, x + 0.25, y + 0.7, qw - 0.5, qh - 0.8, a, size=14)
s._element.set("show", "0")
notes(s, "Backup only. Check the loop size and cost figures against the repo before the talk.")

s = new_slide("Nur Titel")
header(s, "Backup: demo screenshots", "If the live demo breaks: one screenshot per demo step, in demo order.")
gw, gh, gxg, gyg = 3.9, 1.32, 0.295, 0.14
for i, (n, t, c) in enumerate(steps):
    col, row = i % 3, i // 3
    x, y = 0.52 + col * (gw + gxg), 2.1 + row * (gh + gyg)
    box(s, x, y, gw, gh, fill=CARD, line=BOX, shape=MSO_SHAPE.RECTANGLE, anchor=MSO_ANCHOR.BOTTOM, align=PP_ALIGN.LEFT,
        inset=0.12, runs=[[(f"{n}  {t}", {"bold": True, "color": GREEN}), (f"   {c}", {"color": GREY})]], size=12,
        name=f"Screenshot {n}")
s._element.set("show", "0")
notes(s, "Paste a screenshot of each demo step into its frame after the rehearsal.")

prs.save(OUT)
print("saved", OUT, len(prs.slides), "slides")
