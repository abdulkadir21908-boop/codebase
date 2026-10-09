#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tests for the Sigma interpreter.

    python sigma.py --test
    python tests/test_sigma.py
"""

import io
import math
import os
import sys
import threading
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import sigma  # noqa: E402


def run(src):
    """Evaluate a Sigma program and return its value.

    Deep Sigma recursion needs a deep native stack, so the work goes on a
    thread with plenty of room -- the same thing sigma.py's main() does."""
    box = {}

    def work():
        try:
            box["value"] = sigma.run_source(src)[0]
        except BaseException as exc:            # reported by the caller
            box["error"] = exc

    try:
        threading.stack_size(64 * 1024 * 1024)
        t = threading.Thread(target=work)
        t.start()
        t.join()
    except (ValueError, RuntimeError, threading.ThreadError):
        work()

    if "error" in box:
        raise box["error"]
    return box["value"]


def text_of(interp):
    """The characters a program wrote."""
    return "".join(chr(int(c)) for c in interp.output)


def out(src, stdin=""):
    """Evaluate a Sigma program and return the characters it wrote."""
    interp = sigma.Interp(stdin=io.StringIO(stdin))
    sigma.run_source(src, interp)
    return text_of(interp)


def items(v):
    """Evaluate and return a vector as a list of Python numbers."""
    result = run(v)
    assert isinstance(result, sigma.Vec), "expected a vector, got %r" % (result,)
    return result.items


class Arithmetic(unittest.TestCase):
    def test_precedence(self):
        self.assertEqual(run("2 + 3 * 4"), 14)
        self.assertEqual(run("2 + 3 * 4 ^ 2"), 50)
        self.assertEqual(run("(2 + 3) * 4"), 20)

    def test_power_is_right_associative(self):
        self.assertEqual(run("2 ^ 3 ^ 2"), 512)      # 2^9, not (2^3)^2

    def test_unary_minus(self):
        self.assertEqual(run("-3 + 1"), -2)
        self.assertEqual(run("3 - -2"), 5)
        self.assertEqual(run("2 ^ -1"), 0.5)

    def test_division_by_zero(self):
        self.assertEqual(run("1 / 0"), sigma.INF)
        self.assertEqual(run("-1 / 0"), -sigma.INF)
        self.assertTrue(math.isnan(run("0 / 0")))

    def test_numbers(self):
        self.assertEqual(run("1_000_000"), 1000000)
        self.assertEqual(run("1.5e2"), 150)
        self.assertEqual(run(".5"), 0.5)
        self.assertEqual(run("2 ^ 10"), 1024)


class Comparison(unittest.TestCase):
    def test_tests_return_one_or_zero(self):
        self.assertEqual(run("1 < 2"), 1)
        self.assertEqual(run("2 < 1"), 0)
        self.assertEqual(run("1 ≤ 1"), 1)
        self.assertEqual(run("3 ≥ 4"), 0)

    def test_ascii_spellings(self):
        self.assertEqual(run("2 <= 2"), 1)
        self.assertEqual(run("2 >= 3"), 0)

    def test_not_equal(self):
        self.assertEqual(run("3 ≠ 4"), 1)
        self.assertEqual(run("3 != 4"), 1)
        self.assertEqual(run("3 ≠ 3"), 0)

    def test_approx(self):
        self.assertEqual(run("1 ≈ 1.0000000001"), 1)
        self.assertEqual(run("1 ≈ 1.1"), 0)

    def test_logic(self):
        self.assertEqual(run("(1 < 2) ∧ (2 < 3)"), 1)
        self.assertEqual(run("(1 < 2) ∧ (3 < 2)"), 0)
        self.assertEqual(run("(1 > 2) ∨ (2 < 3)"), 1)
        self.assertEqual(run("¬(1 < 2)"), 0)      # 1 < 2 is true, so ¬ is 0
        self.assertEqual(run("¬(3 < 2)"), 1)
        self.assertEqual(run("!0"), 1)

    def test_ascii_logic(self):
        self.assertEqual(run("(1 < 2) & (2 < 3)"), 1)
        self.assertEqual(run("(1 > 2) | (2 < 3)"), 1)

    def test_equals_defines_and_compares(self):
        self.assertEqual(run("x = 5"), 5)             # definition
        self.assertEqual(run("(2 + 3 = 5)"), 1)       # test
        self.assertEqual(run("(2 + 3 = 6)"), 0)


