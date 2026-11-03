// Load required packages
var mongoose = require('mongoose'),
    User = require('../models/user'),
    Task = require('../models/task'),
    h = require('./helpers');

// POST and PUT: validate the body in the README's order, then write the task and the users' lists together
async function saveTask(task, body) {
    body = body || {};
    var userId = body.assignedUser == null ? '' : body.assignedUser,
        userName = body.assignedUserName == null || body.assignedUserName === '' ? null : body.assignedUserName;

    // 400: missing or malformed fields (PUT replaces the task, so missing ones get their defaults)
    if (!h.isText(body.name)) throw h.error(400, 'Task name is required');
    if (body.description != null && typeof body.description !== 'string') {
        throw h.error(400, 'description must be a string');
    }
    task.set({
        name: body.name,
        description: body.description == null ? '' : body.description,
        deadline: body.deadline,
        completed: body.completed == null ? false : body.completed
    });
    try {
        await task.validate();
    } catch (err) {
        if (!err.errors) throw err;
        throw h.error(400, 'Invalid or missing value for ' + Object.keys(err.errors).join(', '));
    }
    if (userId !== '' && !h.isId(userId)) throw h.error(400, 'assignedUser must be a valid user id');
    if (userName !== null && typeof userName !== 'string') throw h.error(400, 'assignedUserName must be a string');
    if (userId === '' && userName !== null && userName !== 'unassigned') {
        throw h.error(400, 'assignedUserName must be "unassigned" when assignedUser is empty');
    }

    // 404, then 400: the assigned user must exist and match assignedUserName
    var user = userId === '' ? null : await User.findById(userId);
    if (userId !== '' && !user) throw h.error(404, 'The assigned user does not exist');
    if (user && userName !== null && userName !== user.name) {
        throw h.error(400, 'assignedUserName does not match the assigned user');
    }

    var id = task.id,
        owner = user && !task.completed ? user._id : null;
    task.assignedUser = user ? user.id : '';
    task.assignedUserName = user ? user.name : 'unassigned';
    await mongoose.connection.transaction(async function () {
        await task.save();
        // A task is in its own user's pendingTasks while pending, and in no other list
        await User.updateMany({ _id: { $ne: owner }, pendingTasks: id }, { $pull: { pendingTasks: id } });
        if (owner) await User.updateOne({ _id: owner }, { $addToSet: { pendingTasks: id } });
    });
    return task;
}

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');
    var taskRoute = router.route('/tasks/:id');

    tasksRoute.get(async function (req, res) {
        res.status(200).json({ message: 'OK', data: await h.list(Task, req.query, 100) });
    });

    tasksRoute.post(async function (req, res) {
        res.status(201).json({ message: 'Task created', data: await saveTask(new Task(), req.body) });
    });

    taskRoute.get(async function (req, res) {
        res.status(200).json({ message: 'OK', data: await h.findById(Task, req.params.id, req.query) });
    });

    taskRoute.put(async function (req, res) {
        var task = await h.findById(Task, req.params.id);
        res.status(200).json({ message: 'Task updated', data: await saveTask(task, req.body) });
    });

    taskRoute.delete(async function (req, res) {
        var task = await h.findById(Task, req.params.id);
        await mongoose.connection.transaction(async function () {
            await User.updateMany({ pendingTasks: task.id }, { $pull: { pendingTasks: task.id } });
            await task.deleteOne();
        });
        res.status(204).end();
    });

    return router;
};
