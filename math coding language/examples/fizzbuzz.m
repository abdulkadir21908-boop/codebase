# FizzBuzz, without a single keyword.
#
# Every line is one expression.  count() calls itself, because recursion is the
# only loop mathematics offers, so recursion is every loop there is.

say = (n) =>
  ∆(0) =
    ⧺(
      (mod(n, 15) = 0) ? ⊞(70, 105, 122, 122, 66, 117, 122, 122)
        : (mod(n, 3) = 0) ? ⊞(70, 105, 122, 122)
        : (mod(n, 5) = 0) ? ⊞(66, 117, 122, 122)
        : ⧢(n)
    )
  ∆(0) = ⊞(10)

count = (n) => n > 15 ? ⊘ : (say(n), count(n + 1))

∆(0) = ⊞(99, 111, 117, 110, 116, 32, 102, 114, 111, 109, 32, 49, 32, 116, 111, 32, 49, 53, 10)

count(1)
