#!/bin/bash
aw-server --testing --storage=memory &> /dev/null &
AWPID=$!

sleep 5  # Give some time to start

node test.js
# TODO Switch back to using mocha
# mocha

kill $AWPID
