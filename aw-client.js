let rp = require('request-promise');

let baseaddr = null;

module.exports.init = init;
function init(addr, port){
    baseaddr = 'http://'+addr+':'+port;
}

// Template API GET request promise
module.exports.get = get;
function get(api){
    if (baseaddr == null){
        throw new Error("aw-client has not been initialized!");
    }
    // HTTP request options
    let options = {
        method: 'GET',
        uri: baseaddr+api,
        headers: {
            'User-Agent': 'Request-Promise'
        },
        json: true // Automatically parses the JSON string in the response
    };
    // Return promise
    return rp(options)
}

// Template API POST request promise
module.exports.post = post;
function post(api, payload){
    if (baseaddr == null){
        throw new Error("aw-client has not been initialized!");
    }
    // HTTP request options
    let options = {
        method: 'POST',
        uri: baseaddr+api,
        body: payload,
        headers: {
            'User-Agent': 'Request-Promise'
        },
        json: true // Automatically stringifies the body to JSON
    };
    // Return promise
    return rp(options)
}
