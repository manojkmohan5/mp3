/*
 * Connect all of your endpoints together here.
 */
module.exports = function (app, router) {
    // All routes share one router, mounted once under /api
    require('./users.js')(router);
    require('./tasks.js')(router);
    app.use('/api', require('./home.js')(router));
};
