limit = 60

∆(0) = ⊞(80, 114, 105, 109, 101, 115, 32, 117, 110, 100, 101, 114, 32)
∆(0) = ⧢(limit)
∆(0) = ⊞(10)

primes = ∅

collect = (n, acc) =>
  n > limit
    ? acc
    : collect(n + 1, isprime(n) ? ⧺(acc, ⊞(n)) : acc)

primes = collect(2, primes)

# ⊕ one past the end appends.  Note this is still O(n^2) -- every append
# copies the vector -- so it is fine for a range this size and no larger.
count_up = (k, acc) =>
  k > limit
    ? acc
    : count_up(k + 1, ⊕(acc, ⊟(acc) + 1, k))

∆(0) = ⧢( ⊟(count_up(2, ⊞())) )
∆(0) = ⊞(32, 110, 117, 109, 98, 101, 114, 115, 32, 105, 110, 32, 116, 104, 101, 32, 114, 97, 110, 103, 101, 32, 49, 32, 116, 111, 32)
∆(0) = ⧢(limit)
∆(0) = ⊞(10)

∆(0) = ⧢(len(primes))
∆(0) = ⊞(32, 112, 114, 105, 109, 101, 115, 32, 117, 110, 100, 101, 114, 32)
∆(0) = ⧢(limit)
∆(0) = ⊞(58, 10)

show = (v, i) =>
  i > len(v)
    ? ⊘
    : (
        ∆(0) = ⧢(at(v, i))
        ∆(0) = ⊞(32)
        show(v, i + 1)
      )

show(primes, 1)

∆(0) = ⊞(10)

total = 0

accumulate = (v, i) =>
  i > len(v)
    ? total
    : (
        total = total + at(v, i)
        accumulate(v, i + 1)
      )

accumulate(primes, 1)

∆(0) = ⊞(83, 117, 109, 32, 111, 102, 32, 116, 104, 101, 115, 101, 32, 61, 32)
∆(0) = ⧢(total)
∆(0) = ⊞(10)