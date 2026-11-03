// Self-check of this API against the README and FAQ rules, using only Node built-ins.
// Start the server, then run:  node check.js [base URL]   (default http://localhost:3000)
// It creates its own users and tasks, checks the two-way references after every test,
// and deletes what it created at the end.
var assert = require('node:assert/strict');

var base = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '') + '/api';
var tag = 'check-' + Date.now().toString(36);      // marks this run's users and tasks
var missingId = '5f0000000000000000000000';        // well-formed id that no document has
var seq = 0, passed = 0, failed = 0;

// Send a request; every response must be JSON with a string message and a data field,
// except 204 (a successful DELETE), which must have no body
async function api(method, path, body, rawBody) {
    var send = rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body);
    var res = await fetch(base + path, {
        method: method,
        headers: send === undefined ? {} : { 'Content-Type': 'application/json' },
        body: send
    });
    if (res.status === 204) {
        assert.equal(await res.text(), '', method + ' ' + path + ': a 204 response must have no body');
        return { status: 204, data: undefined };
    }
    var json = await res.json();
    assert.equal(typeof json.message, 'string', method + ' ' + path + ': message is not a string');
    assert.ok('data' in json, method + ' ' + path + ': response has no data field');
    return { status: res.status, data: json.data };
}

// JSON for a query-string parameter
function q(value) {
    return encodeURIComponent(JSON.stringify(value));
}

async function newUser(extra) {
    seq++;
    var r = await api('POST', '/users', Object.assign({ name: tag + ' user ' + seq, email: tag + '-' + seq + '@example.com' }, extra));
    assert.equal(r.status, 201, 'creating a user failed: ' + JSON.stringify(r));
    return r.data;
}

async function newTask(extra) {
    seq++;
    var r = await api('POST', '/tasks', Object.assign({ name: tag + ' task ' + seq, deadline: '2030-01-01T00:00:00.000Z' }, extra));
    assert.equal(r.status, 201, 'creating a task failed: ' + JSON.stringify(r));
    return r.data;
}

async function user(id) {
    return (await api('GET', '/users/' + id)).data;
}

async function task(id) {
    return (await api('GET', '/tasks/' + id)).data;
}

// The README's two-way reference rules, checked across the whole database
async function consistent() {
    var users = (await api('GET', '/users')).data,
        tasks = (await api('GET', '/tasks?limit=1000000')).data,
        userById = new Map(users.map(function (u) { return [u._id, u]; })),
        taskById = new Map(tasks.map(function (t) { return [t._id, t]; }));
    users.forEach(function (u) {
        u.pendingTasks.forEach(function (id) {
            var t = taskById.get(id);
            assert.ok(t, 'user ' + u._id + ' lists a task that does not exist: ' + id);
            assert.ok(!t.completed && t.assignedUser === u._id && t.assignedUserName === u.name,
                'user ' + u._id + ' lists task ' + id + ', which is completed or not assigned to them');
        });
    });
    tasks.forEach(function (t) {
        var owner = userById.get(t.assignedUser);
        if (t.assignedUser === '') {
            assert.equal(t.assignedUserName, 'unassigned', 'unassigned task ' + t._id + ' has a user name');
        } else {
            assert.ok(owner && owner.name === t.assignedUserName, 'task ' + t._id + ' names a missing user or the wrong name');
        }
        users.forEach(function (u) {
            assert.equal(u.pendingTasks.includes(t._id), u === owner && !t.completed,
                'task ' + t._id + ' is in the wrong pendingTasks (user ' + u._id + ')');
        });
    });
}

async function test(name, fn) {
    try {
        await fn();
        await consistent();
        passed++;
        console.log('PASS  ' + name);
    } catch (err) {
        failed++;
        console.log('FAIL  ' + name + '\n      ' + err.message.split('\n')[0]);
    }
}

// Delete everything this run created
async function cleanup() {
    var tasks = (await api('GET', '/tasks?limit=1000000&where=' + q({ name: { $regex: '^' + tag } }))).data,
        users = (await api('GET', '/users?where=' + q({ email: { $regex: '^' + tag } }))).data;
    for (var t of tasks) await api('DELETE', '/tasks/' + t._id);
    for (var u of users) await api('DELETE', '/users/' + u._id);
}

