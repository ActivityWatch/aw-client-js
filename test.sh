#!/bin/bash
aw-server --testing --storage=memory &> /dev/null &
AWPID=$!

sleep 5  # Give some time to start

node test.js
EXITCODE=$?
# TODO Switch back to using mocha
# mocha

kill $AWPID

exit $EXITCODE
