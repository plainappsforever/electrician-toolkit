"""SPEC §8 worked examples E1-E8 reproduced by the oracle (run: python3 oracle/examples.py).

Each expectation is the SPEC's printed text. A printed value passes when the oracle's exact value is
within half a unit of the last printed digit (rounded values) and within rel 1e-9 (A1). Also exported
as cases for the Jest comparator (test/fixtures/oracle/examples.json) so the engine is held to the
same SPEC numbers via the same inputs.
"""
from __future__ import annotations

import sys
from fractions import Fraction as F
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import oracle as O  # noqa: E402


def m(v):
    return {'value': v, 'unit': 'm'}


def mm2(v):
    return {'value': v, 'unit': 'mm2'}


E1 = dict(system='ac1', voltage=230, current=16, length=m(18), material='cu', size=mm2(1.5), cosPhi=1,
          limitPercent=3)
E4 = dict(mode='calculated', u0=230, ze=0.35, material='cu', lineSize=mm2(1.5), peSize=mm2(1.5), length=m(25),
          loopTempC=70, device={'type': 'mcb', 'curve': 'B', 'ratedCurrent': 16}, cmin=1)
E8 = dict(system='ac3', voltage=400, power=50000, cosPhi=0.9, length=m(80), material='cu', size=mm2(16),
          limitPercent=3)

