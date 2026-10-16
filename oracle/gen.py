"""Seeded case generator for the oracle comparator (D23, SPEC A2).

  python3 oracle/gen.py           write test/fixtures/oracle/<kind>.json + examples.json
  python3 oracle/gen.py --check   regenerate in memory and fail if any file would change

Every expected value comes from oracle.py (exact arithmetic, see there); nothing is typed by hand
except the inputs of the edge cases. Never edit the JSON to make a test pass (CLAUDE.md, D23).
"""
from __future__ import annotations

import json
import random
import sys
from fractions import Fraction as F
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import oracle as O  # noqa: E402
import examples as EX  # noqa: E402

OUT = HERE.parent / 'test' / 'fixtures' / 'oracle'
SEED = 20261001
N_PER_KIND = 2000          # SPEC A2: >= 2000 per kind; vdrop gets N_PER_KIND per method
N_FAULTS = 200            # seeded single-fault inputs per kind (error codes)


# ---------------------------------------------------------------- expectation record
def expect(kind, inp):
    r = O.compute(kind, inp)
    e = {'ok': r['ok']}
    if r['ok']:
        e['values'] = {k: float(v) for k, v in sorted(r['values'].items())}
        if r['texts']:
            e['texts'] = dict(sorted(r['texts'].items()))
        if r['checks']:
            e['checks'] = dict(sorted(r['checks'].items()))
        e['warnings'] = sorted(r['warnings'])
        if r['absent']:
            e['absent'] = sorted(set(r['absent']))
        e['sources'] = sorted(r['sources'])
        e['assumptions'] = bool(r['defaults_used'])
    else:
        e['errors'] = r['errors']
    return e


def case(cid, kind, inp, tags=()):
    c = {'id': cid, 'kind': kind, 'input': inp, 'expect': expect(kind, inp)}
    if tags:
        c['tags'] = list(tags)
    return c


# ---------------------------------------------------------------- random helpers
def sig(x, digits):
    return float(f'{x:.{digits}g}')


def logu(rng, lo, hi, digits=3):
    import math
    v = math.exp(rng.uniform(math.log(lo), math.log(hi)))
    return sig(v, digits) if digits else v


def m(v, unit='m'):
    return {'value': v, 'unit': unit}


def rand_size(rng, big=False):
    u = rng.random()
    if u < 0.65:
        if rng.random() < 0.9:
            pool = O.METRIC if big else O.METRIC[:14]
            return {'value': float(rng.choice(pool)), 'unit': 'mm2'}
        return {'value': logu(rng, 0.3, 400, 3), 'unit': 'mm2'}
    if u < 0.88:
        return {'value': rng.choice(range(-3, 41)) if rng.random() < 0.3 else rng.randint(-3, 18), 'unit': 'awg'}
    return {'value': rng.choice([250, 300, 350, 400, 500, 600, 750, 1000]) if rng.random() < 0.7
            else logu(rng, 1, 2000, 3), 'unit': 'kcmil'}


def rand_length(rng, lo=0.5, hi=2000):
    if rng.random() < 0.8:
        return m(logu(rng, lo, hi, 3))
    return m(logu(rng, lo / 0.3048, hi / 0.3048, 3), 'ft')


def rand_cos(rng):
    if rng.random() < 0.6:
        return rng.choice([1, 0.5, 0.8, 0.85, 0.9, 0.95])
    return round(rng.uniform(0.3, 1), 2) or 0.3


VOLTS = {'dc': [12, 24, 48, 110, 220], 'ac1': [110, 120, 127, 230, 240], 'ac3': [208, 380, 400, 415, 480, 690]}


def rand_vdrop(rng, method):
    system = rng.choice(['dc', 'ac1', 'ac1', 'ac3', 'ac3'])
    inp = {'system': system}
    inp['voltage'] = rng.choice(VOLTS[system]) if rng.random() < 0.85 else logu(rng, 5, 1000, 3)
    if rng.random() < 0.7:
        inp['current'] = logu(rng, 0.1, 500, 3)
    else:
        inp['power'] = logu(rng, 10, 300000, 3)
        if rng.random() < 0.5:
            inp['efficiency'] = round(rng.uniform(0.7, 1), 2)
    inp['length'] = rand_length(rng)
    inp['material'] = 'cu' if rng.random() < 0.75 else 'al'
    inp['size'] = rand_size(rng)
    if rng.random() < 0.2:
        inp['parallel'] = rng.randint(1, 4)
    if system != 'dc' or rng.random() < 0.2:
        inp['cosPhi'] = rand_cos(rng)
    if method != 'M1' or rng.random() < 0.3:
        inp['method'] = method
    r = rng.random()
    if r < 0.25:
        inp['insulation'] = rng.choice(['pvc', 'xlpe'])
    elif r < 0.4:
        inp['conductorTempC'] = rng.choice([20, 30, 60, 70, 75, 90, 105, -10, round(rng.uniform(-20, 120), 1)])
    if rng.random() < 0.3:
        inp['reactanceOhmPerM'] = rng.choice([0, 0.00008, 0.0001, round(rng.uniform(0.00005, 0.00015), 6)])
    if rng.random() < 0.25:
        inp['kappa'] = rng.choice([56, 54, 50, 35, 33, round(rng.uniform(30, 58), 1)])
    p = rng.random()
    if p < 0.15:
        pid = rng.choice(list(O.PRESETS))
        inp['limitPreset'] = pid
        inp['limitPercent'] = float(O.PRESETS[pid][0])
    elif p < 0.85:
        inp['limitPercent'] = rng.choice([0.5, 1, 1.5, 2, 3, 4, 5])
    else:
        inp['limitPercent'] = round(rng.uniform(0.1, 10), 2)
    return inp


