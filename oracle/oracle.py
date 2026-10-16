"""Independent oracle for the Electrician Toolkit engine (SPEC §7, profile eu-de).

Written in P3 from docs/SPEC.md §7/§8/§13, DECISIONS D17-D19/D37/D39 and the call contract in
docs/V1_LOG.md ("P3 oracle note") only -- without reading src/engine (D23, WORKFLOW L23/L27).

Arithmetic: every rational step is a fractions.Fraction (exact). Irrational steps (square roots,
pi, 92^x, logarithms) use decimal.Decimal at PREC significant digits and are converted back to an
exact Fraction of that decimal, so the only error is < 1e-55 relative. Inputs (JSON doubles) are
taken as their exact binary value (Fraction(float)), i.e. the same numbers the engine receives.

Comparisons against a limit follow the documented contract (D37): a <= b + 1e-12 * max(|a|, |b|).

Public entry point: compute(kind, inp) -> dict with
  ok, values{name: Fraction}, texts{name: str}, checks{id: bool}, warnings[codes], errors[codes],
  absent[value names that must not be present], sources[source ids that must be present],
  defaults_used (bool: some default/assumption was applied -> A3 needs >= 1 assumption).
"""
from __future__ import annotations

import math
from decimal import Decimal, localcontext
from fractions import Fraction as F

PREC = 60


# ---------------------------------------------------------------- exact-ish helpers
def _dec(x: F) -> Decimal:
    with localcontext() as c:
        c.prec = PREC
        return Decimal(x.numerator) / Decimal(x.denominator)


def sqrt(x: F) -> F:
    if x < 0:
        raise ValueError('sqrt of negative')
    if x == 0:
        return F(0)
    # exact when x is a perfect square of a rational
    n, d = x.numerator, x.denominator
    rn, rd = math.isqrt(n), math.isqrt(d)
    if rn * rn == n and rd * rd == d:
        return F(rn, rd)
    with localcontext() as c:
        c.prec = PREC
        return F(_dec(x).sqrt())


def ln(x: F) -> F:
    with localcontext() as c:
        c.prec = PREC
        return F(_dec(x).ln())


def exp(x: F) -> F:
    with localcontext() as c:
        c.prec = PREC
        return F(_dec(x).exp())


def _pi() -> F:
    # Python decimal documentation recipe, at PREC + 5 digits
    with localcontext() as c:
        c.prec = PREC + 5
        three = Decimal(3)
        lasts, t, s, n, na, d, da = 0, three, 3, 1, 0, 0, 24
        while s != lasts:
            lasts = s
            n, na = n + na, na + 8
            d, da = d + da, da + 32
            t = (t * n) / d
            s += t
        return F(+s)


PI = _pi()
SQRT3 = sqrt(F(3))
TOL = F(1, 10**12)  # D37 comparison tolerance


def leq(a: F, b: F) -> bool:
    return a <= b + TOL * max(abs(a), abs(b))


# ---------------------------------------------------------------- SPEC §7.0 / §7.1 constants
FT_M = F('0.3048')
KCMIL_MM2 = 1000 * PI / 4 * F('0.0254') ** 2          # 0.506707479... mm²
METRIC = [F(s) for s in ('0.5', '0.75', '1', '1.5', '2.5', '4', '6', '10', '16', '25', '35', '50', '70',
                         '95', '120', '150', '185', '240', '300')]
AWG_MIN, AWG_MAX = -3, 40
LN92 = ln(F(92))

MAT = {
    'cu': {'rho20': F(1, 58), 'alpha': F('0.00393'), 'rho1': F('0.0225'), 'kappa': F(56),
           'src': ['iec60028']},
    'al': {'rho20': 1 / (F('0.61') * 58), 'alpha': F('0.00403'), 'rho1': F('0.036'), 'kappa': F(35),
           'src': ['iacs-al', 'al-alpha20']},
}
LAMBDA = F('0.00008')                  # Annex G reactance, Ω/m (0.08 mΩ/m)
X_DEFAULT = F('0.00008')
INSULATION_T = {'pvc': F(70), 'xlpe': F(90)}
PRESETS = {'din18015-1': (F(3), 'din18015-1'), 'vde-ar-n-4100': (F('0.5'), 'vde-ar-n-4100'),
           'iec-g-lighting': (F(3), 'iec60364-5-52-G'), 'iec-g-other': (F(5), 'iec60364-5-52-G')}