# (id, kind, input, {path: printed string | bool | str}); limits not given by the SPEC are 3 %.
CASES = [
    ('E1-M1', 'vdrop', E1, {'values.r': '0.27', 'values.u': '8.64', 'values.deltaUPercent': '3.7565217391',
                            'values.uEnd': '221.36', 'values.powerLoss': '138.24', 'texts.verdict': 'exceeds',
                            'values.minSize': '2.5', 'values.minSizePercent': '2.2539130435',
                            'values.lMax': '14.375', 'values.percentM2': '3.4441979010',
                            'values.percentM3': '2.9813664596', 'warnings': ['method.disagree']}),
    ('E1-M2', 'vdrop', {**E1, 'method': 'M2', 'conductorTempC': 70},
     {'values.u': '7.9216551724', 'values.deltaUPercent': '3.4441979010', 'texts.verdict': 'exceeds'}),
    ('E1-M3', 'vdrop', {**E1, 'method': 'M3', 'kappa': 56},
     {'values.u': '6.8571428571', 'values.deltaUPercent': '2.9813664596', 'texts.verdict': 'within',
      'warnings': ['method.disagree', 'method.disagree']}),
    ('E2', 'vdrop', dict(system='ac3', voltage=400, power=22000, cosPhi=1, efficiency=1, length=m(30), material='cu',
                         size=mm2(6), method='M1', limitPercent=3),
     {'values.current': '31.7542648054', 'values.u0': '230.9401076759', 'values.u': '3.5723547906',
      'values.deltaUPercent': '1.546875', 'values.deltaULL': '6.1875', 'values.uEnd': '393.8125',
      'values.powerLoss': '340.3125', 'values.lMax': '58.1818181818'}),
    ('E2b', 'vdrop', dict(system='ac1', voltage=230, current=16, length=m(25), material='cu', size=mm2(2.5),
                          cosPhi=0.9, method='M1', limitPercent=3),
     {'values.sinPhi': '0.4358898944', 'values.u': '6.5078969532', 'values.deltaUPercent': '2.8295204145'}),
    ('E2c', 'vdrop', dict(system='dc', voltage=24, current=20, length=m(10), material='cu', size=mm2(6), method='M1',
                          limitPercent=3),
     {'values.u': '1.5', 'values.deltaUPercent': '6.25'}),
    ('E3', 'coord', dict(ib=13, device={'type': 'mcb', 'curve': 'B', 'ratedCurrent': 16},
                         table={'izA': 20.0, 'insulationMaxC': 70, 'referenceAmbientC': 30}, ambientC=35, fGroup=0.8),
     {'values.fTheta': '0.9354143467', 'values.iz': '14.9666295471', 'checks.coord.c1': True,
      'checks.coord.c2': False, 'checks.coord.c3': False, 'values.i2': '23.2', 'values.i2Limit': '21.7016128433',
      'texts.suggestion': 'B13', 'values.suggestedI2': '18.85'}),
    ('E4', 'loop', E4, {'values.rhoTheta': '0.0206293103', 'values.rPrime': '0.0275057471',
                        'values.zs': '1.0376436782', 'values.zsMax': '2.875', 'checks.loop.zs': True,
                        'values.lMax': '91.7989970748', 'values.ik': '221.6560509554', 'values.ia': '80'}),
    ('E4-cmin', 'loop', {**E4, 'cmin': 0.95}, {'values.zsMax': '2.73125', 'values.lMax': '86.5728165483',
                                               'values.ik': '210.5732484076'}),
    ('E4-measured', 'loop', dict(mode='measured', u0=230, zsMeasured=1.80,
                                 device={'type': 'mcb', 'curve': 'B', 'ratedCurrent': 16}),
     {'values.measuredLimit': '1.9166666667', 'checks.loop.measured': True}),
    ('E4b', 'loop', {**E4, 'lineSize': mm2(2.5), 'peSize': mm2(2.5), 'length': m(20),
                     'device': {'type': 'mcb', 'curve': 'C', 'ratedCurrent': 16}},
     {'values.rPrime': '0.0165034483', 'values.zs': '0.6800689655', 'values.zsMax': '1.4375',
      'values.lMax': '65.8953196824'}),
    ('E5-cu', 'resistance', dict(material='cu', size=mm2(2.5), length=m(50)),
     {'values.r20': '0.3448275862', 'values.r': '0.4125862069'}),
    ('E5-al', 'resistance', dict(material='al', size=mm2(16), length=m(100)), {'values.r20': '0.1766534765'}),
    ('E6-awg12', 'convert', dict(**{'from': 'awg'}, value=12),
     {'values.diameterMm': '2.0525253885', 'values.mm2': '3.3087728761'}),
    ('E6-awg4/0', 'convert', dict(**{'from': 'awg'}, value=-3),
     {'values.diameterMm': '11.684', 'values.mm2': '107.2193025770', 'texts.awg': '4/0'}),
    ('E6-kcmil', 'convert', dict(**{'from': 'kcmil'}, value=250), {'values.mm2': '126.6768697744'}),
    ('E6-vdrop', 'vdrop', dict(system='ac1', voltage=120, current=16, length={'value': 50, 'unit': 'ft'},
                               material='cu', size={'value': 12, 'unit': 'awg'}, method='M2', conductorTempC=75,
                               limitPercent=3),
     {'values.u': '3.0904885504', 'values.deltaUPercent': '2.5754071254'}),
    ('E7', 'current', dict(system='ac3', voltage=400, power=7500, cosPhi=0.85, efficiency=0.9),
     {'values.current': '14.1507418919', 'values.apparentPower': '9803.9215686',
      'values.inputPower': '8333.3333333', 'values.reactivePower': '5164.5361534'}),
    ('E7-1ph', 'current', dict(system='ac1', voltage=230, power=3680, cosPhi=1), {'values.current': '16'}),
    ('E8-16', 'vdrop', E8, {'values.current': '80.1875373874', 'values.deltaUPercent': '3.612489',
                            'values.minSize': '25', 'values.minSizePercent': '2.346864'}),
    ('E8-25', 'vdrop', {**E8, 'size': mm2(25)}, {'values.deltaUPercent': '2.346864'}),
    ('E8-2x25', 'vdrop', {**E8, 'size': mm2(25), 'parallel': 2}, {'values.deltaUPercent': '1.1734322105'}),
]


def lookup(res, path):
    head, _, rest = path.partition('.')
    if head == 'warnings':
        return sorted(res['warnings'])
    return res[head].get(rest)


def agrees(exact: F, printed: str) -> bool:
    p = F(printed)
    decimals = len(printed.split('.')[1]) if '.' in printed else 0
    half = F(1, 2 * 10**decimals)
    return abs(exact - p) <= max(half, abs(p) * F(1, 10**9))


def main() -> int:
    bad = 0
    for cid, kind, inp, exp in CASES:
        res = O.compute(kind, inp)
        if not res['ok']:
            print(f'{cid}: oracle error {res["errors"]}')
            bad += 1
            continue
        for path, want in exp.items():
            got = lookup(res, path)
            if isinstance(want, str) and path.startswith('values.'):
                ok = got is not None and agrees(got, want)
                shown = f'{float(got):.12g}' if got is not None else None
            elif path == 'warnings':
                ok = got == sorted(want)
                shown = got
            else:
                ok = got == want
                shown = got
            if not ok:
                bad += 1
                print(f'{cid} {path}: SPEC {want} oracle {shown}')
    n = sum(len(c[3]) for c in CASES)
    print(f'E1-E8: {len(CASES)} cases, {n} expectations, {bad} disagreements')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
