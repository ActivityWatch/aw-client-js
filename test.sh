#!/bin/bash

# if something is already running on port 5666, assume server already running
if lsof -Pi :5666 -sTCP:LISTEN -t >/dev/null ; then
    echo "aw-server already running on port 5666"
else
    SERVER_STARTED=1
    aw-server --testing --storage=memory &> /dev/null &
    AWPID=$!

    # Give aw-server some time to start
    sleep 5
fi

# Run tests
mocha ./out/test/*.js
EXITCODE=$?

if [ $SERVER_STARTED ]; then
    # Shutdown AW
    kill $AWPID
fi

exit $EXITCODE
