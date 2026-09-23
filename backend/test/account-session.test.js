const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const state = {};
const utilsPath = require.resolve("../src/utils");
const configPath = require.resolve("../src/config");
const accountRepositoryPath = require.resolve("../src/modules/account/account-repository");
const authRepositoryPath = require.resolve("../src/modules/auth/auth-repository");
const sharedRepositoryPath = require.resolve("../src/shared/repository");
const servicePath = require.resolve("../src/modules/account/account-service");
const call = (name) => (...args) => state[name](...args);

require.cache[utilsPath] = {
    id: utilsPath,
    filename: utilsPath,
    loaded: true,
    exports: {
        ApiError: class ApiError extends Error {},
        generateHashedPassword: call("generateHashedPassword"),
        generateToken: call("generateToken"),
        generateCsrfHmacHash: call("generateCsrfHmacHash"),
        verifyPassword: call("verifyPassword"),
    },
};
require.cache[accountRepositoryPath] = {
    id: accountRepositoryPath,
    filename: accountRepositoryPath,
    loaded: true,
    exports: {
        changePassword: call("changePassword"),
        findUserByIdForUpdate: call("findUserByIdForUpdate"),
        getUserRoleNameByUserId: call("getUserRoleNameByUserId"),
        getStudentAccountDetail: call("getStudentAccountDetail"),
        getStaffAccountDetail: call("getStaffAccountDetail"),
    },
};
require.cache[authRepositoryPath] = {
    id: authRepositoryPath,
    filename: authRepositoryPath,
    loaded: true,
    exports: { deleteOldRefreshTokenByUserId: call("deleteOldRefreshTokenByUserId") },
};
require.cache[sharedRepositoryPath] = {
    id: sharedRepositoryPath,
    filename: sharedRepositoryPath,
    loaded: true,
    exports: {
        insertRefreshToken: call("insertRefreshToken"),
        findUserById: call("findUserById"),
    },
};

const client = {
    queries: [],
    async query(query) {
        this.queries.push(query);
        return { rows: [] };
    },
    release() {},
};
require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
        env: {
            JWT_ACCESS_TOKEN_SECRET: "access-secret",
            JWT_ACCESS_TOKEN_TIME_IN_MS: "15m",
            JWT_REFRESH_TOKEN_SECRET: "refresh-secret",
            JWT_REFRESH_TOKEN_TIME_IN_MS: "7d",
        },
        db: { connect: async () => client },
    },
};

const originalLoad = Module._load;
Module._load = function loadWithUuidStub(request, parent, isMain) {
    if (request === "uuid") return { v4: () => "csrf" };
    return originalLoad.call(this, request, parent, isMain);
};
delete require.cache[servicePath];
const { processPasswordChange } = require(servicePath);
Module._load = originalLoad;

test.beforeEach(() => {
    client.queries = [];
    state.events = [];
    state.findUserById = async () => ({ id: 7, password: "old-hash" });
    state.findUserByIdForUpdate = async () => {
        state.events.push("user-locked");
        return { id: 7, password: "old-hash" };
    };
    state.verifyPassword = async () => undefined;
    state.getUserRoleNameByUserId = async () => ({ name: "student", roleId: 3 });
    state.generateHashedPassword = async () => "new-hash";
    state.changePassword = async () => state.events.push("password-changed");
    state.deleteOldRefreshTokenByUserId = async () => state.events.push("sessions-revoked");
    state.generateCsrfHmacHash = () => "csrf-hash";
    state.generateToken = (payload, secret) => {
        state.events.push({ payload, secret });
        return secret === "access-secret" ? "access-token" : "refresh-token";
    };
    state.insertRefreshToken = async () => state.events.push("session-created");
    state.getStudentAccountDetail = async () => undefined;
    state.getStaffAccountDetail = async () => undefined;
});

test("password change issues role-aware tokens and replaces prior sessions", async () => {
    await processPasswordChange({ userId: 7, oldPassword: "old", newPassword: "new" });

    const tokenEvents = state.events.filter((event) => typeof event === "object");
    assert.equal(tokenEvents.length, 2);
    assert.ok(state.events.indexOf("user-locked") < state.events.indexOf("password-changed"));
    assert.deepEqual(tokenEvents[0].payload, {
        id: 7,
        role: "student",
        roleId: 3,
        csrf_hmac: "csrf-hash",
    });
    assert.deepEqual(tokenEvents[1].payload, { id: 7, role: "student", roleId: 3 });
    assert.ok(state.events.indexOf("sessions-revoked") < state.events.indexOf("session-created"));
    assert.deepEqual(client.queries, ["BEGIN", "COMMIT"]);
});
