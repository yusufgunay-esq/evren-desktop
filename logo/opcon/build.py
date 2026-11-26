# Run: python build.py  (writes every OpCon master SVG next to this file)
# OpCon identity builder: split-O mark, stencil wordmark, lockup with descriptor, seal. Pure filled paths.
import math, os
from shapely.geometry import Point, box, Polygon
from shapely.ops import unary_union
from shapely import affinity
from harf import text, glyph
INK, BONE, BG_L, BG_D = "#0B0D10", "#E9E6DF", "#ECE9E2", "#0B0D10"
H=200; WW=36; STEN=16
def path(g, nd=2):
    polys=[g] if g.geom_type=="Polygon" else list(g.geoms)
    out=[]
    for p in polys:
        for ring in [p.exterior,*p.interiors]:
            c=list(ring.coords)[:-1]
            out.append("M"+" L".join(f"{x:.{nd}f} {y:.{nd}f}" for x,y in c)+"Z")
    return " ".join(out)
def mark(R=286, stroke=None, cx=512, cy=512):
    """O ring (outer radius R) split vertically; the right piece lifted out. Returns (main, piece), centred on its bbox."""
    w=stroke or R*0.35; cutx=cx+R*0.41; gap=R*0.155; lift=R*0.25
    ring=Point(cx,cy).buffer(R,256).difference(Point(cx,cy).buffer(R-w,256))
    main=ring.difference(box(cutx-gap/2,0,9999,9999))
    piece=affinity.translate(ring.intersection(box(cutx+gap/2,0,9999,9999)),0,-lift)
    u=unary_union([main,piece]); a,b,c,d=u.bounds
    dx,dy=cx-(a+c)/2,cy-(b+d)/2
    return affinity.translate(main,dx,dy), affinity.translate(piece,dx,dy)
def wordmark():
    return text("OPCON",H=H,W=WW,track=0.40,sten=STEN)
def descriptor(width):
    s="OPERATIONAL CONTROL"; base,w0=text(s,H=H,W=24,track=0.0)
    n=len(s)-1; tr=(width/0.26 - w0)/n/H   # fit to given width at scale 0.26
    g,w=text(s,H=H,W=24,track=tr)
    return affinity.scale(g,0.26,0.26,origin=(0,0)), w*0.26, H*0.26
def svgdoc(vb, body): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"><title>OpCon</title>{body}</svg>\n'
def fill(g,c): return f'<path fill="{c}" d="{path(g)}"/>'
def icon(bg, ink, R=286):
    m,p=mark(R)
    return svgdoc("0 0 1024 1024", f'<g id="scene"><rect width="1024" height="1024" fill="{bg}"/></g><g id="mark">{fill(unary_union([m,p]),ink)}</g>')
def mark_svg(ink):
    m,p=mark(); g=unary_union([m,p]); a,b,c,d=g.bounds
    return svgdoc(f"{a:.0f} {b:.0f} {c-a:.0f} {d-b:.0f}", fill(g,ink))
def wordmark_svg(ink):
    g,w=wordmark(); return svgdoc(f"0 0 {w:.0f} {H}", fill(g,ink))
def lockup(descr=True):
    wm,ww=wordmark()
    parts=[]
    if descr:
        dg,dw,dh=descriptor(ww); gap=64; block=H+gap+dh
        parts.append(affinity.translate(dg,0,H+gap))
    else: block=H
    parts.append(wm)
    text_g=unary_union(parts)
    mh=block*1.0; R=mh/2/1.0
    m,p=mark(R=R*0.86, cx=0, cy=block/2)
    mg=unary_union([m,p]); a,b,c,d=mg.bounds
    mg=affinity.translate(mg,-c-0,0)
    rule_x=0.36*H; rule=box(rule_x-3,-0.04*block,rule_x+3,block*1.04)
    text_g=affinity.translate(text_g,rule_x*2,0)
    if descr: g=unary_union([mg,rule,text_g])
    else:
        m2,p2=mark(R=H*0.68, cx=0, cy=H/2); mg2=unary_union([m2,p2]); a2,b2,c2,d2=mg2.bounds
        g=unary_union([affinity.translate(mg2,-c2-0.42*H,0),wm])
    a,b,c,d=g.bounds
    return g,(a,b,c,d)
def lockup_svg(ink,descr=True):
    g,(a,b,c,d)=lockup(descr); pad=0
    return svgdoc(f"{a:.0f} {b:.0f} {c-a:.0f} {d-b:.0f}", fill(g,ink))
def on_arc(s, r_base, center_deg, top=True, h=58, W=26, track=0.42, sten=0):
    g_parts=[]; widths=[]
    for ch in s:
        gg,w=glyph(ch,H,W,sten); widths.append(w*h/H)
        g_parts.append(None if gg is None else affinity.scale(gg,h/H,h/H,origin=(0,0)))
    tr=track*h; total=sum(widths)+tr*(len(s)-1)
    rm=r_base+h/2 if top else r_base-h/2
    out=[]; pos=-total/2
    for gg,w in zip(g_parts,widths):
        c=pos+w/2
        if gg is not None:
            if top:
                gg=affinity.translate(gg,-w/2-0,-H*h/H)   # glyph spans y in [-h,0]
                gg=affinity.translate(gg,0,-r_base)
                ang=math.degrees(c/rm)
            else:
                gg=affinity.translate(gg,-w/2,0)          # y in [0,h], top toward centre
                gg=affinity.translate(gg,0,r_base-h)
                ang=-math.degrees(c/rm)
            gg=affinity.rotate(gg,ang+center_deg,origin=(0,0))
            out.append(affinity.translate(gg,512,512))
        pos+=w+tr
    return unary_union(out)
def seal(ink):
    outer=Point(512,512).buffer(490,256).difference(Point(512,512).buffer(476,256))
    inner=Point(512,512).buffer(372,256).difference(Point(512,512).buffer(362,256))
    top=on_arc("OPCON",394,0,True,h=64,W=30,track=0.66,sten=9)
    bot=on_arc("OPERATIONAL CONTROL",446,0,False,h=40,W=24,track=0.42)
    dots=[affinity.rotate(affinity.rotate(box(512-13,512-13-424,512+13,512+13-424),45,origin=(512,88)),a,origin=(512,512)) for a in (-90,90)]
    m,p=mark(R=230)
    g=unary_union([outer,inner,top,bot,*dots,m,p])
    return g
def seal_svg(ink, bg=None):
    g=seal(ink); bgr=f'<rect width="1024" height="1024" fill="{bg}"/>' if bg else ""
    return svgdoc("0 0 1024 1024", bgr+fill(g,ink))
if __name__=="__main__":
    import sys
    OUT=sys.argv[1] if len(sys.argv)>1 else os.path.dirname(os.path.abspath(__file__))
    os.makedirs(OUT,exist_ok=True)
    files={"opcon-ikon.svg":icon(BG_L,INK),"opcon-ikon-dark.svg":icon(BG_D,BONE),"opcon-ikon-small.svg":icon(BG_D,BONE,R=318),
           "opcon-isaret.svg":mark_svg(INK),"opcon-isaret-acik.svg":mark_svg(BONE),
           "opcon-kelime.svg":wordmark_svg(INK),"opcon-kelime-acik.svg":wordmark_svg(BONE),
           "opcon-logo.svg":lockup_svg(INK),"opcon-logo-acik.svg":lockup_svg(BONE),
           "opcon-muhur.svg":seal_svg(INK),"opcon-muhur-acik.svg":seal_svg(BONE)}
    for n,s in files.items(): open(os.path.join(OUT,n),"w",encoding="utf-8").write(s)
    print(len(files),"files")
