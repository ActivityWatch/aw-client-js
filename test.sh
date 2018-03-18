#!/bin/bash

# Aborts script if any process returns non-zero exitcode
set -e

aw-server --testing --storage=memory &> /dev/null &
AWPID=$!

# Give aw-server some time to start
sleep 5

# Run tests
mocha

# Shutdown AW
kill $AWPID
