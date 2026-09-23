const test = require("node:test");
const assert = require("node:assert/strict");

const { ApiError } = require("../src/utils/api-error");

const implementations = {};
const repositoryPath = require.resolve("../src/modules/students/students-repository");
const utilsPath = require.resolve("../src/utils");
const servicePath = require.resolve("../src/modules/students/students-service");

const call = (name) => (...args) => implementations[name](...args);

require.cache[repositoryPath] = {
    id: repositoryPath,
    filename: repositoryPath,
    loaded: true,
    exports: {
        findAllStudents: call("findAllStudents"),
        findStudentById: call("findStudentById"),
        findStudentDetail: call("findStudentDetail"),
        findStudentToSetStatus: call("findStudentToSetStatus"),
        addOrUpdateStudent: call("addOrUpdateStudent"),
        deleteStudentById: call("deleteStudentById"),
        resolveStudentAcademicValues: call("resolveStudentAcademicValues"),
    },
};

require.cache[utilsPath] = {
    id: utilsPath,
    filename: utilsPath,
    loaded: true,
    exports: {
        ApiError,
        sendAccountVerificationEmail: call("sendAccountVerificationEmail"),
    },
};

delete require.cache[servicePath];
const service = require(servicePath);

test.beforeEach(() => {
    implementations.findAllStudents = async () => [];
    implementations.findStudentById = async () => ({
        id: 7,
        email: "student@example.com",
        isEmailVerified: true,
    });
    implementations.findStudentDetail = async () => ({ id: 7, name: "Student" });
    implementations.findStudentToSetStatus = async () => ({ outcome: "updated" });
    implementations.addOrUpdateStudent = async () => ({
        userId: 7,
        status: true,
        message: "Student updated successfully",
    });
    implementations.deleteStudentById = async () => 1;
    implementations.resolveStudentAcademicValues = async ({ classValue, sectionValue }) => ({
        className: classValue || "Grade 10",
        sectionName: sectionValue || "A",
    });
    implementations.sendAccountVerificationEmail = async () => undefined;
});

test("getAllStudents returns an empty collection instead of a 404", async () => {
    assert.deepEqual(await service.getAllStudents({}), []);
});

test("getStudentDetail rejects ids that do not belong to a student", async () => {
    implementations.findStudentById = async () => undefined;

    await assert.rejects(
        () => service.getStudentDetail(99),
        (error) => error instanceof ApiError && error.statusCode === 404
    );
});

test("addNewStudent returns the created id", async () => {
    implementations.addOrUpdateStudent = async () => ({
        userId: 42,
        status: true,
        message: "Student added successfully",
    });

    const result = await service.addNewStudent({ email: "student@example.com" });

    assert.equal(result.id, 42);
    assert.match(result.message, /verification email sent successfully/i);
});

test("addNewStudent keeps a successful create when email delivery fails", async () => {
    implementations.sendAccountVerificationEmail = async () => {
        throw new Error("mail provider unavailable");
    };

    const result = await service.addNewStudent({ email: "student@example.com" });

    assert.equal(result.id, 7);
    assert.match(result.message, /failed to send verification email/i);
});

test("addNewStudent reports duplicate emails as a conflict", async () => {
    implementations.addOrUpdateStudent = async () => ({
        status: false,
        message: "Email already exists",
    });

    await assert.rejects(
        () => service.addNewStudent({ email: "duplicate@example.com" }),
        (error) => error instanceof ApiError && error.statusCode === 409
    );
});

test("addNewStudent rejects an unknown class or section before mutation", async () => {
    implementations.resolveStudentAcademicValues = async () => ({
        className: undefined,
        sectionName: "A",
    });
    let mutationCalled = false;
    implementations.addOrUpdateStudent = async () => {
        mutationCalled = true;
    };

    await assert.rejects(
        () => service.addNewStudent({ class: "missing", section: "A" }),
        (error) => error instanceof ApiError && error.statusCode === 422
    );
    assert.equal(mutationCalled, false);
});

test("updateStudent never turns a missing user into a new student", async () => {
    implementations.findStudentById = async () => undefined;
    let mutationCalled = false;
    implementations.addOrUpdateStudent = async () => {
        mutationCalled = true;
        return { status: true };
    };

    await assert.rejects(
        () => service.updateStudent({ userId: 99 }),
        (error) => error instanceof ApiError && error.statusCode === 404
    );
    assert.equal(mutationCalled, false);
});

test("updateStudent reports a concurrent deletion as not found", async () => {
    implementations.addOrUpdateStudent = async () => ({
        status: false,
        message: "Student not found",
    });

    await assert.rejects(
        () => service.updateStudent({ userId: 7 }),
        (error) => error instanceof ApiError && error.statusCode === 404
    );
});

test("updateStudent sends verification mail and reports an email change", async () => {
    implementations.addOrUpdateStudent = async () => ({
        userId: 7,
        status: true,
        message: "Student updated successfully",
        description: "email_changed",
    });
    let emailPayload;
    implementations.sendAccountVerificationEmail = async (payload) => {
        emailPayload = payload;
    };

    const result = await service.updateStudent({
        userId: 7,
        email: "new@example.com",
        class: "Grade 10",
        section: "A",
    });

    assert.deepEqual(emailPayload, { userId: 7, userEmail: "new@example.com" });
    assert.match(result.message, /verification email sent/i);
});

test("setStudentStatus records the reviewer and requested status", async () => {
    let receivedPayload;
    implementations.findStudentToSetStatus = async (payload) => {
        receivedPayload = payload;
        return { outcome: "updated" };
    };

    await service.setStudentStatus({ userId: 7, reviewerId: 1, status: true });

    assert.deepEqual(receivedPayload, { userId: 7, reviewerId: 1, status: true });
});

test("setStudentStatus cannot enable an unverified student", async () => {
    implementations.findStudentToSetStatus = async () => ({ outcome: "not_ready" });

    await assert.rejects(
        () => service.setStudentStatus({ userId: 7, reviewerId: 1, status: true }),
        (error) => error instanceof ApiError && error.statusCode === 409
    );
});

test("setStudentStatus returns 404 when the student disappears during the update", async () => {
    implementations.findStudentToSetStatus = async () => ({ outcome: "not_found" });

    await assert.rejects(
        () => service.setStudentStatus({ userId: 7, reviewerId: 1, status: false }),
        (error) => error instanceof ApiError && error.statusCode === 404
    );
});

test("deleteStudent returns 404 when the student does not exist", async () => {
    implementations.deleteStudentById = async () => 0;

    await assert.rejects(
        () => service.deleteStudent(99),
        (error) => error instanceof ApiError && error.statusCode === 404
    );
});

test("deleteStudent returns the documented response", async () => {
    assert.deepEqual(await service.deleteStudent(7), {
        message: "Student deleted successfully",
    });
});
