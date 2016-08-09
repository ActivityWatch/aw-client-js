#!/bin/bash
aw-server --testing --storage=memory &
AWPID=$!
sleep 5; mocha
kill $AWPID