MCB_RATINGS = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125]
IA_FACTOR = {'B': 5, 'C': 10, 'D': 20}
I2_FACTOR = F('1.45')
RANGE_L = F(10000)
RANGE_I = F(10000)
FACTOR_MAX = F('1.5')


def awg_diameter(n: int) -> F:
    e = F(36 - n, 39)
    if e.denominator == 1:
        p = F(92) ** int(e)
    else:
        p = exp(LN92 * e)
    return F('0.127') * p


def awg_area(n: int) -> F:
    d = awg_diameter(n)
    return PI / 4 * d * d


AWG_AREA = {n: awg_area(n) for n in range(AWG_MIN, AWG_MAX + 1)}
AWG_ASC = list(range(AWG_MAX, AWG_MIN - 1, -1))   # 40 ... -3, ascending area


def awg_label(n: int) -> str:
    return f'{1 - n}/0' if n <= 0 else str(n)


def awg_exact(area: F) -> F:
    d = sqrt(4 * area / PI)
    return 36 - 39 * ln(d / F('0.127')) / LN92


def mm2_text(s: F) -> str:
    t = f'{float(s):.2f}'.rstrip('0').rstrip('.')
    return f'{t} mm²'


# ---------------------------------------------------------------- input reading (D39.4 rules)
def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


class Reader:
    def __init__(self, d):
        self.d = d if isinstance(d, dict) else {}
        self.errors: list[str] = []
        self.defaults = False

    def err(self, code):
        self.errors.append(code)

    def has(self, k):
        return k in self.d and self.d[k] is not None

    def num(self, k, rule='pos', default=None, src=None):
        d = self.d if src is None else src
        if k not in d or d[k] is None:
            if default is None:
                self.err('input.missing')
                return None
            self.defaults = True
            return F(default)
        v = d[k]
        if not _is_num(v):
            self.err('input.notNumber')
            return None
        x = F(v)
        if rule == 'pos' and x <= 0:
            self.err('input.notPositive')
            return None
        if rule == 'nonneg' and x < 0:
            self.err('input.negative')
            return None
        if rule == 'unit' and not (0 < x <= 1):
            self.err('input.range')
            return None
        if rule == 'pct' and not (0 < x <= 100):
            self.err('input.range')
            return None
        return x

    def opt(self, k, options, default=None, code='input.option'):
        if k not in self.d or self.d[k] is None:
            if default is None:
                self.err('input.missing')
                return None
            self.defaults = True
            return default
        v = self.d[k]
        if v not in options:
            self.err(code)
            return None
        return v

    def size(self, k):
        """Size {value, unit} -> (area mm², unit, awg gauge or None)."""
        s = self.d.get(k)
        if not isinstance(s, dict):
            self.err('input.missing')
            return None
        unit = s.get('unit')
        if unit not in ('mm2', 'awg', 'kcmil'):
            self.err('input.option')
            return None
        v = s.get('value')
        if v is None:
            self.err('input.missing')
            return None
        if not _is_num(v):
            self.err('input.notNumber')
            return None
        if unit == 'awg':
            if v != int(v) or not (AWG_MIN <= v <= AWG_MAX):
                self.err('input.awg')
                return None
            return (AWG_AREA[int(v)], 'awg', int(v))
        x = F(v)
        if x <= 0:
            self.err('input.notPositive')
            return None
        return (x if unit == 'mm2' else x * KCMIL_MM2, unit, None)

    def length(self, k='length'):
        s = self.d.get(k)
        if not isinstance(s, dict):
            self.err('input.missing')
            return None
        unit = s.get('unit')
        if unit not in ('m', 'ft'):
            self.err('input.option')
            return None
        x = self.num('value', 'pos', src=s)
        if x is None:
            return None
        return x if unit == 'm' else x * FT_M

    def parallel(self):
        if not self.has('parallel'):
            return 1
        v = self.d['parallel']
        if not _is_num(v):
            self.err('input.notNumber')
            return None
        if v != int(v) or v < 1:
            self.err('input.count')
            return None
        return int(v)

    def temperature(self, k, default):
        if not self.has(k):
            self.defaults = True
            return F(default)
        v = self.d[k]
        if not _is_num(v):
            self.err('input.notNumber')
            return None
        return F(v)