def rand_current(rng):
    system = rng.choice(['dc', 'ac1', 'ac3'])
    inp = {'system': system, 'voltage': rng.choice(VOLTS[system]) if rng.random() < 0.85 else logu(rng, 5, 1000, 3)}
    if rng.random() < 0.6:
        inp['power'] = logu(rng, 1, 500000, 3)
    else:
        inp['current'] = logu(rng, 0.01, 2000, 3)
    if system != 'dc' or rng.random() < 0.2:
        if rng.random() < 0.85:
            inp['cosPhi'] = rand_cos(rng)
    if rng.random() < 0.5:
        inp['efficiency'] = round(rng.uniform(0.5, 1), 2)
    return inp


def rand_ohm(rng):
    keys = ['voltage', 'current', 'resistance', 'power']
    pair = rng.sample(keys, 2)
    rngs = {'voltage': (0.1, 1000), 'current': (0.001, 500), 'resistance': (0.01, 100000), 'power': (0.01, 50000)}
    inp = {}
    for k in pair:
        lo, hi = rngs[k]
        inp[k] = logu(rng, lo, hi, 3 if rng.random() < 0.8 else 0)
    return inp


def rand_device(rng, other_key):
    if rng.random() < 0.8:
        return {'type': 'mcb', 'curve': rng.choice('BCD'), 'ratedCurrent': rng.choice(O.MCB_RATINGS)}
    In = rng.choice([2, 4, 16, 20, 25, 35, 50, 63, 100, 160, 250]) if rng.random() < 0.7 else logu(rng, 1, 400, 3)
    if other_key == 'i2':
        return {'type': 'other', 'ratedCurrent': In, 'i2': sig(In * rng.choice([1.2, 1.3, 1.45, 1.6, 1.9, 2.1]), 4)}
    return {'type': 'other', 'ia': logu(rng, 5, 5000, 3)}


def rand_coord(rng):
    inp = {'ib': logu(rng, 0.5, 150, 3)}
    inp['device'] = rand_device(rng, 'i2')
    tmax = rng.choice([70, 90, 70, 60, 80])
    tref = rng.choice([30, 30, 25, 20])
    iz = logu(rng, 5, 300, 3)
    if rng.random() < 0.7:
        t = {'izA': iz, 'insulationMaxC': tmax, 'referenceAmbientC': tref}
        if rng.random() < 0.3:
            t['tableName'] = 'My table'
            t['sizeMm2'] = float(rng.choice(O.METRIC[:12]))
        inp['table'] = t
    else:
        inp['izTyped'] = iz
        inp['insulationMaxC'] = tmax
        inp['referenceAmbientC'] = tref
    r = rng.random()
    if r < 0.6:
        inp['ambientC'] = rng.choice([10, 20, 25, 30, 35, 40, 45, 50, 55]) if rng.random() < 0.6 else \
            round(rng.uniform(-10, tmax - 1), 1)
    elif r < 0.7:
        inp['fTheta'] = round(rng.uniform(0.5, 1.2), 2)
    if rng.random() < 0.5:
        inp['fGroup'] = rng.choice([1, 0.8, 0.7, 0.65, 0.57, 0.5, round(rng.uniform(0.4, 1), 2)])
    if rng.random() < 0.2:
        inp['fOther'] = round(rng.uniform(0.7, 1.2), 2)
    return inp


def rand_loop(rng):
    inp = {}
    if rng.random() < 0.5:
        inp['u0'] = rng.choice([230, 220, 240, 120, 127])
    inp['device'] = rand_device(rng, 'ia')
    c = rng.random()
    if c < 0.3:
        inp['cmin'] = 0.95
    elif c < 0.45:
        inp['cmin'] = 1
    if rng.random() < 0.7:
        if rng.random() < 0.3:
            inp['mode'] = 'calculated'
        inp['ze'] = round(rng.uniform(0, 1.5), 2) if rng.random() < 0.9 else 0
        inp['material'] = 'cu' if rng.random() < 0.8 else 'al'
        inp['lineSize'] = rand_size(rng)
        inp['peSize'] = inp['lineSize'] if rng.random() < 0.6 else rand_size(rng)
        inp['length'] = rand_length(rng, 1, 300)
        if rng.random() < 0.4:
            inp['loopTempC'] = rng.choice([20, 30, 70, 80, 90, round(rng.uniform(-10, 160), 1)])
    else:
        inp['mode'] = 'measured'
        inp['zsMeasured'] = round(logu(rng, 0.05, 8, 3), 3)
        f = rng.random()
        if f < 0.5:
            inp['measuredFactor'] = rng.choice([0.8, 1, 2 / 3])
    return inp


