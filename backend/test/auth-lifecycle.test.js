const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const { ApiError } = require("../src/utils/api-error");

const state = {};
const utilsPath = require.resolve("../src/utils");
const repositoryPath = require.resolve("../src/modules/auth/auth-repository");
const configPath = require.resolve("../src/config");
const sharedRepositoryPath = require.resolve("../src/shared/repository");
const servicePath = require.resolve("../src/modules/auth/auth-service");
const call = (name) => (...args) => state[name](...args);

require.cache[utilsPath] = {
    id: utilsPath,
    filename: utilsPath,
    loaded: true,
    exports: {
        ApiError,
        generateToken: call("generateToken"),
        generateCsrfHmacHash: call("generateCsrfHmacHash"),
        verifyToken: call("verifyToken"),
        sendPasswordSetupEmail: call("sendPasswordSetupEmail"),
        verifyPassword: call("verifyPassword"),
        generateHashedPassword: call("generateHashedPassword"),
        sendAccountVerificationEmail: call("sendAccountVerificationEmail"),
        formatMyPermission: call("formatMyPermission"),
    },
};
require.cache[repositoryPath] = {
    id: repositoryPath,
    filename: repositoryPath,
    loaded: true,
    exports: {
        findUserByUsername: call("findUserByUsername"),
        invalidateRefreshToken: call("invalidateRefreshToken"),
        findUserByRefreshToken: call("findUserByRefreshToken"),
        getMenusByRoleId: call("getMenusByRoleId"),
        getRoleNameByRoleId: call("getRoleNameByRoleId"),
        saveUserLastLoginDate: call("saveUserLastLoginDate"),
        deleteOldRefreshTokenByUserId: call("deleteOldRefreshTokenByUserId"),
        isEmailVerified: call("isEmailVerified"),
        verifyAccountEmail: call("verifyAccountEmail"),
        doesEmailExist: call("doesEmailExist"),
        setupUserPassword: call("setupUserPassword"),
        setPasswordSetupNonce: call("setPasswordSetupNonce"),
    },
};
require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { env: {}, db: { connect: call("connect") } },
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

const originalLoad = Module._load;
Module._load = function loadWithUuidStub(request, parent, isMain) {
    if (request === "uuid") return { v4: () => "csrf" };
    return originalLoad.call(this, request, parent, isMain);
};
delete require.cache[servicePath];
const service = require(servicePath);
Module._load = originalLoad;

test.beforeEach(() => {
    state.findUserById = async () => ({ id: 7, email: "current@example.com" });
    state.isEmailVerified = async () => false;
    state.verifyAccountEmail = async () => ({ id: 7, email: "current@example.com" });
    state.sendPasswordSetupEmail = async () => undefined;
    state.doesEmailExist = async () => ({ email: "current@example.com" });
    state.generateHashedPassword = async () => "hashed";
    state.setupUserPassword = async () => 1;
    state.setPasswordSetupNonce = async () => 1;
    for (const name of [
        "generateToken",
        "generateCsrfHmacHash",
        "verifyToken",
        "sendAccountVerificationEmail",
        "verifyPassword",
        "formatMyPermission",
        "findUserByUsername",
        "invalidateRefreshToken",
        "findUserByRefreshToken",
        "getMenusByRoleId",
        "getRoleNameByRoleId",
        "saveUserLastLoginDate",
        "deleteOldRefreshTokenByUserId",
        "insertRefreshToken",
        "connect",
    ]) {
        state[name] = async () => undefined;
    }
});

test("email verification rejects a token issued for a previous email", async () => {
    let verificationMutationCalled = false;
    state.verifyAccountEmail = async () => {
        verificationMutationCalled = true;
    };

    await assert.rejects(
        () => service.processAccountEmailVerify(7, "old@example.com"),
        (error) => error instanceof ApiError && error.statusCode === 400
    );
    assert.equal(verificationMutationCalled, false);
});

test("repeat email verification remains a client error", async () => {
    state.isEmailVerified = async () => true;

    await assert.rejects(
        () => service.processAccountEmailVerify(7, "current@example.com"),
        (error) =>
            error instanceof ApiError &&
            error.statusCode === 400 &&
            error.message === "Email already verified"
    );
});

test("successful verification sends a password link for the same email", async () => {
    let sentPayload;
    state.sendPasswordSetupEmail = async (payload) => {
        sentPayload = payload;
    };

    await service.processAccountEmailVerify(7, "current@example.com");

    assert.equal(sentPayload.userId, 7);
    assert.equal(sentPayload.userEmail, "current@example.com");
    assert.match(sentPayload.nonce, /^[0-9a-f-]{36}$/i);
});

test("password setup rejects a token issued for another email", async () => {
    await assert.rejects(
        () => service.processPasswordSetup({
            userId: 7,
            userEmail: "current@example.com",
            tokenEmail: "old@example.com",
            nonce: "old-nonce",
            password: "password",
        }),
        (error) => error instanceof ApiError && error.statusCode === 400
    );
});

test("password setup rejects an account that is not currently verified", async () => {
    state.setupUserPassword = async () => 0;

    await assert.rejects(
        () => service.processPasswordSetup({
            userId: 7,
            userEmail: "current@example.com",
            tokenEmail: "current@example.com",
            nonce: "current-nonce",
            password: "password",
        }),
        (error) => error instanceof ApiError && error.statusCode === 400
    );
});
