---
'@pylinka/graph': patch
---

`W101_CAPACITY_OVERFLOW` covers burst and one-shot emitters, not just `flow`.

Bursts overlap whenever the lifetime outlasts the interval, so 120 particles every 0.5s that live for 2s is 480 alive at the peak — and `capacity` is a hard ceiling the scheduler clamps to, silently. That was the mode most likely to blow the pool and the one mode the check skipped. A one-shot larger than the pool is now flagged too, and the message says outright that the excess is dropped without a word.