async function main() {
    // Creating & validating users and tasks

    await test('POST /users creates a user with defaults', async function () {
        var r = await api('POST', '/users', { name: tag + ' Ann', email: tag + '-ann@example.com', dateCreated: '2000-01-01' });
        assert.equal(r.status, 201);
        assert.ok(r.data._id);
        assert.equal(r.data.name, tag + ' Ann');
        assert.equal(r.data.email, tag + '-ann@example.com');
        assert.deepEqual(r.data.pendingTasks, []);
        assert.ok(new Date(r.data.dateCreated).getFullYear() > 2000, 'a dateCreated sent by the client must be ignored');
    });

    await test('POST /users rejects bad input (400, 404) and saves nothing', async function () {
        var u = await newUser(), done = await newTask({ completed: true });
        var bad = [
            {},
            { email: tag + '-x1@example.com' },
            { name: 'x' },
            { name: '   ', email: tag + '-x2@example.com' },
            { name: 123, email: tag + '-x3@example.com' },
            { name: 'x', email: 'not-an-email' },
            { name: 'x', email: u.email },
            { name: 'x', email: tag + '-x4@example.com', pendingTasks: 'abc' },
            { name: 'x', email: tag + '-x5@example.com', pendingTasks: ['abc'] },
            { name: 'x', email: tag + '-x6@example.com', pendingTasks: [done._id] }
        ];
        for (var body of bad) assert.equal((await api('POST', '/users', body)).status, 400, JSON.stringify(body));
        assert.equal((await api('POST', '/users', { name: 'x', email: tag + '-x7@example.com', pendingTasks: [missingId] })).status, 404);
        assert.equal((await api('GET', '/users?count=true&where=' + q({ email: { $regex: '^' + tag + '-x' } }))).data, 0);
    });

    await test('POST /tasks creates a task with defaults', async function () {
        var r = await api('POST', '/tasks', { name: tag + ' T', deadline: '2030-01-01', dateCreated: '2000-01-01' });
        assert.equal(r.status, 201);
        assert.equal(r.data.name, tag + ' T');
        assert.equal(r.data.description, '');
        assert.equal(r.data.completed, false);
        assert.equal(r.data.assignedUser, '');
        assert.equal(r.data.assignedUserName, 'unassigned');
        assert.equal(r.data.deadline, '2030-01-01T00:00:00.000Z');
        assert.ok(new Date(r.data.dateCreated).getFullYear() > 2000, 'a dateCreated sent by the client must be ignored');
        assert.equal((await api('POST', '/tasks', { name: tag + ' T2', deadline: 1893456000000 })).status, 201, 'deadline in ms');
        var form = await fetch(base + '/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'name=' + encodeURIComponent(tag + ' form') + '&deadline=2030-01-01&completed=false'
        });
        assert.equal(form.status, 201, 'form-encoded body');
    });

    await test('POST /tasks rejects bad input (400, 404) and saves nothing', async function () {
        var u = await newUser(), ok = { name: tag + ' bad', deadline: '2030-01-01' };
        var bad = [
            {},
            { deadline: '2030-01-01' },
            { name: tag + ' bad' },
            { name: tag + ' bad', deadline: 'not a date' },
            Object.assign({}, ok, { completed: 'maybe' }),
            Object.assign({}, ok, { description: { a: 1 } }),
            Object.assign({}, ok, { assignedUser: 'abc' }),
            Object.assign({}, ok, { assignedUser: u._id, assignedUserName: 'Someone Else' }),
            Object.assign({}, ok, { assignedUserName: 'Someone' })
        ];
        for (var body of bad) assert.equal((await api('POST', '/tasks', body)).status, 400, JSON.stringify(body));
        assert.equal((await api('POST', '/tasks', Object.assign({}, ok, { assignedUser: missingId }))).status, 404);
        assert.equal((await api('GET', '/tasks?count=true&where=' + q({ name: tag + ' bad' }))).data, 0);
    });

    await test('POST /tasks with assignedUser updates that user', async function () {
        var u = await newUser();
        var t1 = await newTask({ assignedUser: u._id });
        var t2 = await newTask({ assignedUser: u._id, assignedUserName: u.name, completed: true });
        assert.equal(t1.assignedUserName, u.name, 'assignedUserName is filled in');
        assert.equal(t2.assignedUser, u._id, 'a completed task stays assigned');
        assert.deepEqual((await user(u._id)).pendingTasks, [t1._id]);
    });

    await test('POST /users with pendingTasks takes the tasks over', async function () {
        var a = await newUser(), t = await newTask({ assignedUser: a._id });
        var b = await newUser({ pendingTasks: [t._id, t._id] });
        assert.deepEqual(b.pendingTasks, [t._id], 'duplicate ids are stored once');
        assert.deepEqual((await user(a._id)).pendingTasks, []);
        var moved = await task(t._id);
        assert.equal(moved.assignedUser, b._id);
        assert.equal(moved.assignedUserName, b.name);
    });

    // select on single resources

    await test('GET /:id supports select, ignores other parameters, 404s', async function () {
        var u = await newUser(), t = await newTask();
        var r = await api('GET', '/users/' + u._id + '?select=' + q({ name: 1 }));
        assert.equal(r.status, 200);
        assert.deepEqual(Object.keys(r.data).sort(), ['_id', 'name']);
        r = await api('GET', '/users/' + u._id + '?select=' + q({ _id: 0, email: 0 }));
        assert.ok(!('_id' in r.data) && !('email' in r.data) && r.data.name === u.name);
        r = await api('GET', '/tasks/' + t._id + '?select=' + q({ deadline: 1, _id: 0 }));
        assert.deepEqual(r.data, { deadline: t.deadline });
        assert.equal((await api('GET', '/users/' + u._id + '?where=notjson&sort=x&limit=abc&count=true')).status, 200);
        assert.equal((await api('GET', '/tasks/' + t._id + '?select=notjson')).status, 400);
        assert.equal((await api('GET', '/tasks/' + missingId + '?select=notjson')).status, 404, 'the id check comes before select');
        for (var path of ['/users/' + missingId, '/users/abc', '/tasks/' + missingId, '/tasks/abc']) {
            assert.equal((await api('GET', path)).status, 404, path);
            assert.equal((await api('GET', path + '?select=' + q({ name: 1 }))).status, 404, path + ' with select');
        }
    });

    // Updating missing resources

    await test('PUT on missing or malformed ids is 404, before any body check', async function () {
        for (var path of ['/users/' + missingId, '/users/abc', '/tasks/' + missingId, '/tasks/abc']) {
            var body = { name: 'x', email: tag + '-put@example.com', deadline: '2030-01-01' };
            assert.equal((await api('PUT', path, body)).status, 404, path);
            assert.equal((await api('PUT', path, {})).status, 404, path + ' with an empty body');
        }
    });

    // Two-way references and consistency

    await test('PUT /users replaces the user and syncs its tasks', async function () {
        var a = await newUser(), b = await newUser();
        var t1 = await newTask({ assignedUser: a._id }), t2 = await newTask({ assignedUser: b._id }), t3 = await newTask();
        var done = await newTask({ assignedUser: a._id, completed: true });
        var r = await api('PUT', '/users/' + a._id, { name: a.name + ' renamed', email: a.email, pendingTasks: [t2._id, t3._id], dateCreated: '2000-01-01' });
        assert.equal(r.status, 200);
        assert.deepEqual(r.data.pendingTasks, [t2._id, t3._id]);
        assert.equal(r.data.dateCreated, a.dateCreated, 'dateCreated never changes');
        assert.equal((await task(t1._id)).assignedUserName, 'unassigned', 'a dropped task is unassigned');
        assert.deepEqual((await user(b._id)).pendingTasks, [], 'a moved task leaves its old user');
        assert.equal((await task(t2._id)).assignedUserName, a.name + ' renamed');
        var d = await task(done._id);
        assert.equal(d.assignedUser, a._id, 'completed tasks stay assigned');
        assert.equal(d.assignedUserName, a.name + ' renamed', 'completed tasks get the new name');
        r = await api('PUT', '/users/' + a._id, { name: a.name, email: a.email });
        assert.deepEqual(r.data.pendingTasks, [], 'missing pendingTasks means an empty list');
        assert.equal((await task(t2._id)).assignedUser, '');
        assert.equal((await task(done._id)).assignedUser, a._id);
    });

    await test('PUT /users rejects bad input in the README order and changes nothing', async function () {
        var a = await newUser(), b = await newUser();
        var t = await newTask({ assignedUser: b._id }), done = await newTask({ completed: true });
        var put = function (body) {
            return api('PUT', '/users/' + a._id, Object.assign({ name: a.name, email: a.email }, body));
        };
        assert.equal((await put({ name: '' })).status, 400);
        assert.equal((await put({ email: b.email })).status, 400, 'another user\'s email');
        assert.equal((await put({ pendingTasks: 'x' })).status, 400);
        assert.equal((await put({ pendingTasks: ['x'] })).status, 400);
        assert.equal((await put({ pendingTasks: [t._id, missingId] })).status, 404);
        assert.equal((await put({ pendingTasks: [t._id, done._id] })).status, 400, 'completed task');
        assert.equal((await put({ name: '', pendingTasks: [missingId] })).status, 400, '400 checks come before 404');
        assert.equal((await put({ email: b.email, pendingTasks: [missingId] })).status, 400, 'email check comes before 404');
        assert.equal((await put({ pendingTasks: [missingId, done._id] })).status, 404, '404 comes before the completed check');
        assert.equal((await task(t._id)).assignedUser, b._id, 'a failed PUT moved a task');
        assert.equal((await user(a._id)).name, a.name, 'a failed PUT changed the user');
        assert.equal((await put({})).status, 200, 'keeping your own email is fine');
    });

    await test('PUT /tasks follows the two-way rules', async function () {
        var a = await newUser(), b = await newUser(), t = await newTask(), id = t._id;
        var put = function (body) {
            return api('PUT', '/tasks/' + id, Object.assign({ name: t.name, deadline: t.deadline }, body));
        };
        var r = await put({ assignedUser: a._id, description: 'd' });
        assert.equal(r.status, 200);
        assert.equal(r.data.assignedUserName, a.name, 'assignedUserName is filled in');
        assert.equal(r.data.dateCreated, t.dateCreated, 'dateCreated never changes');
        assert.deepEqual((await user(a._id)).pendingTasks, [id]);
        await put({ assignedUser: b._id, assignedUserName: b.name });
        assert.deepEqual((await user(a._id)).pendingTasks, [], 'moved off the old user');
        assert.deepEqual((await user(b._id)).pendingTasks, [id]);
        r = await put({ assignedUser: b._id, completed: true });
        assert.equal(r.data.assignedUser, b._id, 'a completed task stays assigned');
        assert.deepEqual((await user(b._id)).pendingTasks, []);
        await put({ assignedUser: a._id, completed: true });
        assert.equal((await task(id)).assignedUser, a._id, 'reassigning a completed task is allowed');
        assert.deepEqual((await user(a._id)).pendingTasks, []);
        await put({ assignedUser: a._id, completed: false });
        assert.deepEqual((await user(a._id)).pendingTasks, [id], 'pending again');
        r = await put({ assignedUser: '' });
        assert.equal(r.data.assignedUserName, 'unassigned');
        assert.deepEqual((await user(a._id)).pendingTasks, []);
        await put({ assignedUser: a._id, description: 'x', completed: false });
        r = await put({});
        assert.equal(r.data.description, '', 'PUT replaces: missing fields get defaults');
        assert.equal(r.data.completed, false);
        assert.equal(r.data.assignedUser, '');
        assert.deepEqual((await user(a._id)).pendingTasks, []);
    });

    await test('PUT /tasks rejects bad input in the README order and changes nothing', async function () {
        var a = await newUser(), t = await newTask({ assignedUser: a._id }), id = t._id;
        var put = function (body) {
            return api('PUT', '/tasks/' + id, Object.assign({ name: t.name, deadline: t.deadline, assignedUser: a._id }, body));
        };
        assert.equal((await put({ name: '' })).status, 400);
        assert.equal((await put({ deadline: 'soon' })).status, 400);
        assert.equal((await put({ completed: 'maybe' })).status, 400);
        assert.equal((await put({ assignedUser: 'abc' })).status, 400);
        assert.equal((await put({ assignedUserName: 'Wrong Name' })).status, 400);
        assert.equal((await put({ assignedUser: missingId })).status, 404);
        assert.equal((await put({ deadline: undefined, assignedUser: missingId })).status, 400, '400 checks come before 404');
        var now = await task(id);
        assert.equal(now.assignedUser, a._id);
        assert.equal(now.deadline, t.deadline);
        assert.deepEqual((await user(a._id)).pendingTasks, [id]);
    });

    await test('saving a task again keeps the order of pendingTasks', async function () {
        var a = await newUser(), t1 = await newTask({ assignedUser: a._id }), t2 = await newTask({ assignedUser: a._id });
        await api('PUT', '/tasks/' + t1._id, { name: t1.name, deadline: t1.deadline, assignedUser: a._id });
        assert.deepEqual((await user(a._id)).pendingTasks, [t1._id, t2._id]);
    });

    // Query parameters

    await test('GET /tasks with where, sort, select, skip, limit and count', async function () {
        var made = [];
        for (var letter of ['c', 'a', 'b']) made.push(await newTask({ name: tag + ' q ' + letter, completed: letter === 'c' }));
        var where = q({ name: { $regex: '^' + tag + ' q ' } });
        var last = function (r) { return r.data.map(function (t) { return t.name.slice(-1); }); };
        var r = await api('GET', '/tasks?where=' + where + '&sort=' + q({ name: 1 }));
        assert.equal(r.status, 200);
        assert.deepEqual(last(r), ['a', 'b', 'c']);
        r = await api('GET', '/tasks?where=' + where + '&sort=' + q({ name: -1 }) + '&skip=1&limit=1&select=' + q({ name: 1, _id: 0 }));
        assert.deepEqual(r.data, [{ name: tag + ' q b' }]);
        r = await api('GET', '/tasks?where=' + q({ name: { $regex: '^' + tag + ' q ' }, completed: true }));
        assert.deepEqual(last(r), ['c']);
        r = await api('GET', '/tasks?sort=' + q({ name: 1 }) + '&where=' + q({ _id: { $in: [made[0]._id, made[1]._id] } }));
        assert.deepEqual(last(r), ['a', 'c']);
        assert.equal((await api('GET', '/tasks?where=' + where + '&count=true')).data, 3);
        assert.equal((await api('GET', '/tasks?where=' + where + '&limit=2&count=true')).data, 2);
        for (var noMatch of [{ _id: missingId }, { _id: 'abc' }, { completed: 'maybe' }]) {
            r = await api('GET', '/tasks?where=' + q(noMatch));
            assert.equal(r.status, 200, 'no match is still 200: ' + JSON.stringify(noMatch));
            assert.deepEqual(r.data, []);
            assert.equal((await api('GET', '/tasks?count=true&where=' + q(noMatch))).data, 0);
        }
        assert.equal((await api('GET', '/tasks?where=' + where + '&limit=0&count=true')).data, 3, 'limit=0 means no limit');
        for (var bad of ['where={bad', 'where=5', 'sort=nope', 'select=[1', 'skip=-1', 'limit=abc', 'sort=' + q({ name: 2 }), 'where=' + q({ name: { $foo: 1 } })]) {
            assert.equal((await api('GET', '/tasks?' + bad)).status, 400, bad);
        }
    });

    await test('GET /tasks returns 100 by default; GET /users has no default limit', async function () {
        for (var i = 0; i < 101; i++) await newTask({ name: tag + ' bulk' });
        var where = q({ name: tag + ' bulk' });
        assert.equal((await api('GET', '/tasks?where=' + where)).data.length, 100);
        assert.equal((await api('GET', '/tasks?where=' + where + '&limit=101')).data.length, 101);
        assert.equal((await api('GET', '/tasks?where=' + where + '&count=true')).data, 101);
        for (i = 0; i < 101; i++) await newUser({ name: tag + ' crowd' });
        assert.equal((await api('GET', '/users?where=' + q({ name: tag + ' crowd' }))).data.length, 101);
    });

    // Deleting

    await test('DELETE /tasks/:id removes it from its user', async function () {
        var a = await newUser(), t = await newTask({ assignedUser: a._id });
        assert.equal((await api('DELETE', '/tasks/' + t._id)).status, 204);
        assert.equal((await api('GET', '/tasks/' + t._id)).status, 404);
        assert.deepEqual((await user(a._id)).pendingTasks, []);
        assert.equal((await api('DELETE', '/tasks/' + t._id)).status, 404);
        assert.equal((await api('DELETE', '/tasks/abc')).status, 404);
    });

    await test('DELETE /users/:id unassigns all of its tasks', async function () {
        var a = await newUser(), t = await newTask({ assignedUser: a._id });
        var done = await newTask({ assignedUser: a._id, completed: true });
        assert.equal((await api('DELETE', '/users/' + a._id)).status, 204);
        assert.equal((await api('GET', '/users/' + a._id)).status, 404);
        for (var id of [t._id, done._id]) {
            var now = await task(id);
            assert.equal(now.assignedUser, '');
            assert.equal(now.assignedUserName, 'unassigned');
        }
        assert.equal((await api('DELETE', '/users/' + a._id)).status, 404);
        assert.equal((await api('DELETE', '/users/abc')).status, 404);
    });

    // Error responses

    await test('bad bodies and unknown routes get JSON errors', async function () {
        assert.equal((await api('POST', '/users', undefined, '{"name": ')).status, 400, 'malformed JSON');
        assert.equal((await api('POST', '/tasks')).status, 400, 'no body');
        assert.equal((await api('PUT', '/users/' + (await newUser())._id)).status, 400, 'PUT with no body');
        assert.equal((await api('GET', '/nope')).status, 404);
    });
}

main()
    .catch(function (err) { failed++; console.log('ERROR ' + err.message); })
    .finally(async function () {
        try {
            await cleanup();
        } catch (err) {
            console.log('Cleanup failed: ' + err.message);
        }
        console.log('\n' + passed + ' passed, ' + failed + ' failed');
        process.exitCode = failed ? 1 : 0;
    });
