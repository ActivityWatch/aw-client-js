#!/bin/bash
aw-server --testing --storage=memory &> /dev/null &
AWPID=$!

# Give aw-server some time to start
sleep 5

# Compile
npm run compile

# Run tests
mocha ./out/test/*.js
EXITCODE=$?

# Shutdown AW
kill $AWPID

exit $EXITCODE
