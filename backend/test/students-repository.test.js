const test = require("node:test");
const assert = require("node:assert/strict");

const { ApiError } = require("../src/utils/api-error");

const state = {};
const configPath = require.resolve("../src/config");
const constantsPath = require.resolve("../src/constants");
const utilsPath = require.resolve("../src/utils");
const repositoryPath = require.resolve("../src/modules/students/students-repository");

require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
        db: {
            connect: async () => state.client,
        },
    },
};

require.cache[constantsPath] = {
    id: constantsPath,
    filename: constantsPath,
    loaded: true,
    exports: { ERROR_MESSAGES: { DATABASE_ERROR: "Database error" } },
};

require.cache[utilsPath] = {
    id: utilsPath,
    filename: utilsPath,
    loaded: true,
    exports: {
        ApiError,
        processDBRequest: async (request) => state.processDBRequest(request),
    },
};

delete require.cache[repositoryPath];
const repository = require(repositoryPath);

const createClient = ({
    studentFound = true,
    failOn = "",
    statusRowCount = 1,
    deadlockOnceOn = "",
    statusStudentFound = true,
    statusVerified = true,
    statusHasPassword = true,
} = {}) => {
    const queries = [];
    let released = false;
    let deadlockRaised = false;

    return {
        queries,
        get released() {
            return released;
        },
        async query(query, params) {
            const normalizedQuery = query.replace(/\s+/g, " ").trim();
            queries.push({ query: normalizedQuery, params });
            if (failOn && normalizedQuery.includes(failOn)) {
                throw new Error("database failure");
            }
            if (
                deadlockOnceOn &&
                normalizedQuery.includes(deadlockOnceOn) &&
                !deadlockRaised
            ) {
                deadlockRaised = true;
                const error = new Error("deadlock detected");
                error.code = "40P01";
                throw error;
            }
            if (normalizedQuery.startsWith("SELECT u.id")) {
                return { rows: studentFound ? [{ id: 7 }] : [] };
            }
            if (normalizedQuery.startsWith("SELECT u.is_email_verified")) {
                return {
                    rows: statusStudentFound
                        ? [{ isEmailVerified: statusVerified, hasPassword: statusHasPassword }]
                        : [],
                };
            }
            if (normalizedQuery.startsWith("UPDATE users SET is_active")) {
                return { rowCount: statusRowCount };
            }
            if (normalizedQuery === "DELETE FROM users WHERE id = $1") {
                return { rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        },
        release() {
            released = true;
        },
    };
};

test.beforeEach(() => {
    state.client = createClient();
    state.processDBRequest = async () => ({ rows: [] });
});

test("findAllStudents accepts the frontend class filter", async () => {
    let request;
    state.processDBRequest = async (payload) => {
        request = payload;
        return { rows: [] };
    };

    await repository.findAllStudents({ class: "Grade 10", section: "A" });

    assert.deepEqual(request.queryParams, ["Grade 10", "A"]);
    assert.match(request.query, /t4\.name AS role/);
    assert.match(request.query, /t3\.class_name = \(/);
    assert.match(request.query, /id::text = \$1/);
    assert.match(request.query, /t3\.section_name = \$2/);
});

test("resolveStudentAcademicValues validates the class-section relationship", async () => {
    let request;
    state.processDBRequest = async (payload) => {
        request = payload;
        return { rows: [{ className: "Grade 10", sectionName: "A" }] };
    };

    await repository.resolveStudentAcademicValues({ classValue: "1", sectionValue: "A" });

    assert.deepEqual(request.queryParams, ["1", "A"]);
    assert.match(request.query, /string_to_array\(COALESCE\(c\.sections, ''\), ','\)/);
    assert.match(request.query, /btrim\(allowed_section\.name\) = s\.name/);
});

test("findStudentToSetStatus revokes sessions when disabling a student", async () => {
    const result = await repository.findStudentToSetStatus({
        userId: 7,
        reviewerId: 1,
        status: false,
    });
    const statements = state.client.queries.map(({ query }) => query);

    assert.deepEqual(result, { outcome: "updated" });
    assert.equal(statements[0], "BEGIN");
    assert.match(statements[1], /password IS NOT NULL/);
    assert.ok(statements.includes("DELETE FROM user_refresh_tokens WHERE user_id = $1"));
    assert.equal(statements.at(-1), "COMMIT");
    assert.equal(state.client.released, true);
});

test("findStudentToSetStatus rejects enable until verification and password setup finish", async () => {
    state.client = createClient({ statusHasPassword: false });

    assert.deepEqual(
        await repository.findStudentToSetStatus({ userId: 7, reviewerId: 1, status: true }),
        { outcome: "not_ready" }
    );

    const statements = state.client.queries.map(({ query }) => query);
    assert.equal(statements.some((query) => query.startsWith("UPDATE users SET")), false);
    assert.equal(statements.at(-1), "ROLLBACK");
});

test("findStudentToSetStatus keeps sessions when enabling a verified student", async () => {
    await repository.findStudentToSetStatus({ userId: 7, reviewerId: 1, status: true });

    const statements = state.client.queries.map(({ query }) => query);
    assert.equal(
        statements.some((query) => query.startsWith("DELETE FROM user_refresh_tokens")),
        false
    );
    assert.equal(statements.at(-1), "COMMIT");
});

test("deleteStudentById commits a complete student deletion", async () => {
    const result = await repository.deleteStudentById(7);
    const statements = state.client.queries.map(({ query }) => query);

    assert.equal(result, 1);
    assert.equal(statements[0], "BEGIN");
    assert.equal(statements.at(-1), "COMMIT");
    assert.ok(statements.includes("DELETE FROM user_profiles WHERE user_id = $1"));
    assert.ok(statements.includes("DELETE FROM users WHERE id = $1"));
    assert.equal(state.client.released, true);
});

test("deleteStudentById rolls back when the id is not a student", async () => {
    state.client = createClient({ studentFound: false });

    assert.equal(await repository.deleteStudentById(7), 0);

    const statements = state.client.queries.map(({ query }) => query);
    assert.equal(statements.at(-1), "ROLLBACK");
    assert.equal(statements.some((query) => query.startsWith("DELETE FROM users")), false);
    assert.equal(state.client.released, true);
});

test("deleteStudentById rolls back and masks database failures", async () => {
    state.client = createClient({ failOn: "DELETE FROM user_profiles" });

    await assert.rejects(
        () => repository.deleteStudentById(7),
        (error) =>
            error instanceof ApiError &&
            error.statusCode === 500 &&
            error.message === "Database error"
    );

    const statements = state.client.queries.map(({ query }) => query);
    assert.equal(statements.at(-1), "ROLLBACK");
    assert.equal(state.client.released, true);
});

test("deleteStudentById retries one deadlock and then commits", async () => {
    state.client = createClient({ deadlockOnceOn: "DELETE FROM user_profiles" });

    assert.equal(await repository.deleteStudentById(7), 1);

    const statements = state.client.queries.map(({ query }) => query);
    assert.equal(statements.filter((query) => query === "BEGIN").length, 2);
    assert.equal(statements.filter((query) => query === "ROLLBACK").length, 1);
    assert.equal(statements.at(-1), "COMMIT");
    assert.equal(state.client.released, true);
});
