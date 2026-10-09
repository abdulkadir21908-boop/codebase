# The Collatz conjecture: triple-and-add-one for odd n, halve for even n.
# Count the steps each starting value needs to reach 1.

spaces = ⊞(32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32)

steps = (n, count) =>
  n ≠ 1
    ? steps((mod(n, 2) = 0) ? n / 2 : 3 * n + 1, count + 1)
    : count

show = (start, count) => (
  ∆(0) = ⧺(⧺(⧢( start), spaces), ⧢( count))
  ∆(0) = ⊞(32, 115, 116, 101, 112, 115)
  ∆(0) = ⊞(10)
)

∆(0) = ⊞(67, 111, 108, 108, 97, 116, 122, 58, 32, 104, 111, 119, 32, 109, 97, 110, 121, 32, 115, 116, 101, 112, 115, 32, 116, 111, 32, 114, 101, 97, 99, 104, 32, 49, 63, 10)

blank = ∆(0) = ⊞(10)

run = (n) => n > 14 ? ⊘ : (show(n, steps(n, 0)), blank, run(n + 1))

run(1)