class Names(unittest.TestCase):
    def test_definition(self):
        self.assertEqual(run("x = 5\nx * 2"), 10)

    def test_chained_definition(self):
        self.assertEqual(run("a = 1\nb = a + 1\nb"), 2)

    def test_redefinition(self):
        self.assertEqual(run("x = 1\nx = x + 5\nx"), 6)

    def test_undefined_is_an_error(self):
        with self.assertRaises(sigma.SigmaError):
            run("nowhere + 1")

    def test_assignment_inside_brackets_is_a_test(self):
        self.assertEqual(run("(n = 1) ? 10 : 20"), 10)


class Functions(unittest.TestCase):
    def test_lambda(self):
        self.assertEqual(run("((x) => x * 2)(21)"), 42)

    def test_immediate_call(self):
        self.assertEqual(run("((x) => x + 1)(41)"), 42)

    def test_two_parameters(self):
        self.assertEqual(run("((a, b) => a * b)(6, 7)"), 42)

    def test_recursion(self):
        self.assertEqual(run("f = (n) => n < 2 ? 1 : n * f(n - 1)\nf(10)"),
                         math.factorial(10))

    def test_mutual_recursion_via_one_name(self):
        self.assertEqual(run("f = (n) => n < 2 ? n : f(n - 1) + f(n - 2)\nf(20)"),
                         6765)

    def test_closures_see_later_values(self):
        self.assertEqual(run("y = 10\nf = (x) => x + y\ny = 5\nf(1)"), 6)

    def test_wrong_arity_is_an_error(self):
        with self.assertRaises(sigma.SigmaError):
            run("f = (a, b) => a + b\nf(1)")

    def test_not_a_function_is_an_error(self):
        with self.assertRaises(sigma.SigmaError):
            run("5(1)")


class Constants(unittest.TestCase):
    def test_mathematical_constants(self):
        self.assertAlmostEqual(run("π"), math.pi)
        self.assertAlmostEqual(run("τ"), math.tau)
        self.assertAlmostEqual(run("ℯ"), math.e)
        self.assertAlmostEqual(run("φ"), (1 + math.sqrt(5)) / 2)
        self.assertEqual(run("∞"), sigma.INF)

    def test_ascii_spellings(self):
        self.assertAlmostEqual(run("pi"), math.pi)
        self.assertAlmostEqual(run("euler"), math.e)

    def test_empty_vector(self):
        self.assertEqual(items("∅"), [])
        self.assertEqual(items("empty"), [])


class Primitives(unittest.TestCase):
    def test_roots(self):
        self.assertAlmostEqual(run("√(2)"), math.sqrt(2))
        self.assertAlmostEqual(run("∛(27)"), 3)
        self.assertAlmostEqual(run("sqrt(9)"), 3)
        self.assertTrue(math.isnan(run("√(-1)")))

    def test_rounding(self):
        self.assertEqual(run("⌊(2.7)"), 2)
        self.assertEqual(run("⌈(2.1)"), 3)
        self.assertEqual(run("round(2.5)"), 2)
        self.assertEqual(run("abs(-3)"), 3)
        self.assertEqual(run("sign(-9)"), -1)

    def test_number_theory(self):
        self.assertEqual(run("gcd(462, 1071)"), 21)
        self.assertEqual(run("lcm(4, 6)"), 12)
        self.assertEqual(run("mod(7, 3)"), 1)
        self.assertEqual(run("mod(-1, 3)"), 2)      # floored, like a mathematician
        self.assertEqual(run("fact(6)"), 720)
        self.assertEqual(run("comb(5, 2)"), 10)
        self.assertEqual(run("isprime(97)"), 1)
        self.assertEqual(run("isprime(98)"), 0)
        self.assertEqual(run("isqrt(50)"), 7)

    def test_trig(self):
        self.assertAlmostEqual(run("sin(0)"), 0)
        self.assertAlmostEqual(run("cos(0)"), 1)
        self.assertAlmostEqual(run("ln(ℯ)"), 1)

    def test_min_max_variadic(self):
        self.assertEqual(run("min(3, 1, 2)"), 1)
        self.assertEqual(run("max(3, 1, 2)"), 3)
        self.assertEqual(run("clamp(9, 0, 5)"), 5)