def rand_resistance(rng):
    inp = {'material': 'cu' if rng.random() < 0.7 else 'al', 'size': rand_size(rng, big=True),
           'length': rand_length(rng, 0.1, 5000)}
    if rng.random() < 0.6:
        inp['temperatureC'] = rng.choice([20, 70, 90, 75, -20, 160, 250, round(rng.uniform(-40, 250), 1)])
    if rng.random() < 0.2:
        inp['parallel'] = rng.randint(1, 4)
    if rng.random() < 0.4:
        inp['peSize'] = rand_size(rng, big=True)
    return inp


def rand_convert(rng):
    frm = rng.choice(['awg', 'awg', 'mm2', 'mm2', 'kcmil', 'ft', 'm'])
    if frm == 'awg':
        v = rng.randint(-3, 40)
    elif frm == 'mm2':
        v = float(rng.choice(O.METRIC)) if rng.random() < 0.3 else logu(rng, 0.001, 700, rng.choice([2, 3, 4, 0]))
    elif frm == 'kcmil':
        v = rng.choice([250, 300, 350, 500, 750, 1000]) if rng.random() < 0.3 else logu(rng, 0.01, 2000, 3)
    else:
        v = logu(rng, 0.01, 100000, rng.choice([3, 4, 0]))
    return {'from': frm, 'value': v}


