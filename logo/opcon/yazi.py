# Set text from a font as shapely geometry (flattened outlines), y-down, cap height normalised.
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from shapely.geometry import Polygon
from shapely.ops import unary_union
from shapely import affinity
class FlatPen(BasePen):
    def __init__(s, gs): super().__init__(gs); s.rings=[]; s.cur=[]
    def _moveTo(s,p): s.cur=[p]
    def _lineTo(s,p): s.cur.append(p)
    def _curveToOne(s,a,b,c):
        p0=s.cur[-1]
        for i in range(1,17):
            t=i/16; u=1-t
            s.cur.append((u**3*p0[0]+3*u*u*t*a[0]+3*u*t*t*b[0]+t**3*c[0], u**3*p0[1]+3*u*u*t*a[1]+3*u*t*t*b[1]+t**3*c[1]))
    def _qCurveToOne(s,a,b):
        p0=s.cur[-1]
        for i in range(1,13):
            t=i/12; u=1-t
            s.cur.append((u*u*p0[0]+2*u*t*a[0]+t*t*b[0], u*u*p0[1]+2*u*t*a[1]+t*t*b[1]))
    def _closePath(s):
        if len(s.cur)>2: s.rings.append(s.cur)
        s.cur=[]
    _endPath=_closePath
def glyph_geom(font, ch):
    gs=font.getGlyphSet(); cmap=font.getBestCmap(); name=cmap[ord(ch)]
    pen=FlatPen(gs); gs[name].draw(pen)
    g=None
    for r in pen.rings:
        p=Polygon(r).buffer(0)
        g=p if g is None else g.symmetric_difference(p)
    return g, gs[name].width
def text(path, s, cap=200, track_em=0.0, var=None):
    f=TTFont(path)
    if var:
        from fontTools.varLib import instancer
        f=instancer.instantiateVariableFont(f, var)
    upm=f['head'].unitsPerEm; capH=f['OS/2'].sCapHeight or upm*0.7
    k=cap/capH; x=0; parts=[]
    for i,ch in enumerate(s):
        g,adv=glyph_geom(f,ch)
        if g is not None and not g.is_empty:
            g=affinity.scale(g,k,-k,origin=(0,0)); g=affinity.translate(g,x,cap)
            parts.append(g)
        x+=adv*k + (track_em*upm*k if i<len(s)-1 else 0)
    u=unary_union(parts); return u, u.bounds