def _result():
    return {'ok': True, 'values': {}, 'texts': {}, 'checks': {}, 'warnings': [], 'errors': [],
            'absent': [], 'sources': set(), 'defaults_used': False}


def _fail(codes):
    r = _result()
    r['ok'] = False
    r['errors'] = sorted(set(codes))
    return r


def rho_theta(m, theta):
    return MAT[m]['rho20'] * (1 + MAT[m]['alpha'] * (theta - 20))


# ---------------------------------------------------------------- §7.2 resistance
def resistance(inp):
    rd = Reader(inp)
    m = rd.opt('material', MAT, code='input.material')
    sz = rd.size('size')
    L = rd.length()
    theta = rd.temperature('temperatureC', 70)
    n = rd.parallel()
    pe = rd.size('peSize') if rd.has('peSize') else None
    if m is not None and theta is not None and rho_theta(m, theta) <= 0:
        rd.err('input.temperature')
    if rd.errors:
        return _fail(rd.errors)
    r = _result()
    r['defaults_used'] = rd.defaults
    rt = rho_theta(m, theta)
    s_eff = n * sz[0]
    v = r['values']
    v['rho20'] = MAT[m]['rho20']
    v['rhoTheta'] = rt
    v['sEff'] = s_eff
    v['r20'] = MAT[m]['rho20'] * L / s_eff
    v['r'] = rt * L / s_eff
    if pe is not None:
        v['rPe'] = rt * L / pe[0]
        v['rLoop'] = v['r'] + v['rPe']
    else:
        r['absent'].append('rPe')
        v['rLoop'] = 2 * v['r']
    if L > RANGE_L:
        r['warnings'].append('range.length')
    r['sources'] |= set(MAT[m]['src']) | {'physics-resistance'}
    return r


# ---------------------------------------------------------------- §7.3 voltage drop
def _load_current(system, U, P, cos, eta):
    k = SQRT3 if system == 'ac3' else 1
    return P / (k * U * cos * eta)


