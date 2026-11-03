// Get the packages we need
var express = require('express'),
    router = express.Router(),
    mongoose = require('mongoose');

// Read .env file
require('dotenv').config();

// Create our Express application
var app = express();

// Use environment defined port or 3000
var port = process.env.PORT || 3000;

// Model calls inside connection.transaction() join that transaction, so a failed request changes nothing
mongoose.set('transactionAsyncLocalStorage', true);

// Connect to MongoDB (MONGODB_URI comes from .env locally, or from Render's environment variables)
mongoose.connect(process.env.MONGODB_URI).catch(function (err) { console.error('MongoDB connection error:', err.message); });

// Allow CORS so that backend and frontend could be put on different servers
var allowCrossDomain = function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
    next();
};
app.use(allowCrossDomain);

// Parse URL-encoded and JSON request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Use routes as a module (see index.js)
require('./routes')(app, router);

// Unknown routes get a JSON 404 too
app.use(function (req, res) {
    res.status(404).json({ message: 'Not found', data: {} });
});

// Turn every error into a { message, data } response that hides database details
app.use(function (err, req, res, next) {
    if (err.type) {
        // Rejected by express.json / express.urlencoded, e.g. malformed JSON
        return res.status(err.status || 400).json({ message: 'Invalid request body', data: {} });
    }
    if (err.code === 11000) {
        // The unique email index caught two requests racing for the same email
        return res.status(400).json({ message: 'Email is already used by another user', data: {} });
    }
    if (err.status) {
        return res.status(err.status).json({ message: err.message, data: {} });
    }
    console.error(err);
    res.status(500).json({ message: 'Something went wrong on the server', data: {} });
});

// Start the server
app.listen(port);
console.log('Server running on port ' + port);
