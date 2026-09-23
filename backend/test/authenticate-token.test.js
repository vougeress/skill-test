const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const { ApiError } = require("../src/utils/api-error");

const state = {};
const configPath = require.resolve("../src/config");
const utilsPath = require.resolve("../src/utils");
const authRepositoryPath = require.resolve("../src/modules/auth/auth-repository");
const middlewarePath = require.resolve("../src/middlewares/authenticate-token");

require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
        env: {
            JWT_ACCESS_TOKEN_SECRET: "access-secret",
            JWT_REFRESH_TOKEN_SECRET: "refresh-secret",
        },
    },
};
require.cache[utilsPath] = {
    id: utilsPath,
    filename: utilsPath,
    loaded: true,
    exports: { ApiError },
};
require.cache[authRepositoryPath] = {
    id: authRepositoryPath,
    filename: authRepositoryPath,
    loaded: true,
    exports: {
        findUserByRefreshToken: (token) => state.findUserByRefreshToken(token),
    },
};

const originalLoad = Module._load;
Module._load = function loadWithTestDependencies(request, parent, isMain) {
    if (request === "jsonwebtoken") {
        return { verify: (token, secret) => state.verify(token, secret) };
    }
    if (request === "express-async-handler") {
        return (handler) => handler;
    }
    return originalLoad.call(this, request, parent, isMain);
};

delete require.cache[middlewarePath];
const { authenticateToken } = require(middlewarePath);
Module._load = originalLoad;

test.beforeEach(() => {
    state.verify = (token) =>
        token === "access-token"
            ? { id: 7, roleId: 3, role: "student" }
            : { id: 7, roleId: 3, role: "student" };
    state.findUserByRefreshToken = async () => ({ id: 7, role_id: 3, is_active: true });
});

const execute = async (cookies = { accessToken: "access-token", refreshToken: "refresh-token" }) => {
    const req = { cookies };
    let nextCalled = false;
    await authenticateToken(req, {}, () => {
        nextCalled = true;
    });
    return { req, nextCalled };
};

test("accepts matching tokens backed by an active database session", async () => {
    const { req, nextCalled } = await execute();

    assert.equal(nextCalled, true);
    assert.equal(req.user.id, 7);
    assert.equal(req.refreshToken.id, 7);
});

test("rejects requests without both authentication cookies", async () => {
    await assert.rejects(
        () => execute(null),
        (error) => error instanceof ApiError && error.statusCode === 401
    );
});

test("rejects access and refresh tokens issued to different users", async () => {
    state.verify = (token) =>
        token === "access-token" ? { id: 7, roleId: 3 } : { id: 8, roleId: 3 };

    await assert.rejects(
        () => execute(),
        (error) =>
            error instanceof ApiError &&
            error.statusCode === 401 &&
            error.message === "Unauthorized. Token owners do not match."
    );
});

test("rejects a disabled account even while its JWT is unexpired", async () => {
    state.findUserByRefreshToken = async () => ({ id: 7, role_id: 3, is_active: false });

    await assert.rejects(
        () => execute(),
        (error) =>
            error instanceof ApiError &&
            error.statusCode === 401 &&
            error.message === "Unauthorized. Session is no longer active."
    );
});

test("rejects revoked sessions and role changes", async () => {
    state.findUserByRefreshToken = async () => null;
    await assert.rejects(() => execute(), (error) => error.statusCode === 401);

    state.findUserByRefreshToken = async () => ({ id: 7, role_id: 2, is_active: true });
    await assert.rejects(() => execute(), (error) => error.statusCode === 401);
});