# ---------------------------------------------------------------- hand-typed edge cases
def vdrop_edges(rng):
    base = dict(EX.E1)
    out = []

    def add(name, inp, *tags):
        out.append(case(f'vdrop-edge-{name}', 'vdrop', inp, ('edge',) + tags))

    for meth in ('M1', 'M2', 'M3'):
        add(f'E1-{meth}', {**base, 'method': meth}, 'disagree')
    add('zero-length', {**base, 'length': m(0)})
    add('negative-length', {**base, 'length': m(-5)})
    add('zero-current', {**base, 'current': 0})
    add('negative-voltage', {**base, 'voltage': -230})
    add('voltage-string', {**base, 'voltage': 'abc'})
    add('voltage-missing', {k: v for k, v in base.items() if k != 'voltage'})
    add('huge-current', {**base, 'current': 20000, 'size': {'value': 300, 'unit': 'mm2'}, 'parallel': 4})
    add('current-at-10000', {**base, 'current': 10000})
    add('huge-length', {**base, 'length': m(20000)})
    add('length-at-10000', {**base, 'length': m(10000)})
    add('huge-length-ft', {**base, 'length': m(40000, 'ft')})
    add('huge-power', {**{k: v for k, v in base.items() if k != 'current'}, 'system': 'ac3', 'voltage': 400,
                       'power': 1e7})
    add('material-unsupported', {**base, 'material': 'cuzn'})
    add('awg-minus4', {**base, 'size': {'value': -4, 'unit': 'awg'}})
    add('awg-41', {**base, 'size': {'value': 41, 'unit': 'awg'}})
    add('awg-12.5', {**base, 'size': {'value': 12.5, 'unit': 'awg'}})
    for g in (-3, 40, 0):
        add(f'awg-{g}', {**base, 'size': {'value': g, 'unit': 'awg'}})
    add('size-0.5', {**base, 'size': mm2(0.5), 'current': 1})
    add('size-300', {**base, 'size': mm2(300), 'length': m(800), 'current': 250})
    add('size-zero', {**base, 'size': mm2(0)})
    add('size-unit-bad', {**base, 'size': {'value': 1.5, 'unit': 'in2'}})
    add('length-unit-bad', {**base, 'length': {'value': 18, 'unit': 'yd'}})
    add('cos-0', {**base, 'cosPhi': 0}, 'probe:cos0-code')
    add('cos-1.2', {**base, 'cosPhi': 1.2})
    add('cos-negative', {**base, 'cosPhi': -0.5}, 'probe:cosneg-code')
    add('cos-0.5', {**base, 'cosPhi': 0.5})
    add('cos-1', {**base, 'cosPhi': 1})
    add('eta-0', {**{k: v for k, v in base.items() if k != 'current'}, 'power': 3680, 'efficiency': 0},
        'probe:eta0-code')
    add('eta-1.1', {**{k: v for k, v in base.items() if k != 'current'}, 'power': 3680, 'efficiency': 1.1})
    add('eta-0.5', {**{k: v for k, v in base.items() if k != 'current'}, 'power': 3680, 'efficiency': 0.5})
    add('parallel-0', {**base, 'parallel': 0})
    add('parallel-1.5', {**base, 'parallel': 1.5})
    for n in (1, 2, 3, 4):
        add(f'parallel-{n}', {**base, 'parallel': n})
    add('current-and-power', {**base, 'power': 3680})
    add('neither-current-power', {k: v for k, v in base.items() if k != 'current'}, 'probe:neither-code')
    add('eta-with-current', {**base, 'efficiency': 0.5}, 'probe:eta-with-current')
    add('dc-cos-ignored', {**base, 'system': 'dc', 'voltage': 24, 'cosPhi': 0.5})
    add('dc-cos-invalid-ignored', {**base, 'system': 'dc', 'voltage': 24, 'cosPhi': 5}, 'probe:dc-cos-invalid')
    add('dc-reactance-ignored', {**base, 'system': 'dc', 'voltage': 48, 'reactanceOhmPerM': 0.001, 'method': 'M2'})
    for pid, (pct, _) in O.PRESETS.items():
        add(f'preset-{pid}', {**base, 'limitPreset': pid, 'limitPercent': float(pct)})
    add('preset-mismatch', {**base, 'limitPreset': 'din18015-1', 'limitPercent': 4})
    add('preset-unknown', {**base, 'limitPreset': 'nec-3', 'limitPercent': 3})
    add('limit-0', {**base, 'limitPercent': 0}, 'probe:limit0-code')
    add('limit-100', {**base, 'limitPercent': 100})
    add('limit-101', {**base, 'limitPercent': 101})
    add('limit-missing', {k: v for k, v in base.items() if k != 'limitPercent'})
    add('reactance-negative', {**base, 'reactanceOhmPerM': -0.0001, 'method': 'M2'})
    add('reactance-zero', {**base, 'reactanceOhmPerM': 0, 'method': 'M3', 'cosPhi': 0.8})
    add('m1-ignores-user-reactance', {**base, 'reactanceOhmPerM': 0.01, 'cosPhi': 0.8})
    add('kappa-zero', {**base, 'kappa': 0, 'method': 'M3'})
    add('temp-minus300', {**base, 'conductorTempC': -300, 'method': 'M2'})
    add('temp-minus300-m1', {**base, 'conductorTempC': -300}, 'probe:temp-invalid-other-method')
    add('xlpe', {**base, 'insulation': 'xlpe', 'method': 'M2'})
    add('insulation-bad', {**base, 'insulation': 'rubber', 'method': 'M2'})
    add('method-bad', {**base, 'method': 'M4'})
    add('system-bad', {**base, 'system': 'ac2'})
    add('al-m2', {**base, 'material': 'al', 'size': mm2(2.5), 'method': 'M2'})
    add('kcmil-input', {**base, 'system': 'ac3', 'voltage': 400, 'current': 300, 'size': {'value': 500, 'unit': 'kcmil'},
                        'length': m(150)})
    add('ft-awg-m2', dict(EX.CASES[16][2]))
    # no standard size meets the limit (metric and AWG)
    add('no-size-metric', {**base, 'length': m(3000), 'current': 63})
    add('no-size-awg', {**base, 'length': m(3000), 'current': 63, 'size': {'value': 10, 'unit': 'awg'}})
    add('min-size-smallest', {**base, 'current': 0.5, 'length': m(5)})
    add('min-size-awg40', {**base, 'current': 0.01, 'length': m(1), 'size': {'value': 30, 'unit': 'awg'}})
    add('min-size-awg4/0', {**base, 'current': 200, 'length': m(150), 'size': {'value': 2, 'unit': 'awg'}})
    # exact boundaries: length = L_max (D37 tolerance must say "within")
    for i, (meth, sizev) in enumerate([('M1', 1.5), ('M2', 2.5), ('M3', 4), ('M1', 6)]):
        inp = {**base, 'method': meth, 'size': mm2(sizev), 'cosPhi': 0.9}
        lmax = O.compute('vdrop', inp)['values']['lMax']
        add(f'at-lmax-{i}', {**inp, 'length': m(float(lmax))}, 'boundary')
    # exact rational tie: Δu % = limit exactly (M3, cos 1: u = 2·L·I/(κ·S))
    add('exact-tie', {**base, 'method': 'M3', 'kappa': 50, 'length': m(23), 'current': 10, 'size': mm2(4),
                      'voltage': 230, 'limitPercent': 1}, 'boundary')
    # every "methods disagree" pattern (verdicts M1/M2/M3), found by seeded search, once per selected method
    seen = {}
    srng = random.Random(SEED + 99)
    while len(seen) < 18:
        meth = srng.choice(['M1', 'M2', 'M3'])
        inp = rand_vdrop(srng, meth)
        inp['method'] = meth
        res = O.compute('vdrop', inp)
        if not res['ok']:
            continue
        lim = res['values']['limit']
        pattern = ''.join('w' if O.leq(res['values']['percent' + k], lim) else 'x' for k in ('M1', 'M2', 'M3'))
        if pattern in ('www', 'xxx'):
            continue
        key = (pattern, meth)
        if key not in seen:
            seen[key] = inp
    for (pattern, meth), inp in sorted(seen.items()):
        add(f'disagree-{pattern}-{meth}', inp, 'disagree')
    return out