class Calculus(unittest.TestCase):
    def test_integral(self):
        self.assertAlmostEqual(run("∫((x) => x^2, 0, 1)"), 1 / 3, places=6)
        self.assertAlmostEqual(run("∫((x) => x, 0, 2)"), 2, places=6)
        self.assertAlmostEqual(run("int((x) => sin(x), 0, pi)"), 2, places=6)

    def test_derivative(self):
        self.assertAlmostEqual(run("∂((x) => x^3, 2)"), 12, places=5)
        self.assertAlmostEqual(run("diff((x) => sin(x), 0)"), 1, places=5)

    def test_sum_and_product(self):
        self.assertEqual(run("∑((k) => k, 10)"), 55)
        self.assertEqual(run("Σ((k) => k, 1, 10)"), 55)
        self.assertAlmostEqual(run("∑((k) => 1/k^2, 100000)"),
                               math.pi ** 2 / 6, places=4)
        self.assertEqual(run("∏((k) => k, 5)"), 120)


class Vectors(unittest.TestCase):
    def test_build_and_length(self):
        self.assertEqual(items("⊞(1, 2, 3)"), [1, 2, 3])
        self.assertEqual(run("⊟(⊞(1, 2, 3))"), 3)
        self.assertEqual(run("len(vec(1, 2, 3))"), 3)

    def test_element_is_one_based(self):
        self.assertEqual(run("⊟(⊞(7, 8, 9), 1)"), 7)
        self.assertEqual(run("⊟(⊞(7, 8, 9), 3)"), 9)
        self.assertEqual(run("⊟(⊞(7, 8, 9), 4)"), -1)     # out of range

    def test_update_is_pure(self):
        self.assertEqual(items("⊕(⊞(1, 2, 3), 2, 99)"), [1, 99, 3])

    def test_slice_locate_sort(self):
        self.assertEqual(items("⊖(⊞(1, 2, 3, 4, 5), 2, 4)"), [2, 3, 4])
        self.assertEqual(items("⊖(⊞(1, 2, 3, 4, 5), 4)"), [4, 5])
        self.assertEqual(run("⌕(⊞(7, 8, 9), 8)"), 2)
        self.assertEqual(run("find(vec(7, 8, 9), 99)"), -1)
        self.assertEqual(items("⊜(⊞(5, 3, 9, 1))"), [1, 3, 5, 9])

    def test_concatenate(self):
        self.assertEqual(items("⧺(⊞(1, 2), ⊞(3))"), [1, 2, 3])
        self.assertEqual(items("cat(vec(1), vec(2), vec(3))"), [1, 2, 3])

    def test_map_and_fold(self):
        self.assertEqual(items("↦((x) => x * 2, ⊞(1, 2, 3))"), [2, 4, 6])
        self.assertEqual(run("⇑((a, b) => a + b, ⊞(1, 2, 3, 4))"), 10)
        self.assertEqual(run("fold((a, b) => a + b, vec(1, 2, 3), 100)"), 106)

    def test_pack_and_unpack_round_trip(self):
        self.assertEqual(items("⇔(⇓(⊞(1, 2, 3)))"), [1, 2, 3])

    def test_vectors_compare(self):
        self.assertEqual(run("⊞(1, 2) = ⊞(1, 2)"), 1)
        self.assertEqual(run("⊞(1, 2) ≠ ⊞(1, 3)"), 1)

    def test_vector_is_not_callable(self):
        with self.assertRaises(sigma.SigmaError):
            run("⊞(1, 2)(3)")


