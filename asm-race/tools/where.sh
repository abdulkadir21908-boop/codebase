#!/bin/bash
# where.sh BIN SYM... -- addresses of the named symbols in a linked binary
cd "$(dirname "$0")/.."
for s in "$@"; do
  nm "$1" | grep -w "$s"
done