def mm2(v):
    return {'value': v, 'unit': 'mm2'}


def other_edges():
    out = []

    def add(kind, name, inp, *tags):
        out.append(case(f'{kind}-edge-{name}', kind, inp, ('edge',) + tags))

    # current
    add('current', 'dc-cos-ignored', {'system': 'dc', 'voltage': 24, 'power': 480, 'cosPhi': 0.5})
    add('current', 'cos-0.5', {'system': 'ac1', 'voltage': 230, 'power': 1000, 'cosPhi': 0.5})
    add('current', 'eta-0.5', {'system': 'ac3', 'voltage': 400, 'power': 1000, 'cosPhi': 0.8, 'efficiency': 0.5})
    add('current', 'huge-current', {'system': 'ac1', 'voltage': 230, 'current': 20000})
    add('current', 'huge-power', {'system': 'ac3', 'voltage': 400, 'power': 1e8, 'cosPhi': 0.9})
    add('current', 'at-10000', {'system': 'ac1', 'voltage': 230, 'current': 10000})
    add('current', 'both', {'system': 'ac1', 'voltage': 230, 'current': 16, 'power': 3680})
    add('current', 'neither', {'system': 'ac1', 'voltage': 230}, 'probe:neither-code')
    add('current', 'zero-voltage', {'system': 'ac1', 'voltage': 0, 'current': 16})
    add('current', 'cos-1.5', {'system': 'ac1', 'voltage': 230, 'current': 16, 'cosPhi': 1.5})
    add('current', 'eta-2', {'system': 'ac1', 'voltage': 230, 'power': 16, 'efficiency': 2})
    add('current', 'system-bad', {'system': 'ac2', 'voltage': 230, 'current': 16})
    add('current', 'E7', dict(EX.CASES[17][2]))
    # ohm
    exact = {'voltage': 230, 'current': 10, 'resistance': 23, 'power': 2300}
    keys = list(exact)
    for i in range(4):
        for j in range(i + 1, 4):
            add('ohm', f'{keys[i]}-{keys[j]}', {keys[i]: exact[keys[i]], keys[j]: exact[keys[j]]})
    add('ohm', 'three', {'voltage': 230, 'current': 10, 'resistance': 23}, )
    add('ohm', 'one', {'voltage': 230})
    add('ohm', 'none', {})
    add('ohm', 'zero', {'voltage': 0, 'current': 10})
    add('ohm', 'negative', {'voltage': 230, 'resistance': -1})
    add('ohm', 'string', {'voltage': 'x', 'resistance': 1})
    add('ohm', 'huge-current', {'voltage': 1, 'resistance': 0.00001}, 'probe:ohm-range-current')
    # coord
    mcb = lambda c, n: {'type': 'mcb', 'curve': c, 'ratedCurrent': n}  # noqa: E731
    t = lambda iz: {'izA': iz, 'insulationMaxC': 70, 'referenceAmbientC': 30}  # noqa: E731
    add('coord', 'E3', dict(EX.CASES[6][2]))
    add('coord', 'all-equal', {'ib': 16, 'device': mcb('B', 16), 'table': t(16)}, 'boundary')
    add('coord', 'c3-tie-other', {'ib': 10, 'device': {'type': 'other', 'ratedCurrent': 16, 'i2': 29},
                                  'izTyped': 20, 'insulationMaxC': 70, 'referenceAmbientC': 30}, 'boundary')
    add('coord', 'ambient-eq-max', {'ib': 10, 'device': mcb('B', 16), 'table': t(20), 'ambientC': 70})
    add('coord', 'ambient-above-max', {'ib': 10, 'device': mcb('B', 16), 'table': t(20), 'ambientC': 80})
    add('coord', 'reference-eq-max', {'ib': 10, 'device': mcb('B', 16),
                                      'table': {'izA': 20, 'insulationMaxC': 70, 'referenceAmbientC': 70},
                                      'ambientC': 30})
    add('coord', 'ftheta-too-big', {'ib': 10, 'device': mcb('B', 16), 'table': t(20), 'ambientC': -60})
    add('coord', 'ftheta-at-ref', {'ib': 10, 'device': mcb('B', 16), 'table': t(20), 'ambientC': 30})
    add('coord', 'ftheta-typed-overrides', {'ib': 10, 'device': mcb('B', 16), 'table': t(20), 'ambientC': 40,
                                            'fTheta': 0.9})
    add('coord', 'fgroup-0', {'ib': 10, 'device': mcb('B', 16), 'table': t(20), 'fGroup': 0})
    add('coord', 'fgroup-1.6', {'ib': 10, 'device': mcb('B', 16), 'table': t(20), 'fGroup': 1.6})
    add('coord', 'fgroup-1.5', {'ib': 10, 'device': mcb('B', 16), 'table': t(20), 'fGroup': 1.5})
    add('coord', 'fother-negative', {'ib': 10, 'device': mcb('B', 16), 'table': t(20), 'fOther': -1})
    add('coord', 'both-iz-sources', {'ib': 10, 'device': mcb('B', 16), 'table': t(20), 'izTyped': 20})
    add('coord', 'no-iz-source', {'ib': 10, 'device': mcb('B', 16)})
    add('coord', 'rating-15', {'ib': 10, 'device': mcb('B', 15), 'table': t(20)})
    add('coord', 'curve-K', {'ib': 10, 'device': mcb('K', 16), 'table': t(20)})
    add('coord', 'device-type-bad', {'ib': 10, 'device': {'type': 'fuse', 'ratedCurrent': 16}, 'table': t(20)})
    add('coord', 'ib-zero', {'ib': 0, 'device': mcb('B', 16), 'table': t(20)})
    add('coord', 'iz-zero', {'ib': 10, 'device': mcb('B', 16), 'table': t(0)})
    add('coord', 'ib-huge', {'ib': 20000, 'device': mcb('D', 125), 'table': t(30000)})
    add('coord', 'no-rating-iz-below-ib', {'ib': 20, 'device': mcb('C', 25), 'table': t(18)})
    add('coord', 'no-rating-ib-above-125', {'ib': 130, 'device': mcb('C', 125), 'table': t(300)})
    add('coord', 'suggest-6', {'ib': 1, 'device': mcb('C', 10), 'table': t(7)})
    add('coord', 'suggest-125', {'ib': 120, 'device': mcb('D', 125), 'table': t(125)}, 'boundary')
    add('coord', 'other-device', {'ib': 30, 'device': {'type': 'other', 'ratedCurrent': 35, 'i2': 56},
                                  'izTyped': 40, 'insulationMaxC': 90, 'referenceAmbientC': 30, 'ambientC': 45})
    add('coord', 'other-zero-i2', {'ib': 30, 'device': {'type': 'other', 'ratedCurrent': 35, 'i2': 0},
                                   'izTyped': 40, 'insulationMaxC': 90, 'referenceAmbientC': 30})
    add('coord', 'typed-ftheta-ambient-above-max', {'ib': 10, 'device': mcb('B', 16), 'table': t(20), 'ambientC': 80,
                                                    'fTheta': 0.9}, 'probe:typed-ftheta-ambient')
    add('coord', 'iztyped-no-temps', {'ib': 10, 'device': mcb('B', 16), 'izTyped': 20}, 'probe:iztyped-no-temps')
    add('coord', 'iztyped-no-temps-ambient', {'ib': 10, 'device': mcb('B', 16), 'izTyped': 20, 'ambientC': 40},
        'probe:iztyped-no-temps')
    add('coord', 'other-no-rating', {'ib': 50, 'device': {'type': 'other', 'ratedCurrent': 35, 'i2': 56},
                                     'izTyped': 30, 'insulationMaxC': 70, 'referenceAmbientC': 30})
    # loop
    E4 = dict(EX.E4)
    add('loop', 'E4', E4)
    add('loop', 'ze-equals-zsmax', {**E4, 'ze': 2.875}, 'boundary')
    add('loop', 'ze-exceeds', {**E4, 'ze': 3})
    add('loop', 'ze-zero', {**E4, 'ze': 0})
    add('loop', 'ze-negative', {**E4, 'ze': -0.1})
    add('loop', 'ze-missing', {k: v for k, v in E4.items() if k != 'ze'})
    add('loop', 'pe-larger', {**E4, 'peSize': mm2(2.5)})
    add('loop', 'pe-smaller-al', {**E4, 'material': 'al', 'lineSize': mm2(16), 'peSize': mm2(10)})
    add('loop', 'awg', {**E4, 'lineSize': {'value': 12, 'unit': 'awg'}, 'peSize': {'value': 14, 'unit': 'awg'}})
    add('loop', 'huge-length', {**E4, 'length': m(20000), 'ze': 0})
    add('loop', 'cmin-0.95', {**E4, 'cmin': 0.95})
    add('loop', 'cmin-1.1', {**E4, 'cmin': 1.1})
    add('loop', 'cmin-0', {**E4, 'cmin': 0}, 'probe:cmin0-code')
    add('loop', 'curve-D', {**E4, 'device': mcb('D', 32)})
    add('loop', 'other-device', {**E4, 'device': {'type': 'other', 'ia': 160}})
    add('loop', 'rating-17', {**E4, 'device': mcb('B', 17)})
    add('loop', 'temp-minus300', {**E4, 'loopTempC': -300})
    add('loop', 'mode-bad', {**E4, 'mode': 'guessed'})
    meas = {'mode': 'measured', 'zsMeasured': 1.80, 'device': mcb('B', 16)}
    add('loop', 'measured-E4', meas)
    add('loop', 'measured-at-limit', {**meas, 'zsMeasured': 1.9166666666666667}, 'boundary')
    add('loop', 'measured-k0.8', {**meas, 'measuredFactor': 0.8})
    add('loop', 'measured-k1', {**meas, 'measuredFactor': 1, 'cmin': 0.95})
    add('loop', 'measured-k1.2', {**meas, 'measuredFactor': 1.2})
    add('loop', 'measured-zero', {**meas, 'zsMeasured': 0})
    add('loop', 'measured-with-cable-fields', {**E4, **meas})
    add('loop', 'measured-other-device', {**meas, 'device': {'type': 'other', 'ia': 100}})
    add('loop', 'calculated-ze-exceeds-ik', {**E4, 'ze': 5, 'length': m(1)})
    # resistance
    add('resistance', 'E5-cu', dict(EX.CASES[11][2]))
    add('resistance', 'E5-al', dict(EX.CASES[12][2]))
    add('resistance', 'temp-20', {'material': 'cu', 'size': mm2(2.5), 'length': m(50), 'temperatureC': 20})
    add('resistance', 'temp-minus300', {'material': 'cu', 'size': mm2(2.5), 'length': m(50), 'temperatureC': -300})
    add('resistance', 'temp-minus228-al', {'material': 'al', 'size': mm2(16), 'length': m(50), 'temperatureC': -228.2})
    add('resistance', 'huge-length', {'material': 'al', 'size': mm2(240), 'length': m(50000)})
    add('resistance', 'pe-different', {'material': 'cu', 'size': mm2(16), 'length': m(30), 'peSize': mm2(10)})
    add('resistance', 'pe-same', {'material': 'cu', 'size': mm2(16), 'length': m(30), 'peSize': mm2(16)})
    add('resistance', 'parallel-4-pe', {'material': 'cu', 'size': mm2(240), 'length': m(30), 'parallel': 4,
                                        'peSize': mm2(120)})
    add('resistance', 'material-bad', {'material': 'fe', 'size': mm2(2.5), 'length': m(50)})
    add('resistance', 'awg-4/0-ft', {'material': 'cu', 'size': {'value': -3, 'unit': 'awg'},
                                     'length': m(100, 'ft')})
    add('resistance', 'zero-length', {'material': 'cu', 'size': mm2(2.5), 'length': m(0)})
    add('resistance', 'awg-41', {'material': 'cu', 'size': {'value': 41, 'unit': 'awg'}, 'length': m(1)})
    # convert
    for g in (-3, -2, -1, 0, 1, 12, 40):
        add('convert', f'awg-{g}', {'from': 'awg', 'value': g})
    add('convert', 'awg-minus4', {'from': 'awg', 'value': -4})
    add('convert', 'awg-41', {'from': 'awg', 'value': 41})
    add('convert', 'awg-12.5', {'from': 'awg', 'value': 12.5})
    add('convert', 'mm2-zero', {'from': 'mm2', 'value': 0})
    add('convert', 'mm2-0.3', {'from': 'mm2', 'value': 0.3}, 'probe:metric-below-0.5')
    add('convert', 'mm2-0.5', {'from': 'mm2', 'value': 0.5})
    add('convert', 'mm2-2.5', {'from': 'mm2', 'value': 2.5})
    add('convert', 'mm2-300', {'from': 'mm2', 'value': 300})
    add('convert', 'mm2-400', {'from': 'mm2', 'value': 400}, 'probe:metric-above-300')
    add('convert', 'mm2-0.001', {'from': 'mm2', 'value': 0.001}, 'probe:metric-below-0.5')
    add('convert', 'kcmil-250', {'from': 'kcmil', 'value': 250})
    for g in (-3, 12, 40):
        add('convert', f'mm2-equals-awg{g}', {'from': 'mm2', 'value': float(O.AWG_AREA[g])}, 'boundary:float')
    add('convert', 'kcmil-negative', {'from': 'kcmil', 'value': -1})
    add('convert', 'ft-0', {'from': 'ft', 'value': 0})
    add('convert', 'ft-1', {'from': 'ft', 'value': 1})
    add('convert', 'm-1', {'from': 'm', 'value': 1})
    add('convert', 'from-bad', {'from': 'inch', 'value': 1})
    add('convert', 'value-missing', {'from': 'm'})
    add('convert', 'kind-unknown', {'from': 'm', 'value': 1})
    out[-1]['kind'] = 'nonsense'
    out[-1]['expect'] = expect('nonsense', {'from': 'm', 'value': 1})
    return out


