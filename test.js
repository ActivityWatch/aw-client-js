let AWClient = require('./aw-client').AWClient;

let awc = new AWClient();
awc.getBucketInfo("aw-watcher-web-test").then((resp) => {
    console.log(resp.data);
})

awc.getEvents("aw-watcher-web-test", {limit: 1}).then((resp) => {
    console.log(resp.data);
})
