'use strict';

const AWClient = require('./aw-client').AWClient;

var awc = new AWClient();
awc.getBucketInfo("aw-watcher-web-test").then((resp) => {
    console.log(resp.data);
})

awc.getEvents("aw-watcher-web-test", {limit: 1}).then((resp) => {
    console.log(resp.data);
})