# ---------------------------------------------------------------- seeded single-fault injection
import copy  # noqa: E402

FAULTS = {
    'vdrop': [('voltage', 0), ('voltage', -1), ('voltage', 'x'), ('voltage', None), ('current', 0),
              ('length.value', 0), ('length.value', 'x'), ('length.unit', 'yd'), ('size.value', 0),
              ('size.unit', 'awg', 'size.value', 41), ('material', 'x'), ('cosPhi', 1.5), ('parallel', 0),
              ('parallel', 2.5), ('limitPercent', 0), ('limitPercent', 150), ('limitPercent', None),
              ('method', 'M9'), ('system', 'x'), ('reactanceOhmPerM', -1), ('kappa', 0), ('efficiency', 1.5),
              ('conductorTempC', -400), ('insulation', 'x'), ('limitPreset', 'din18015-1')],
    'current': [('voltage', 0), ('voltage', 'x'), ('power', -5), ('current', 0), ('cosPhi', 2),
                ('efficiency', 0), ('efficiency', 1.5), ('system', 'x'), ('system', None)],
    'ohm': [('voltage', 0), ('current', -1), ('resistance', 'x'), ('power', 0), ('extra', None)],
    'coord': [('ib', 0), ('ib', -1), ('ib', 'x'), ('device.ratedCurrent', 7), ('device.curve', 'Z'),
              ('device.type', 'x'), ('table.izA', 0), ('izTyped', 0), ('fGroup', 2), ('fOther', 0),
              ('fTheta', 1.6), ('ambientC', 95), ('both', None)],
    'loop': [('u0', 0), ('ze', -1), ('cmin', 1.5), ('device.ratedCurrent', 7), ('device.ia', 0),
             ('zsMeasured', 0), ('measuredFactor', 0), ('lineSize.value', 0), ('peSize.value', 'x'),
             ('length.value', 0), ('material', 'x'), ('loopTempC', -500), ('mode', 'x')],
    'resistance': [('material', 'x'), ('size.value', 0), ('length.value', -1), ('temperatureC', -500),
                   ('parallel', 0), ('peSize.value', 0), ('size.unit', 'x')],
    'convert': [('value', 0), ('value', -1), ('value', 'x'), ('value', None), ('awg', 50), ('from', 'x')],
}


