# Own monoline geometric letters (cap height H) built with shapely; optional stencil breaks.
import math
from shapely.geometry import Point, box, LineString, Polygon
from shapely.ops import unary_union
from shapely import affinity
RES=96
def arcline(cx,cy,r,a0,a1,n=160):
    return LineString([(cx+r*math.cos(math.radians(a0+(a1-a0)*i/n)), cy+r*math.sin(math.radians(a0+(a1-a0)*i/n))) for i in range(n+1)])
def stroke(coords,W): return LineString(coords).buffer(W/2,RES,cap_style="flat",join_style="mitre",mitre_limit=10)
def diag(x0,x1,W,H,top=0,bot=None):
    # parallelogram from (x0..x0+wd at top) to (x1-wd..x1 at bottom) with perpendicular weight W
    bot=H if bot is None else bot; h=bot-top; wd=W
    for _ in range(20): wd=W*math.hypot(abs(x1-x0)-wd,h)/h
    if x1>x0: return Polygon([(x0,top),(x0+wd,top),(x1,bot),(x1-wd,bot)])
    return Polygon([(x0-wd,top),(x0,top),(x1+wd,bot),(x1,bot)])
def glyph(ch,H=200,W=30,sten=0):
    h=W/2; R=H/2
    if ch=="O":
        g=Point(R,R).buffer(R,RES).difference(Point(R,R).buffer(R-W,RES)); w=H
        if sten: g=g.difference(box(R+R*0.5-sten/2,-1,R+R*0.5+sten/2,H+1))
        return g,w
    if ch=="C":
        r=R-h; a=42
        return arcline(R,R,r,a,360-a).buffer(h,RES,cap_style="flat"), R+r*math.cos(math.radians(a))+h+4
    if ch in "PR":
        rb=0.26*H; cx=0.44*H
        x0=W+sten if sten else h
        cl=[(x0,h),(cx,h)]+list(arcline(cx,h+rb,rb,-90,90).coords)[1:]+[(x0,h+2*rb)]
        bowl=stroke(cl,W)
        if sten: bowl=bowl.intersection(box(W+sten,-50,999,999))
        g=unary_union([box(0,0,W,H),bowl]).intersection(box(-1,0,999,H)); w=cx+rb+h
        if ch=="R":
            leg=diag(cx-0.06*H, cx+rb+h, W, H, top=h+2*rb-h, bot=H)
            g=unary_union([g,leg]).intersection(box(-1,0,999,H)); w=cx+rb+h
        return g,w
    if ch=="N":
        t=W*1.04; wd=t/math.sin(math.radians(60)); w=H/math.tan(math.radians(60))+wd  # diagonal locked to 60 deg
        d=diag(0,w,t,H)
        if sten: d=d.difference(box(-1,-1,W+sten,H+1)).difference(box(w-W-sten,-1,w+1,H+1))
        return unary_union([box(0,0,W,H),box(w-W,0,w,H),d]),w
    if ch=="E":
        w=0.62*H
        return unary_union([box(0,0,W,H),box(0,0,w,W),box(0,R-h,w*0.88,R+h),box(0,H-W,w,H)]),w
    if ch=="L":
        w=0.56*H; return unary_union([box(0,0,W,H),box(0,H-W,w,H)]),w
    if ch=="I": return box(0,0,W,H),W
    if ch=="T":
        w=0.72*H; return unary_union([box(0,0,w,W),box(w/2-h,0,w/2+h,H)]),w
    if ch=="A":
        w=0.9*H; ap=W*1.0
        l=diag(w/2-ap/2,0,W*1.04,H) ; r=diag(w/2+ap/2,w,W*1.04,H)
        l=Polygon([(w/2-ap/2,0),(w/2+ap/2,0),(0+0,H)] ) if False else l
        top=box(w/2-ap/2-1,0,w/2+ap/2+1,W)
        bar=box(w*0.2,H*0.64-h,w*0.8,H*0.64+h)
        g=unary_union([l,r,top,bar]).intersection(box(0,0,w,H)); return g,w
    if ch==" ": return None,0.5*H
    raise KeyError(ch)
def text(s,H=200,W=30,track=0.3,sten=0):
    x=0; parts=[]
    for ch in s:
        g,w=glyph(ch,H,W,sten)
        if g is not None: parts.append(affinity.translate(g,x,0))
        x+=w+track*H
    return unary_union(parts), x-track*H
