# Run: python kimlik.py  (writes the OpCon SVG masters next to this file; needs fonttools + shapely)
# Wordmark letters: Michroma by Vernon Adams, SIL Open Font License 1.1 (OFL.txt), outlined and given a heavier body.
# OpCon identity: Michroma-based OP·CON wordmark (OFL), splash scene and app icon. Pure SVG.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from yazi import text
from shapely.geometry import box
from shapely.ops import unary_union
from shapely import affinity
BONE, INK, AMBER, AMBER_L = "#E9E6DF", "#0B0D10", "#E0B36A", "#B9832F"
FONT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Michroma-Regular.ttf")
CAP = 200
def path(g, nd=1):
    polys = [g] if g.geom_type == "Polygon" else list(g.geoms)
    out = []
    for p in polys:
        for r in [p.exterior, *p.interiors]:
            c = list(r.coords)[:-1]
            out.append("M" + " L".join(f"{x:.{nd}f} {y:.{nd}f}" for x, y in c) + "Z")
    return " ".join(out)
def word(buf=3.5, dot=0.13, track=0.15, gap=None):
    op, _ = text(FONT, "OP", cap=CAP, track_em=track); con, _ = text(FONT, "CON", cap=CAP, track_em=track)
    m = lambda g: g.buffer(buf, join_style="mitre", mitre_limit=3)
    op, con = m(op), m(con)
    s = CAP * dot; g = gap if gap is not None else CAP * 0.2
    x0 = op.bounds[2] + g
    d = box(x0, CAP / 2 - s / 2, x0 + s, CAP / 2 + s / 2)
    con = affinity.translate(con, x0 + s + g - con.bounds[0], 0)
    return unary_union([op, con]), d
def wordmark_svg(ink, dc, small=False, title="OpCon"):
    letters, d = word(buf=7, dot=0.2, gap=CAP*0.22) if small else word()
    a, b, c, e = unary_union([letters, d]).bounds
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{a:.0f} {b:.0f} {c-a:.0f} {e-b:.0f}"><title>{title}</title>'
            f'<path fill="{ink}" d="{path(letters)}"/><path id="baglanti" fill="{dc}" d="{path(d)}"/></svg>\n')
def scene(w, h, horizon, R, defs_id="s"):
    # night sky + planet limb with a thin atmosphere band; R = planet radius, horizon = y of the limb top
    cx, cy = w / 2, horizon + R
    band = 0.055 * h
    o1, o2 = (R - 2) / (R + band), R / (R + band)
    return (f'<defs><radialGradient id="{defs_id}k" cx="50%" cy="100%" r="90%"><stop offset="0" stop-color="#0c1219"/><stop offset=".6" stop-color="#06080b"/><stop offset="1" stop-color="#05070a"/></radialGradient>'
            f'<radialGradient id="{defs_id}a" gradientUnits="userSpaceOnUse" cx="{cx}" cy="{cy}" r="{R+band:.1f}"><stop offset="{o1:.5f}" stop-color="#5f84a8" stop-opacity="0"/><stop offset="{o2:.5f}" stop-color="#6d91b5" stop-opacity=".42"/><stop offset="{(o2+1)/2:.5f}" stop-color="#46698c" stop-opacity=".12"/><stop offset="1" stop-color="#46698c" stop-opacity="0"/></radialGradient></defs>'
            f'<rect width="{w}" height="{h}" fill="url(#{defs_id}k)"/>'
            f'<circle cx="{cx}" cy="{cy:.1f}" r="{R+band:.1f}" fill="url(#{defs_id}a)"/>'
            f'<circle cx="{cx}" cy="{cy:.1f}" r="{R}" fill="#090c10"/>'
            f'<circle cx="{cx}" cy="{cy:.1f}" r="{R}" fill="none" stroke="#33414f" stroke-width="{max(1.5, w/700):.1f}"/>')
def splash_svg(w=1080, h=1920):
    letters, d = word(); a, b, c, e = unary_union([letters, d]).bounds
    k = (w * 0.64) / (c - a); tx = w / 2 - (a + c) / 2 * k; ty = h * 0.40 - (b + e) / 2 * k
    alt, _ = text(FONT, "OPERATIONAL CONTROL", cap=CAP, track_em=0.42)
    aa, ab, ac, ae = alt.bounds; ka = (w * 0.5) / (ac - aa)
    altg = affinity.translate(affinity.scale(alt, ka, ka, origin=(0, 0)), w / 2 - (aa + ac) / 2 * ka, h * 0.40 + (e - b) * k / 2 + h * 0.03)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"><title>OpCon</title>{scene(w, h, h*0.70, w*3.3, "sp")}'
            f'<g transform="translate({tx:.2f} {ty:.2f}) scale({k:.5f})"><path fill="{BONE}" d="{path(letters)}"/><path id="baglanti" fill="{AMBER}" d="{path(d)}"/></g>'
            f'<path fill="#68707a" d="{path(altg)}"/></svg>\n')
def icon_svg(kind="isaret", n=1024):
    body = scene(n, n, n * 0.66, n * 1.9, "ic")
    if kind == "isaret":
        s = n * 0.085; body += f'<rect x="{n/2-s/2:.1f}" y="{n*0.40-s/2:.1f}" width="{s:.1f}" height="{s:.1f}" fill="{AMBER}"/>'
    elif kind == "op":
        g, _ = text(FONT, "OP", cap=CAP, track_em=0.12); g = g.buffer(5, join_style="mitre", mitre_limit=3)
        a, b, c, e = g.bounds; k = (n * 0.5) / (c - a)
        g = affinity.translate(affinity.scale(g, k, k, origin=(0, 0)), n / 2 - (a + c) / 2 * k, n * 0.42 - (b + e) / 2 * k)
        s = n * 0.05; body += f'<path fill="{BONE}" d="{path(g)}"/><rect x="{n/2-s/2:.1f}" y="{n*0.60-s/2:.1f}" width="{s:.1f}" height="{s:.1f}" fill="{AMBER}"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}"><title>OpCon</title>{body}</svg>\n'
if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out, exist_ok=True)
    files = {"opcon-kelime.svg": wordmark_svg(BONE, AMBER), "opcon-kelime-koyu.svg": wordmark_svg(INK, AMBER_L),
             "opcon-kelime-kucuk.svg": wordmark_svg(BONE, AMBER, small=True),
             "opcon-acilis.svg": splash_svg(), "opcon-ikon.svg": icon_svg("op")}
    for k, v in files.items(): open(os.path.join(out, k), "w", encoding="utf-8").write(v)
    print(len(files), "files ->", out)