def vdrop(inp):
    rd = Reader(inp)
    system = rd.opt('system', ('dc', 'ac1', 'ac3'))
    U = rd.num('voltage')
    has_i, has_p = rd.has('current'), rd.has('power')
    I = P = None
    if has_i == has_p:
        rd.err('input.oneOf')
    elif has_i:
        I = rd.num('current')
    else:
        P = rd.num('power')
    # D55 (M4): η is read only when it is used, i.e. when the load is given as a power (SPEC §13 amended)
    eta = rd.num('efficiency', 'unit', 1) if has_p and not has_i else F(1)
    L = rd.length()
    m = rd.opt('material', MAT, code='input.material')
    sz = rd.size('size')
    n = rd.parallel()
    if system == 'dc':
        cos = F(1)
    else:
        cos = rd.num('cosPhi', 'unit', 1)
    method = rd.opt('method', ('M1', 'M2', 'M3'), 'M1')
    ins = rd.opt('insulation', INSULATION_T, 'pvc')
    theta = rd.temperature('conductorTempC', INSULATION_T[ins] if ins else 70)
    xp = rd.num('reactanceOhmPerM', 'nonneg', X_DEFAULT)
    kappa = rd.num('kappa', 'pos', MAT[m]['kappa'] if m else 56)
    limit = rd.num('limitPercent', 'pct')
    preset = None
    if rd.has('limitPreset'):
        preset = rd.d['limitPreset']
        # D55 (M2): an unknown preset id is an invalid choice (input.option); a known preset with another % is
        # input.limitPreset
        if preset not in PRESETS:
            rd.err('input.option')
        elif limit is not None and PRESETS[preset][0] != limit:
            rd.err('input.limitPreset')
    if m is not None and theta is not None and rho_theta(m, theta) <= 0:
        rd.err('input.temperature')
    if rd.errors:
        return _fail(rd.errors)

    r = _result()
    r['defaults_used'] = True  # M1 always applies the Annex G reactance assumption; others default too
    b = 1 if system == 'ac3' else 2
    U0 = U / SQRT3 if system == 'ac3' else U
    if I is None:
        I = _load_current(system, U, P, cos, eta)
    sin = F(0) if system == 'dc' else sqrt(1 - cos * cos)

    def consts(meth):
        if meth == 'M1':
            rho, x = MAT[m]['rho1'], LAMBDA
        elif meth == 'M2':
            rho, x = rho_theta(m, theta), xp
        else:
            rho, x = 1 / kappa, xp
        if system == 'dc':
            x = F(0)
        return rho, x

    def u_of(meth, S):
        rho, x = consts(meth)
        return b * (rho * L / (n * S) * cos + x / n * L * sin) * I

    def pct(meth, S):
        return 100 * u_of(meth, S) / U0

    S = sz[0]
    rho, x = consts(method)
    u = u_of(method, S)
    dpct = 100 * u / U0
    within = leq(dpct, limit)
    v = r['values']
    v['current'] = I
    v['u0'] = U0
    v['sEff'] = n * S
    v['rho'] = rho
    v['reactance'] = x / n
    v['r'] = rho * L / (n * S)
    if system == 'dc':
        r['absent'].append('sinPhi')
    else:
        v['sinPhi'] = sin
    v['u'] = u
    v['deltaUPercent'] = dpct
    if system == 'ac3':
        v['deltaULL'] = SQRT3 * u
        v['uEnd'] = U - SQRT3 * u
        v['powerLoss'] = 3 * I * I * v['r']
    else:
        r['absent'].append('deltaULL')
        v['uEnd'] = U - u
        v['powerLoss'] = 2 * I * I * v['r']
    v['limit'] = limit
    v['lMax'] = limit * U0 / (100 * b * I * (rho / (n * S) * cos + x / n * sin))
    # minimum section (§7.3, D39.3): same method, n and assumptions; list follows the input unit
    if sz[1] == 'awg':
        cands = [(AWG_AREA[g], g) for g in AWG_ASC]
    else:
        cands = [(s, s) for s in METRIC]
    found = None
    for area, label in cands:
        p = pct(method, area)
        if leq(p, limit):
            found = (area, label, p)
            break
    if found is None:
        r['warnings'].append('vdrop.noStandardSize')
        r['absent'] += ['minSize', 'minSizeMm2', 'minSizePercent']
    else:
        v['minSize'] = F(found[1])
        v['minSizeMm2'] = found[0]
        v['minSizePercent'] = found[2]
        r['texts']['minSize'] = f'AWG {awg_label(found[1])}' if sz[1] == 'awg' else mm2_text(found[1])
    for meth in ('M1', 'M2', 'M3'):
        p = dpct if meth == method else pct(meth, S)
        v['percent' + meth] = p
        if meth != method and leq(p, limit) != within:
            r['warnings'].append('method.disagree')
    if L > RANGE_L:
        r['warnings'].append('range.length')
    if I > RANGE_I:
        r['warnings'].append('range.current')
    r['texts']['method'] = method
    r['texts']['verdict'] = 'within' if within else 'exceeds'
    r['checks']['vdrop.limit'] = within
    src = r['sources']
    if method == 'M1':
        src.add('iec60364-5-52-G')
    elif method == 'M2':
        src |= set(MAT[m]['src'])
    else:
        src.add('de-practice-kappa')
    if preset:
        src.add(PRESETS[preset][1])
    return r


