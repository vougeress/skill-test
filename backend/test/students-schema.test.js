const test = require("node:test");
const assert = require("node:assert/strict");

const {
    StudentIdSchema,
    CreateStudentSchema,
    UpdateStudentSchema,
    SetStudentStatusSchema,
} = require("../src/modules/students/students-schema");
const { validateRequest } = require("../src/utils/validate-request");

const validStudent = {
    name: "Jane Doe",
    gender: "Female",
    dob: "2010-01-02",
    phone: "123456789",
    email: "jane@example.com",
    class: "Grade 10",
    section: "A",
    roll: "12",
    admissionDate: "2025-09-01",
    fatherName: "John Doe",
    fatherPhone: "",
    motherName: "",
    motherPhone: "",
    guardianName: "John Doe",
    guardianPhone: "123456789",
    relationOfGuardian: "Father",
    currentAddress: "Current address",
    permanentAddress: "Permanent address",
    systemAccess: false,
};

test("accepts the payload produced by the student form", () => {
    assert.equal(CreateStudentSchema.safeParse({ body: validStudent }).success, true);
});

test("allows create to use the database default for system access", () => {
    const { systemAccess, ...studentWithoutSystemAccess } = validStudent;
    assert.equal(
        CreateStudentSchema.safeParse({ body: studentWithoutSystemAccess }).success,
        true
    );
});

test("create strips system access so activation stays in the verification flow", () => {
    const result = CreateStudentSchema.safeParse({ body: validStudent });

    assert.equal(result.success, true);
    assert.equal(Object.hasOwn(result.data.body, "systemAccess"), false);
});

test("rejects malformed student data", () => {
    const result = CreateStudentSchema.safeParse({
        body: { ...validStudent, email: "invalid", roll: "not-a-number" },
    });
    assert.equal(result.success, false);
});

test("rejects impossible and non-ISO dates before they reach PostgreSQL", () => {
    assert.equal(
        CreateStudentSchema.safeParse({ body: { ...validStudent, dob: "2025-02-30" } }).success,
        false
    );
    assert.equal(
        CreateStudentSchema.safeParse({ body: { ...validStudent, admissionDate: "1" } }).success,
        false
    );
});

test("update accepts date-only values produced by the edit form", () => {
    const result = UpdateStudentSchema.safeParse({ params: { id: "7" }, body: validStudent });
    assert.equal(result.success, true);
    assert.equal(Object.hasOwn(result.data.body, "systemAccess"), false);
});

test("update rejects unnormalized ISO datetimes", () => {
    const body = {
        ...validStudent,
        dob: "2010-01-02T00:00:00.000Z",
        admissionDate: "2025-09-01T00:00:00.000Z",
    };

    assert.equal(
        UpdateStudentSchema.safeParse({ params: { id: "7" }, body }).success,
        false
    );
});

test("requires a positive integer student id", () => {
    assert.equal(StudentIdSchema.safeParse({ params: { id: "7" } }).success, true);
    assert.equal(StudentIdSchema.safeParse({ params: { id: "0" } }).success, false);
    assert.equal(StudentIdSchema.safeParse({ params: { id: "abc" } }).success, false);
    assert.equal(StudentIdSchema.safeParse({ params: { id: "2147483648" } }).success, false);
});

test("requires a boolean status", () => {
    assert.equal(
        SetStudentStatusSchema.safeParse({ params: { id: "7" }, body: { status: true } }).success,
        true
    );
    assert.equal(
        SetStudentStatusSchema.safeParse({ params: { id: "7" }, body: { status: "true" } }).success,
        false
    );
});

test("validation middleware passes sanitized values to the controller", () => {
    const req = {
        body: { ...validStudent, name: "  Jane Doe  " },
        query: {},
        params: {},
    };
    let nextCalled = false;

    validateRequest(CreateStudentSchema)(
        req,
        { status: () => ({ json: () => undefined }) },
        () => {
            nextCalled = true;
        }
    );

    assert.equal(nextCalled, true);
    assert.equal(req.body.name, "Jane Doe");
    assert.equal(Object.hasOwn(req.body, "systemAccess"), false);
});
