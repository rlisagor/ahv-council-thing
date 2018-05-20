const fs = require('fs');
exports.readJsonFile = function (fileName) {
    let rawdata = fs.readFileSync(fileName);
    return JSON.parse(rawdata.toString());
}

exports.readTextFile = function (fileName) {
    return fs.readFileSync(fileName).toString();
}