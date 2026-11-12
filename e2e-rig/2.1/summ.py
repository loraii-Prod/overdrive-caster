import json,sys
for lab in sys.argv[1:]:
    o=json.load(open(f'/tmp/fc_{lab}.json'))
    bg=sorted(g for _,g,_ in o[:5])[2]
    bad=[(t,g) for t,g,b in o if g>bg+0.02]
    runs=[];cur=None
    for i,(t,g,b) in enumerate(o):
        if g>bg+0.02:
            if cur is None: cur=[t,t,g]
            else: cur[1]=t; cur[2]=max(cur[2],g)
        elif cur: runs.append(cur); cur=None
    if cur: runs.append(cur)
    print(f"{lab}: {len(o)} frames, {len(bad)} frames with >2% transparent/empty area; events:", ", ".join(f"{a:.2f}-{b:.2f}s (max {m*100:.0f}% of frame empty)" for a,b,m in runs) or "none")