class FrameReuse(unittest.TestCase):
    """A function reuses its scope between calls when nothing can observe the
    difference -- that is the single biggest saving in the interpreter.  These
    check the cases where it must not."""

    def test_a_recursive_function_gets_a_fresh_scope(self):
        self.assertEqual(run("f = (n) => n < 2 ? n : f(n-1) + f(n-2)\nf(20)"), 6765)

    def test_recursion_in_a_second_parameter_position(self):
        self.assertEqual(run("f = (k, acc) => k ≠ 0 ? f(k - 1, acc + k) : acc\n"
                             "f(1000, 0)"), 500500)

    def test_mutual_recursion_between_two_names(self):
        self.assertEqual(run("even = (n) => n ≠ 0 ? odd(n - 1) : 1\n"
                             "odd = (n) => n ≠ 0 ? even(n - 1) : 0\n"
                             "even(10)"), 1)

    def test_a_function_that_returns_a_function_keeps_its_capture(self):
        # adder(n) must remember n after adder has been called again
        self.assertEqual(run("adder = (n) => (x) => x + n\n"
                             "a5 = adder(5)\n"
                             "a7 = adder(7)\n"
                             "a5(1) + a7(1)"), 14)

    def test_a_loop_variable_is_not_shared_between_calls(self):
        self.assertEqual(run("f = (x) => (t = x * 2, t + 1)\n"
                             "f(1) + f(10)"), 24)      # 3 + 21

    def test_counting_upward_does_not_accumulate(self):
        self.assertEqual(run("f = (x) => (t = x * 2, t)\n"
                             "f(3) + f(3) + f(3)"), 18)


class Appending(unittest.TestCase):
    """⊕ may be used one past the end to append.

    This halves the copying a loop that appends does, but it does not remove
    it: vectors are values, so appending still copies.  A long vector is best
    written as one ⊞(...) literal or handed over from Python."""

    def test_append(self):
        self.assertEqual(items("⊕(⊞(1, 2), 3, 99)"), [1, 2, 99])

    def test_append_to_empty(self):
        self.assertEqual(items("⊕(⊞(), 1, 7)"), [7])

    def test_append_in_a_loop(self):
        # Walking down from n, each step appends one past the end.  This is
        # still O(n^2) -- every append copies the vector -- but the constant
        # is one copy rather than the whole vector built twice.
        self.assertEqual(run("b = (k, a) => k ≠ 0 ? b(k - 1, ⊕(a, ⊟(a) + 1, k)) : a\n"
                             "⊟( b(500, ⊞()) )"), 500)

    def test_an_index_inside_the_vector_replaces_rather_than_appends(self):
        # The mistake this guards against: ⊕(a, 1, k) writes index 1 over and
        # over, so the vector never grows and the loop looks fast for the
        # wrong reason.
        self.assertEqual(run("b = (k, a) => k ≠ 0 ? b(k - 1, ⊕(a, 1, k)) : a\n"
                             "⊟( b(500, ⊞()) )"), 1)

    def test_the_values_survive_the_loop(self):
        # walking down from 4, so the vector ends up in reverse
        self.assertEqual(items("b = (k, a) => k ≠ 0 ? b(k - 1, ⊕(a, ⊟(a) + 1, k)) : a\n"
                               "b(4, ⊞())"), [4, 3, 2, 1])

    def test_far_out_of_range_is_still_ignored(self):
        self.assertEqual(items("⊕(⊞(1, 2), 9, 5)"), [1, 2])

    def test_update_in_range_is_unaffected(self):
        self.assertEqual(items("⊕(⊞(1, 2, 3), 1, 9)"), [9, 2, 3])


class FractionalVectors(unittest.TestCase):
    """A vector holds numbers, not whole numbers.  Truncating 0.5 to 0 would
    quietly destroy any work with fractions, weights or averages."""

    def test_build_keeps_fractions(self):
        self.assertEqual(items("⊞(0.5, 1.25, 2.75)"), [0.5, 1.25, 2.75])

    def test_map_keeps_fractions(self):
        self.assertEqual(items("↦((x) => x / 2, ⊞(1, 3))"), [0.5, 1.5])

    def test_update_keeps_fractions(self):
        self.assertEqual(items("⊕(⊞(1, 2), 1, 0.5)"), [0.5, 2])

    def test_locate_finds_a_fraction(self):
        self.assertEqual(run("⌕(⊞(1.5, 2.5), 2.5)"), 2)

    def test_sort_and_fold_keep_fractions(self):
        self.assertEqual(items("⊜(⊞(2.5, 0.5, 1.5))"), [0.5, 1.5, 2.5])
        self.assertEqual(run("⇑((a, b) => a + b, ⊞(0.25, 0.5))"), 0.75)


