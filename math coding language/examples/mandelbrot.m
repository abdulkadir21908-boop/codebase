# The Mandelbrot set, drawn with nothing but arithmetic.
#
# Complex numbers need no special support here.  A pair ( a , b ) stands for
# a + bi, and multiplying two complex numbers is
#     ( a*a - b*b , 2*a*b )
# so the whole set falls out of z^2 + 0.3 by iteration, and the modulus
#     sqrt(a*a + b*b)
# says when a point has escaped to infinity.

width = 76
height = 23
limit = 60

escape = (a, b, n) =>
  sqrt(a * a + b * b) > 2
    ? n
    : escape(a * a - b * b + 0.3, 2 * a * b, n + 1)

shade = (n) =>
  n >= limit ? ⊞(32)
    : mod(n, 3) = 0 ? ⊞(46)
    : mod(n, 2) = 0 ? ⊞(42)
    : ⊞(35)

pixel = (x, y) =>
  ∆(0) = shade(escape((x - width / 2) / width * 3, (y - height / 2) / height * 1.6, 0))

line_of = (x, y) => (y > height ? ⊘ : (pixel(x, y), line_of(x, y + 1)))

block = (x) => (x > width ? ⊘ : (line_of(x, 1), block(x + 1)))

∆(0) = ⊞(84, 104, 101, 32, 77, 97, 110, 100, 101, 108, 98, 114, 111, 116, 32, 115, 101, 116, 44, 32, 111, 110, 101, 32, 99, 104, 97, 114, 97, 99, 116, 101, 114, 32, 112, 101, 114, 32, 112, 105, 120, 101, 108, 58, 10)

∆(0) = ⊞(10)

(block(1), ∆(0) = ⊞(10))