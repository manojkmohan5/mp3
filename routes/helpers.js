// Load required packages
var mongoose = require('mongoose');

// An error with an HTTP status; server.js turns it into a { message, data } response
function error(status, message) {
    var err = new Error(message);
    err.status = status;
    return err;
}

// where, sort and select arrive as JSON objects in the query string
function jsonParam(query, name) {
    if (query[name] === undefined) return undefined;
    try {
        var value = JSON.parse(query[name]);
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch (err) {
        // reported below
    }
    throw error(400, name + ' must be a valid JSON object');
}

// skip and limit are whole numbers
function intParam(query, name) {
    if (query[name] === undefined) return undefined;
    var value = Number(query[name]);
    if (!Number.isInteger(value) || value < 0) throw error(400, name + ' must be a non-negative integer');
    return value;
}

// Run a read query. A where value of the wrong type (e.g. a malformed id) can match nothing, so a list
// query gets `empty`; other bad where/sort/select values are the client's fault, so they become 400s
async function read(build, empty) {
    try {
        return await build();
    } catch (err) {
        if (err.name === 'CastError' && empty !== undefined) return empty;
        // Mongoose rejects unknown operators with a plain Error and bad sort values with a TypeError
        if (err.name === 'CastError' || err.name === 'MongoServerError' || err instanceof TypeError || err.constructor === Error) {
            throw error(400, 'where, sort or select contains an invalid value');
        }
        throw err;
    }
}

exports.error = error;

// A 24-character hex id (strings only; numbers and 12-character strings are rejected)
exports.isId = function (value) {
    return mongoose.isObjectIdOrHexString(value);
};

// A string that is not blank
exports.isText = function (value) {
    return typeof value === 'string' && value.trim() !== '';
};

// GET /users and GET /tasks: MongoDB does the filtering, sorting and paging
exports.list = function (Model, query, defaultLimit) {
    var where = jsonParam(query, 'where'),
        sort = jsonParam(query, 'sort'),
        select = jsonParam(query, 'select'),
        skip = intParam(query, 'skip'),
        limit = intParam(query, 'limit'),
        count = query.count === 'true';

    // The default limit pages document lists; a count covers every match
    if (limit === undefined && !count) limit = defaultLimit;

    return read(function () {
        // limit=0 means no limit, as in MongoDB
        var found = Model.find(where).skip(skip).limit(limit || undefined);
        return count ? found.countDocuments() : found.sort(sort).select(select);
    }, count ? 0 : []);
};

// GET, PUT and DELETE on /:id. Malformed and unknown ids are both 404, checked before select
exports.findById = async function (Model, id, query) {
    var doc = exports.isId(id) ? await Model.findById(id) : null,
        select = doc && query && jsonParam(query, 'select');
    if (select) doc = await read(function () { return Model.findById(id).select(select); });
    if (!doc) throw error(404, Model.modelName + ' not found');
    return doc;
};
