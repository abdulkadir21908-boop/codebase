@echo off
rem Run a Sigma program:  math.cmd examples\hello.m
rem Or start the REPL:    math.cmd repl
if "%~1"=="" (
    python "%~dp0sigma.py" repl
) else (
    python "%~dp0sigma.py" %*
)