# ---------------------------------------------------------------- §7.4 current and power, Ohm
def current(inp):
    rd = Reader(inp)
    system = rd.opt('system', ('dc', 'ac1', 'ac3'))
    U = rd.num('voltage')
    has_i, has_p = rd.has('current'), rd.has('power')
    I = P = None
    if has_i == has_p:
        rd.err('input.oneOf')
    elif has_i:
        I = rd.num('current')
    else:
        P = rd.num('power')
    cos = F(1) if system == 'dc' else rd.num('cosPhi', 'unit', 1)
    eta = rd.num('efficiency', 'unit', 1)
    if rd.errors:
        return _fail(rd.errors)
    r = _result()
    r['defaults_used'] = rd.defaults
    k = SQRT3 if system == 'ac3' else 1
    if I is None:
        I = P / (k * U * cos * eta)
    else:
        P = k * U * I * cos * eta
    v = r['values']
    v['current'] = I
    v['power'] = P
    if system == 'dc':
        v['inputPower'] = U * I
        r['absent'] += ['apparentPower', 'reactivePower']
    else:
        S = k * U * I
        v['apparentPower'] = S
        v['inputPower'] = S * cos
        v['reactivePower'] = S * sqrt(1 - cos * cos)
    if I > RANGE_I:
        r['warnings'].append('range.current')
    r['sources'].add('physics-power')
    return r


def ohm(inp):
    rd = Reader(inp)
    keys = ('voltage', 'current', 'resistance', 'power')
    given = [k for k in keys if rd.has(k)]
    if len(given) != 2:
        return _fail(['ohm.needTwo'])
    vals = {k: rd.num(k) for k in given}
    if rd.errors:
        return _fail(rd.errors)
    U, I, R, P = (vals.get(k) for k in keys)
    if U is not None and I is not None:
        R, P = U / I, U * I
    elif U is not None and R is not None:
        I = U / R
        P = U * I
    elif U is not None and P is not None:
        I = P / U
        R = U / I
    elif I is not None and R is not None:
        U = I * R
        P = U * I
    elif I is not None and P is not None:
        U = P / I
        R = U / I
    else:  # R, P
        U = sqrt(P * R)
        I = sqrt(P / R)
    r = _result()
    r['values'] = {'voltage': U, 'current': I, 'resistance': R, 'power': P}
    if I > RANGE_I:  # SPEC §13 "I > 10 kA → warning" read literally (contract table silent for ohm)
        r['warnings'].append('range.current')
    r['sources'].add('physics-power')
    return r


# ---------------------------------------------------------------- §7.5 coordination
def _device(rd, allow_other_key):
    dev = rd.d.get('device')
    if not isinstance(dev, dict):
        rd.err('input.missing')
        return None
    t = dev.get('type')
    if t == 'mcb':
        curve = dev.get('curve')
        if curve not in IA_FACTOR:
            rd.err('input.option')
            curve = None
        In = rd.num('ratedCurrent', src=dev)
        if In is not None and In not in MCB_RATINGS:
            rd.err('input.rating')
            In = None
        if curve is None or In is None:
            return None
        return {'type': 'mcb', 'curve': curve, 'in': In}
    if t == 'other':
        out = {'type': 'other'}
        for key in allow_other_key:
            out[key] = rd.num(key, src=dev)
        if any(out[k] is None for k in allow_other_key):
            return None
        return out
    rd.err('input.option')
    return None


