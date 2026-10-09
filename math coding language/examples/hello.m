# Sigma: a language made only of mathematics.
#
# Every literal here is a number.  Every operator is one from school.
# Text is a vector of character codes, because Sigma has no strings.
# Get codes for your own text with:  python sigma.py --codes "your text"

∆(0) = ⊞(72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100)
∆(0) = ⊞(33, 10)

# ⧢ turns a number into the characters of its printed form, so this is
# how a Sigma program prints a result.
∆(0) = ⧢(2 + 2)
∆(0) = ⊞(32, 61, 32)
∆(0) = ⧢(5 - 3)
∆(0) = ⊞(10)

# A function is written the way a textbook writes one.  It may name itself,
# and that self-reference is the only loop mathematics offers.
fact = (n) => n < 2 ? 1 : n * fact(n - 1)

∆(0) = ⊞(49, 48, 33, 32, 61, 32)
∆(0) = ⧢( fact(10) )
∆(0) = ⊞(10)

# Some constants.
∆(0) = ⊞(32, 115, 113, 114, 116, 32, 50, 32, 61, 32)
∆(0) = ⧢( sqrt(2), 15 )
∆(0) = ⊞(10)

∆(0) = ⊞(32, 112, 105, 32, 61, 32)
∆(0) = ⧢( π, 6 )
∆(0) = ⊞(10)

# ∫(f, a, b) is the integral of f from a to b, by Simpson's rule.  It comes
# out as 0.333333 and not 1/3, because 1/3 in binary never ends.
∆(0) = ⊞(32, 105, 110, 116, 101, 103, 114, 97, 108, 32, 111, 102, 32, 120, 94, 50, 32, 61, 32)
∆(0) = ⧢( ∫((x) => x^2, 0, 1), 6 )
∆(0) = ⊞(10)

# ∂(f, x) is the derivative of f at x.
∆(0) = ⊞(32, 100, 101, 114, 105, 118, 97, 116, 105, 118, 101, 32, 111, 102, 32, 120, 94, 51, 32, 97, 116, 32, 50, 32, 61, 32)
∆(0) = ⧢( ∂((x) => x^3, 2), 4 )
∆(0) = ⊞(10)