import json
try:
    with open('coverage.json') as f:
        cov = json.load(f)
    print('Total:', cov['totals']['percent_covered_display'], '%')
    for f, d in cov['files'].items():
        pct = float(d['summary']['percent_covered_display'])
        if pct < 90:
            print(f"{f}: {pct}%")
except Exception as e:
    print(e)