def coord(inp):
    rd = Reader(inp)
    ib = rd.num('ib')
    dev = _device(rd, ('ratedCurrent', 'i2'))
    has_t, has_z = rd.has('table'), rd.has('izTyped')
    iz_table = tmax = tref = None
    if has_t == has_z:
        rd.err('coord.izSource')
    elif has_t:
        t = rd.d['table'] if isinstance(rd.d['table'], dict) else {}
        iz_table = rd.num('izA', src=t)
        tmax = rd.num('insulationMaxC', 'finite', src=t) if 'insulationMaxC' in t else None
        tref = rd.num('referenceAmbientC', 'finite', src=t) if 'referenceAmbientC' in t else None
    else:
        iz_table = rd.num('izTyped')
        tmax = rd.num('insulationMaxC', 'finite') if rd.has('insulationMaxC') else None
        tref = rd.num('referenceAmbientC', 'finite') if rd.has('referenceAmbientC') else None
    amb = rd.num('ambientC', 'finite') if rd.has('ambientC') else None
    f_typed = rd.num('fTheta', 'finite') if rd.has('fTheta') else None
    fg = rd.num('fGroup', 'finite', 1)
    fo = rd.num('fOther', 'finite', 1)
    for f in (f_typed, fg, fo):
        if f is not None and not (0 < f <= FACTOR_MAX):
            rd.err('coord.factor')
    computed = False
    ft = None
    if f_typed is not None:
        ft = f_typed
    elif amb is not None:
        if has_t == has_z:
            pass  # Iz source already invalid (coord.izSource); θmax/θref were not read — no follow-up error
        elif tmax is None or tref is None:
            rd.err('input.missing')
        elif tref >= tmax:
            rd.err('coord.reference')
        elif amb >= tmax:
            rd.err('coord.ambient')
        else:
            ft = sqrt((tmax - amb) / (tmax - tref))
            computed = True
            if not (0 < ft <= FACTOR_MAX):
                rd.err('coord.factor')
    else:
        ft = F(1)
        rd.defaults = True
    if f_typed is None and amb is None and tmax is not None and tref is not None and tref >= tmax:
        rd.err('coord.reference')
    if rd.errors:
        return _fail(rd.errors)
    r = _result()
    r['defaults_used'] = rd.defaults
    iz = iz_table * ft * fg * fo
    In = dev['in'] if dev['type'] == 'mcb' else dev['ratedCurrent']
    i2 = I2_FACTOR * In if dev['type'] == 'mcb' else dev['i2']
    v = r['values']
    v.update({'fTheta': ft, 'fGroup': fg, 'fOther': fo, 'izTable': iz_table, 'iz': iz, 'ib': ib,
              'in': F(In), 'i2': i2, 'i2Limit': I2_FACTOR * iz})
    c1, c2, c3 = leq(ib, In), leq(In, iz), leq(i2, I2_FACTOR * iz)
    r['checks'] = {'coord.c1': c1, 'coord.c2': c2, 'coord.c3': c3}
    r['texts']['verdict'] = 'met' if (c1 and c2 and c3) else 'notMet'
    if dev['type'] == 'mcb':
        r['texts']['device'] = f"{dev['curve']}{In}"
        sug = None
        for rating in MCB_RATINGS:
            if leq(ib, F(rating)) and leq(F(rating), iz) and leq(I2_FACTOR * rating, I2_FACTOR * iz):
                sug = rating
                break
        if sug is None:
            r['warnings'].append('coord.noRating')
            r['absent'] += ['suggestedIn', 'suggestedI2']
        else:
            v['suggestedIn'] = F(sug)
            v['suggestedI2'] = I2_FACTOR * sug
            r['texts']['suggestion'] = f"{dev['curve']}{sug}"
    else:
        r['absent'] += ['suggestedIn', 'suggestedI2']
    if ib > RANGE_I:
        r['warnings'].append('range.current')
    if computed:
        r['sources'].add('heat-balance')
    return r


# ---------------------------------------------------------------- §7.6 loop impedance (TN)
def loop(inp):
    rd = Reader(inp)
    mode = rd.opt('mode', ('calculated', 'measured'), 'calculated')
    u0 = rd.num('u0', 'pos', 230)
    dev = _device(rd, ('ia',))
    cmin = rd.num('cmin', 'unit', 1)
    if mode == 'calculated':
        ze = rd.num('ze', 'nonneg')
        m = rd.opt('material', MAT, code='input.material')
        sl = rd.size('lineSize')
        sp = rd.size('peSize')
        L = rd.length()
        theta = rd.temperature('loopTempC', 70)
        if m is not None and theta is not None and rho_theta(m, theta) <= 0:
            rd.err('input.temperature')
    elif mode == 'measured':
        zsm = rd.num('zsMeasured')
        k = rd.num('measuredFactor', 'unit', F(2, 3))
    if rd.errors:
        return _fail(rd.errors)
    r = _result()
    r['defaults_used'] = True  # reactance neglected / disconnection-time note always apply
    ia = IA_FACTOR[dev['curve']] * dev['in'] if dev['type'] == 'mcb' else dev['ia']
    zs_max = cmin * u0 / ia
    v = r['values']
    v['ia'] = F(ia)
    v['zsMax'] = zs_max
    if mode == 'calculated':
        rt = rho_theta(m, theta)
        rp = rt * (1 / sl[0] + 1 / sp[0])
        zs = ze + rp * L
        v.update({'rhoTheta': rt, 'rPrime': rp, 'zs': zs, 'ik': cmin * u0 / zs})
        if leq(zs_max, ze):  # Ze >= Zs_max (with the D37 tolerance)
            r['warnings'].append('loop.zeExceeds')
            r['absent'].append('lMax')
        else:
            v['lMax'] = (zs_max - ze) / rp
        met = leq(zs, zs_max)
        r['checks']['loop.zs'] = met
        if L > RANGE_L:
            r['warnings'].append('range.length')
        r['sources'] |= set(MAT[m]['src'])
    else:
        lim = zs_max * k
        v.update({'zs': zsm, 'measuredLimit': lim, 'ik': cmin * u0 / zsm})
        r['absent'].append('lMax')
        met = leq(zsm, lim)
        r['checks']['loop.measured'] = met
    r['texts']['verdict'] = 'met' if met else 'notMet'
    r['texts']['mode'] = mode
    if dev['type'] == 'mcb':
        r['texts']['device'] = f"{dev['curve']}{dev['in']}"
        r['sources'].add('iec60898-1')
    r['sources'].add('iec60364-4-41-t41.1')
    return r


