let rp = require('request-promise');

let baseaddr = "Undefined";
module.exports.init = init;
function init(addr, port){
    baseaddr = 'http://'+addr+':'+port;
}

// Template API GET request promise
module.exports.get = get;
function get(api){
    let options = {
        method: 'GET',
        uri: baseaddr+api,
        headers: {
            'User-Agent': 'Request-Promise'
        },
        json: true // Automatically parses the JSON string in the response
    };

    return rp(options)
}

// Template API POST request promise
module.exports.post = post;
function post(api, payload){
    let options = {
        method: 'POST',
        uri: baseaddr+api,
        body: payload,
        headers: {
            'User-Agent': 'Request-Promise'
        },
        json: true // Automatically stringifies the body to JSON
    };

    return rp(options)
}
