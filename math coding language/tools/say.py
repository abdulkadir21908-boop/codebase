"""Turn Python text into Sigma character-code vectors.

Sigma has no strings, so any literal text in a Sigma program is a vector of
character codes.  This module builds those vectors so example programs can be
written with real words instead of hand-counted numbers.

    from say import q, line, rule
    line("Hello, world")      # ->  \u2206(0) = \u229e(72, 101, ...)

Run directly to inspect one vector:

    python tools/say.py "Hello"
"""
import sys


def q(text):
    """A Sigma vector literal holding `text`."""
    if text == "":
        return "\u229e()"
    return "\u229e(" + ", ".join(str(ord(c)) for c in text) + ")"


NL = q("\n")


def say(text):
    """The statement that prints `text` with no trailing newline."""
    return "\u2206(0) = " + q(text)


def line(text=""):
    """The statement that prints `text` followed by a newline."""
    return "\u2206(0) = " + (q(text + "\n") if text else NL)


def rule(width=60, ch="-"):
    return line(ch * width)


def heading(text):
    return line() + line(text)


if __name__ == "__main__":
    text = " ".join(sys.argv[1:]) or "Hello, world"
    print(say(text))
    print(line("printed with a newline"))