# ---------------------------------------------------------------- §7.7 conversions
def _metric_bounds(area, v, absent):
    ge = [s for s in METRIC if leq(area, s)]   # D55 (M1): D37 tolerance on the bounds
    le = [s for s in METRIC if leq(s, area)]
    if ge:
        v['metricAtLeast'] = ge[0]
    else:
        absent.append('metricAtLeast')
    if le:
        v['metricAtMost'] = le[-1]
    else:
        absent.append('metricAtMost')


def convert(inp):
    rd = Reader(inp)
    frm = rd.opt('from', ('awg', 'mm2', 'kcmil', 'ft', 'm'))
    val = None
    if frm is not None:
        if 'value' not in rd.d or rd.d['value'] is None:
            rd.err('input.missing')
        elif not _is_num(rd.d['value']):
            rd.err('input.notNumber')
        elif frm == 'awg':
            g = rd.d['value']
            if g != int(g) or not (AWG_MIN <= g <= AWG_MAX):
                rd.err('input.awg')
            else:
                val = int(g)
        else:
            val = rd.num('value')
    if rd.errors:
        return _fail(rd.errors)
    r = _result()
    v = r['values']
    if frm == 'awg':
        area = AWG_AREA[val]
        v['diameterMm'] = awg_diameter(val)
        v['mm2'] = area
        v['kcmil'] = area / KCMIL_MM2
        _metric_bounds(area, v, r['absent'])
        r['texts']['awg'] = awg_label(val)
        r['sources'].add('astm-b258')
    elif frm in ('mm2', 'kcmil'):
        area = val if frm == 'mm2' else val * KCMIL_MM2
        if frm == 'mm2':
            v['kcmil'] = val / KCMIL_MM2
        else:
            v['mm2'] = area
        v['awgExact'] = awg_exact(area)
        # D55 (M1): the bounds use the D37 tolerance, so an AWG area is its own gauge on both bounds
        ge = [g for g in AWG_ASC if leq(area, AWG_AREA[g])]   # ascending area
        le = [g for g in AWG_ASC if leq(AWG_AREA[g], area)]
        if ge:
            v['awgAtLeast'] = F(ge[0])
        else:
            r['absent'].append('awgAtLeast')
        if le:
            v['awgAtMost'] = F(le[-1])
        else:
            r['absent'].append('awgAtMost')
        _metric_bounds(area, v, r['absent'])
        r['sources'].add('astm-b258')
    elif frm == 'ft':
        v['m'] = val * FT_M
    else:
        v['ft'] = val / FT_M
    return r


KINDS = {'vdrop': vdrop, 'current': current, 'ohm': ohm, 'coord': coord, 'loop': loop,
         'resistance': resistance, 'convert': convert}


def compute(kind, inp):
    fn = KINDS.get(kind)
    if fn is None:
        return _fail(['input.kind'])
    return fn(inp)
