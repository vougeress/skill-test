const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const implementations = {};
const servicePath = require.resolve("../src/modules/students/students-service");
const controllerPath = require.resolve("../src/modules/students/students-controller");
const call = (name) => (...args) => implementations[name](...args);

require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
        getAllStudents: call("getAllStudents"),
        addNewStudent: call("addNewStudent"),
        getStudentDetail: call("getStudentDetail"),
        setStudentStatus: call("setStudentStatus"),
        updateStudent: call("updateStudent"),
        deleteStudent: call("deleteStudent"),
    },
};

const originalLoad = Module._load;
Module._load = function loadWithTestAsyncHandler(request, parent, isMain) {
    if (request === "express-async-handler") {
        return (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
    }
    return originalLoad.call(this, request, parent, isMain);
};

delete require.cache[controllerPath];
const controller = require(controllerPath);
Module._load = originalLoad;

const createResponse = () => ({
    statusCode: 200,
    body: undefined,
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
});

const invoke = async (handler, req, res) => {
    let handledError;
    await handler(req, res, (error) => {
        handledError = error;
    });
    if (handledError) {
        throw handledError;
    }
};

test.beforeEach(() => {
    implementations.getAllStudents = async () => [];
    implementations.addNewStudent = async () => ({ id: 7, message: "created" });
    implementations.getStudentDetail = async () => ({ id: 7 });
    implementations.setStudentStatus = async () => ({ message: "status changed" });
    implementations.updateStudent = async () => ({ message: "updated" });
    implementations.deleteStudent = async () => ({ message: "deleted" });
});

test("handleGetAllStudents wraps the collection for the frontend contract", async () => {
    const res = createResponse();
    await invoke(controller.handleGetAllStudents, { query: { class: "10" } }, res);
    assert.deepEqual(res.body, { students: [] });
});

test("handleAddStudent responds with 201", async () => {
    const res = createResponse();
    await invoke(controller.handleAddStudent, { body: { name: "Student" } }, res);
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, { id: 7, message: "created" });
});

test("handleUpdateStudent maps the path id to the database userId field", async () => {
    let receivedPayload;
    implementations.updateStudent = async (payload) => {
        receivedPayload = payload;
        return { message: "updated" };
    };
    const res = createResponse();

    await invoke(
        controller.handleUpdateStudent,
        { params: { id: "7" }, body: { name: "Updated" } },
        res
    );

    assert.deepEqual(receivedPayload, { name: "Updated", userId: "7" });
});

test("handleStudentStatus includes the authenticated reviewer", async () => {
    let receivedPayload;
    implementations.setStudentStatus = async (payload) => {
        receivedPayload = payload;
        return { message: "status changed" };
    };
    const res = createResponse();

    await invoke(
        controller.handleStudentStatus,
        { params: { id: "7" }, user: { id: 1 }, body: { status: false } },
        res
    );

    assert.deepEqual(receivedPayload, { userId: "7", reviewerId: 1, status: false });
});

test("handleDeleteStudent delegates the path id", async () => {
    let receivedId;
    implementations.deleteStudent = async (id) => {
        receivedId = id;
        return { message: "deleted" };
    };
    const res = createResponse();

    await invoke(controller.handleDeleteStudent, { params: { id: "7" } }, res);

    assert.equal(receivedId, "7");
    assert.deepEqual(res.body, { message: "deleted" });
});
