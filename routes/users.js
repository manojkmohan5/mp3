// Load required packages
var mongoose = require('mongoose'),
    User = require('../models/user'),
    Task = require('../models/task'),
    h = require('./helpers');

// POST and PUT: validate the body in the README's order, then write the user and its tasks together
async function saveUser(user, body) {
    body = body || {};
    var ids = body.pendingTasks == null ? [] : body.pendingTasks;

    // 400: missing or malformed fields
    if (!h.isText(body.name)) throw h.error(400, 'User name is required');
    if (!h.isText(body.email) || !/^[^\s@]+@[^\s@]+$/.test(body.email)) throw h.error(400, 'A valid email is required');
    if (!Array.isArray(ids) || !ids.every(h.isId)) throw h.error(400, 'pendingTasks must be a list of task ids');
    ids = Array.from(new Set(ids.map(function (id) { return id.toLowerCase(); })));

    // 400: email taken by someone else
    if (await User.exists({ email: body.email, _id: { $ne: user._id } })) {
        throw h.error(400, 'Email is already used by another user');
    }

    // 404, then 400: every listed task must exist and still be pending
    var tasks = await Task.find({ _id: { $in: ids } });
    if (tasks.length < ids.length) throw h.error(404, 'A task in pendingTasks does not exist');
    if (tasks.some(function (task) { return task.completed; })) {
        throw h.error(400, 'A completed task cannot be in pendingTasks');
    }

    var id = user.id;
    user.name = body.name;
    user.email = body.email;
    user.pendingTasks = ids;
    await mongoose.connection.transaction(async function () {
        await user.save();
        // Pending tasks dropped from the list become unassigned
        await Task.updateMany({ assignedUser: id, completed: false, _id: { $nin: ids } },
            { assignedUser: '', assignedUserName: 'unassigned' });
        // Listed tasks leave any other user's list...
        await User.updateMany({ _id: { $ne: id }, pendingTasks: { $in: ids } },
            { $pull: { pendingTasks: { $in: ids } } });
        // ...and, like this user's completed tasks, carry this user's id and current name
        await Task.updateMany({ $or: [{ _id: { $in: ids } }, { assignedUser: id }] },
            { assignedUser: id, assignedUserName: user.name });
    });
    return user;
}

module.exports = function (router) {

    var usersRoute = router.route('/users');
    var userRoute = router.route('/users/:id');

    usersRoute.get(async function (req, res) {
        res.status(200).json({ message: 'OK', data: await h.list(User, req.query) });
    });

    usersRoute.post(async function (req, res) {
        res.status(201).json({ message: 'User created', data: await saveUser(new User(), req.body) });
    });

    userRoute.get(async function (req, res) {
        res.status(200).json({ message: 'OK', data: await h.findById(User, req.params.id, req.query) });
    });

    userRoute.put(async function (req, res) {
        var user = await h.findById(User, req.params.id);
        res.status(200).json({ message: 'User updated', data: await saveUser(user, req.body) });
    });

    userRoute.delete(async function (req, res) {
        var user = await h.findById(User, req.params.id);
        await mongoose.connection.transaction(async function () {
            // All of the user's tasks, completed ones too, become unassigned
            await Task.updateMany({ assignedUser: user.id }, { assignedUser: '', assignedUserName: 'unassigned' });
            await user.deleteOne();
        });
        res.status(204).end();
    });

    return router;
};
