# OpCon logo builder: sightline mark + sliced wordmark as pure filled paths (python build.py)
import math, os
from shapely.geometry import Point, box, LineString, Polygon
from shapely.ops import unary_union
from shapely import affinity
INK, BONE = "#0B0D10", "#E9E6DF"
BG_L, BG_D = "#ECE9E2", "#0B0D10"
RES=128
H, W = 200, 30
CUT_Y, CUT_H = 76, 16
def arc(cx,cy,r,a0,a1,n=256):
    return LineString([(cx+r*math.cos(math.radians(a0+(a1-a0)*i/n)), cy+r*math.sin(math.radians(a0+(a1-a0)*i/n))) for i in range(n+1)])
def L_O(): return Point(100,100).buffer(100,RES).difference(Point(100,100).buffer(100-W,RES)), 200
def L_P():
    rb=52; cx=88; cy=W/2+rb
    cl=list(LineString([(W/2,W/2),(cx,W/2)]).coords)+list(arc(cx,cy,rb,-90,90).coords)[1:]+[(W/2,W/2+2*rb)]
    bowl=LineString(cl).buffer(W/2,RES,cap_style="flat",join_style="mitre")
    return unary_union([box(0,0,W,H),bowl]).intersection(box(0,0,400,H)), cx+rb+W/2
def L_C():
    r=100-W/2; g=42
    s=arc(100,100,r,g,360-g).buffer(W/2,RES,cap_style="flat")
    return s, 100+r*math.cos(math.radians(g))+W/2+4
def L_N():
    w=172; t=W*1.04
    wd=t
    for _ in range(20): wd=t*math.hypot(w-wd,H)/H
    diag=Polygon([(0,0),(wd,0),(w,H),(w-wd,H)])
    return unary_union([box(0,0,W,H),box(w-W,0,w,H),diag]), w
def word(track=92):
    x=0; parts=[]
    for f in (L_O,L_P,L_C,L_O,L_N):
        g,w=f(); parts.append(affinity.translate(g,x,0)); x+=w+track
    return unary_union(parts), x-track
def cut(g, y=CUT_Y, h=CUT_H):
    minx,miny,maxx,maxy=g.bounds
    return g.difference(box(minx-10,y-h/2,maxx+10,y+h/2))
def disc_mark(r, yc, h, cx=512, cy=512, gap=None, x0=None, x1=None):
    d=Point(cx,cy).buffer(r,RES*2).difference(box(cx-r-5,yc-h/2,cx+r+5,yc+h/2))
    parts=[d]
    if gap is not None:
        dx=math.sqrt(r*r-(yc-cy)**2)
        parts+= [box(x0,yc-h/2,cx-dx-gap,yc+h/2), box(cx+dx+gap,yc-h/2,x1,yc+h/2)]
    return unary_union(parts)
def path(g, nd=2):
    polys=[g] if g.geom_type=="Polygon" else list(g.geoms)
    out=[]
    for p in polys:
        for ring in [p.exterior,*p.interiors]:
            c=list(ring.coords)[:-1]
            out.append("M"+" L".join(f"{x:.{nd}f} {y:.{nd}f}" for x,y in c)+"Z")
    return " ".join(out)
def svg(vb, body, title="OpCon"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}"><title>{title}</title>{body}</svg>\n'
def icon(bg, ink, small=False):
    if small: m=disc_mark(272, 512-0.24*272, 54, gap=46, x0=0, x1=1024)
    else:     m=disc_mark(250, 512-0.24*250, 38, gap=40, x0=0, x1=1024)
    return svg("0 0 1024 1024", f'<g id="scene"><rect width="1024" height="1024" fill="{bg}"/></g><g id="mark"><path fill="{ink}" fill-rule="evenodd" d="{path(m)}"/></g>')
def mark_only(ink):
    m=disc_mark(250, 512-0.24*250, 38, gap=40, x0=152, x1=872)
    minx,miny,maxx,maxy=m.bounds
    return svg(f"{minx:.0f} {miny:.0f} {maxx-minx:.0f} {maxy-miny:.0f}", f'<path fill="{ink}" fill-rule="evenodd" d="{path(m)}"/>')
def wordmark(ink):
    g,w=word(); g=cut(g)
    return svg(f"0 0 {w:.0f} {H}", f'<path fill="{ink}" fill-rule="evenodd" d="{path(g)}"/>')
def lockup(ink):
    D=236; r=D/2; top=CUT_Y-0.38*D; cy=top+r
    d=Point(r,cy).buffer(r,RES*2)
    g,w=word(); g=affinity.translate(g, D+108, 0)
    allg=cut(unary_union([d,g]))
    minx,miny,maxx,maxy=allg.bounds
    return svg(f"{minx:.0f} {miny:.1f} {maxx-minx:.0f} {maxy-miny:.1f}", f'<path fill="{ink}" fill-rule="evenodd" d="{path(allg)}"/>')
OUT=os.path.dirname(os.path.abspath(__file__)); os.makedirs(OUT,exist_ok=True)
files={"opcon-ikon.svg":icon(BG_L,INK),"opcon-ikon-dark.svg":icon(BG_D,BONE),"opcon-ikon-small.svg":icon(BG_D,BONE,True),
       "opcon-isaret.svg":mark_only(INK),"opcon-isaret-acik.svg":mark_only(BONE),
       "opcon-kelime.svg":wordmark(INK),"opcon-kelime-acik.svg":wordmark(BONE),
       "opcon-logo.svg":lockup(INK),"opcon-logo-acik.svg":lockup(BONE)}
for n,s in files.items(): open(os.path.join(OUT,n),"w",encoding="utf-8").write(s)
print({n:len(s) for n,s in files.items()})
