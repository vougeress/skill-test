const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const routes = [];
const router = {};
for (const method of ["get", "post", "put", "delete"]) {
    router[method] = (path, ...handlers) => routes.push({ method, path, handlers });
}

const controller = {
    handleGetAllStudents() {},
    handleAddStudent() {},
    handleGetStudentDetail() {},
    handleStudentStatus() {},
    handleUpdateStudent() {},
    handleDeleteStudent() {},
};
const checkApiAccess = () => undefined;
const validateRequest = (schema) => {
    const middleware = () => undefined;
    middleware.schema = schema;
    return middleware;
};
const schemas = {
    StudentIdSchema: { name: "StudentIdSchema" },
    GetStudentsSchema: { name: "GetStudentsSchema" },
    CreateStudentSchema: { name: "CreateStudentSchema" },
    UpdateStudentSchema: { name: "UpdateStudentSchema" },
    SetStudentStatusSchema: { name: "SetStudentStatusSchema" },
};

const originalLoad = Module._load;
Module._load = function loadRouterDependencies(request, parent, isMain) {
    if (request === "express") return { Router: () => router };
    if (request === "./students-controller") return controller;
    if (request === "../../middlewares") return { checkApiAccess };
    if (request === "../../utils") return { validateRequest };
    if (request === "./students-schema") return schemas;
    return originalLoad.call(this, request, parent, isMain);
};

const routerPath = require.resolve("../src/modules/students/sudents-router");
delete require.cache[routerPath];
const { studentsRoutes } = require(routerPath);
Module._load = originalLoad;

test("registers the complete CRUD and status route set", () => {
    assert.equal(studentsRoutes, router);
    assert.deepEqual(
        routes.map(({ method, path }) => [method.toUpperCase(), path]),
        [
            ["GET", ""],
            ["POST", ""],
            ["GET", "/:id"],
            ["POST", "/:id/status"],
            ["PUT", "/:id"],
            ["DELETE", "/:id"],
        ]
    );
});

test("protects every student endpoint with validation and access control", () => {
    for (const route of routes) {
        assert.equal(route.handlers.length, 3);
        assert.ok(route.handlers[0].schema);
        assert.equal(route.handlers[1], checkApiAccess);
    }
});

test("wires DELETE to the student deletion controller", () => {
    const deleteRoute = routes.find(({ method, path }) => method === "delete" && path === "/:id");
    assert.equal(deleteRoute.handlers.at(-1), controller.handleDeleteStudent);
});
