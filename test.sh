#!/bin/bash
aw-server --testing --storage=memory &> /dev/null &
AWPID=$!
sleep 5; mocha
kill $AWPID