class Text(unittest.TestCase):
    def test_number_to_characters(self):
        # ⧢ writes the printed form of the number, not a character code
        self.assertEqual(items("⧢(65)"), [ord("6"), ord("5")])
        self.assertEqual(items("⧢(1.5)"), [ord("1"), ord("."), ord("5")])
        self.assertEqual(items("⧢(0)"), [ord("0")])

    def test_decimal_places(self):
        self.assertEqual(items("⧢(1.23456, 2)"), [ord("1"), ord("."), ord("2"), ord("3")])

    def test_codes_helper_matches_language(self):
        self.assertEqual(items("⊞(72, 105)"), [72, 105])
        text = "Hello"
        self.assertEqual(out("∆(0) = ⊞(%s)" % ", ".join(str(ord(c)) for c in text)),
                         text)


class Device(unittest.TestCase):
    def test_write_characters(self):
        self.assertEqual(out("∆(0) = ⊞(72, 105)"), "Hi")

    def test_write_single_character(self):
        self.assertEqual(out("∆(0) = 65"), "A")

    def test_write_returns_the_value(self):
        self.assertEqual(run("∆(0) = 65"), 65)

    def test_read_input(self):
        self.assertEqual(out("∆(0) = ⧢(∆(1))", stdin="A"), "65")
        self.assertEqual(out("∆(0) = ⧢(∆(1))", stdin=""), "-1")

    def test_ports_are_memory(self):
        self.assertEqual(run("∆(10) = 7\n∆(10)"), 7)

    def test_port_zero_only_writes(self):
        with self.assertRaises(sigma.SigmaError):
            run("∆(0)")

    def test_random_port_is_a_number(self):
        value = run("∆(2)")
        self.assertTrue(0 <= value < 1)

    def test_nop(self):
        self.assertEqual(run("⊘"), 0)


class Sequencing(unittest.TestCase):
    def test_statements_end_with_a_newline(self):
        self.assertEqual(out("∆(0) = 65\n∆(0) = 66"), "AB")

    def test_comma_separates_statements(self):
        self.assertEqual(out("∆(0) = 65, ∆(0) = 66"), "AB")

    def test_brackets_group_statements(self):
        self.assertEqual(run("(1 + 1, 2 + 2)"), 4)

    def test_assignment_is_an_expression(self):
        self.assertEqual(run("(x = 5, x * 2)"), 10)


class Lexer(unittest.TestCase):
    def test_quote_is_not_a_character(self):
        with self.assertRaises(sigma.SigmaError) as ctx:
            run("'hello'")
        self.assertIn("not mathematics", str(ctx.exception))

    def test_arbitrary_symbol_is_rejected(self):
        with self.assertRaises(sigma.SigmaError):
            run("2 @ 3")

    def test_comments_are_blanked_out(self):
        self.assertEqual(run("1 + 1 # this is not a comment in Sigma\n"), 2)

    def test_comments_keep_line_numbers(self):
        src = "1\n# a comment\n@"
        with self.assertRaises(sigma.SigmaError) as ctx:
            run(src)
        self.assertIn("line 3", str(ctx.exception))


class Examples(unittest.TestCase):
    """Every example must run cleanly and say something."""

    EXAMPLES = os.path.join(os.path.dirname(HERE), "examples")

    def test_examples_run(self):
        names = sorted(n for n in os.listdir(self.EXAMPLES) if n.endswith(".m"))
        self.assertTrue(names, "no examples found")
        for name in names:
            path = os.path.join(self.EXAMPLES, name)
            with open(path, encoding="utf-8") as fh:
                src = fh.read()
            interp = sigma.Interp(stdin=io.StringIO(""))
            try:
                sigma.run_source(src, interp)
            except sigma.SigmaError as exc:      # pragma: no cover
                self.fail("%s failed: %s" % (name, exc))
            text = text_of(interp)
            self.assertTrue(text.strip(), "%s printed nothing" % name)


if __name__ == "__main__":
    unittest.main(verbosity=2)