def _set(d, path, val):
    keys = path.split('.')
    for k in keys[:-1]:
        if not isinstance(d.get(k), dict):
            return False
        d = d[k]
    if val is None:
        d.pop(keys[-1], None)
    else:
        d[keys[-1]] = val
    return True


def inject(rng, kind, inp):
    inp = copy.deepcopy(inp)
    f = rng.choice(FAULTS[kind])
    if kind == 'ohm' and f[0] == 'extra':
        for k in ('voltage', 'current', 'resistance', 'power'):
            if k not in inp:
                inp[k] = 1.0
                break
        return inp
    if kind == 'ohm':
        k = rng.choice(sorted(inp))
        inp[k] = f[1]
        return inp
    if kind == 'coord' and f[0] == 'both':
        inp['izTyped'] = 20
        inp['table'] = {'izA': 20, 'insulationMaxC': 70, 'referenceAmbientC': 30}
        return inp
    if kind == 'convert' and f[0] == 'awg':
        return {'from': 'awg', 'value': 50}
    for i in range(0, len(f), 2):
        _set(inp, f[i], f[i + 1])
    return inp


# ---------------------------------------------------------------- build all files
def build():
    rng = random.Random(SEED)
    files = {k: [] for k in O.KINDS}
    for meth in ('M1', 'M2', 'M3'):
        for i in range(N_PER_KIND):
            files['vdrop'].append(case(f'vdrop-{meth}-{i}', 'vdrop', rand_vdrop(rng, meth)))
    gens = {'current': rand_current, 'ohm': rand_ohm, 'coord': rand_coord, 'loop': rand_loop,
            'resistance': rand_resistance, 'convert': rand_convert}
    for kind, g in gens.items():
        for i in range(N_PER_KIND):
            files[kind].append(case(f'{kind}-{i}', kind, g(rng)))
    frng = random.Random(SEED + 7)
    for kind, g in [('vdrop', lambda r: rand_vdrop(r, r.choice(['M1', 'M2', 'M3'])))] + list(gens.items()):
        for i in range(N_FAULTS):
            files[kind].append(case(f'{kind}-fault-{i}', kind, inject(frng, kind, g(frng)), ('fault',)))
    files['vdrop'] += vdrop_edges(rng)
    for c in other_edges():
        files[c['kind'] if c['kind'] in files else 'convert'].append(c)
    ex = []
    for cid, kind, inp, exp in EX.CASES:
        ex.append({'id': cid, 'kind': kind, 'input': inp, 'spec': exp, 'expect': expect(kind, inp)})
    files['examples'] = ex
    return {name: dump(cases) for name, cases in files.items()}


def dump(cases):
    return '[\n' + ',\n'.join(json.dumps(c, ensure_ascii=False, separators=(',', ':')) for c in cases) + '\n]\n'


def main():
    check = '--check' in sys.argv
    if EX.main() != 0:
        print('oracle disagrees with SPEC §8 — fix the oracle first')
        return 1
    out = build()
    bad = 0
    for name, text in out.items():
        p = OUT / f'{name}.json'
        if check:
            if not p.exists() or p.read_text() != text:
                print(f'{p.name}: would change')
                bad += 1
        else:
            OUT.mkdir(parents=True, exist_ok=True)
            p.write_text(text)
        n = text.count('\n') - 2
        print(f'{name}: {n} cases')
    if check:
        print('check: ' + ('identical' if not bad else f'{bad} file(s) differ'))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
