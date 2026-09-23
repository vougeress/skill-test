const test = require("node:test");
const assert = require("node:assert/strict");

const state = {};
const configPath = require.resolve("../src/config");
const utilsPath = require.resolve("../src/utils");
const repositoryPath = require.resolve("../src/modules/auth/auth-repository");

require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { db: {} },
};
require.cache[utilsPath] = {
    id: utilsPath,
    filename: utilsPath,
    loaded: true,
    exports: { processDBRequest: (request) => state.processDBRequest(request) },
};

delete require.cache[repositoryPath];
const repository = require(repositoryPath);

test("password setup atomically consumes its nonce and revokes sessions without enabling access", async () => {
    let request;
    state.processDBRequest = async (payload) => {
        request = payload;
        return { rows: [{ updatedCount: 1 }] };
    };

    const result = await repository.setupUserPassword({
        userId: 7,
        userEmail: "student@example.com",
        nonce: "one-time-nonce",
        password: "hashed",
    });

    assert.equal(result, 1);
    assert.deepEqual(request.queryParams, [
        "hashed",
        7,
        "student@example.com",
        "one-time-nonce",
    ]);
    assert.match(request.query, /password_setup_nonce = NULL/);
    assert.match(request.query, /password_setup_nonce = \$4/);
    assert.match(request.query, /DELETE FROM user_refresh_tokens/);
    assert.doesNotMatch(request.query, /is_active\s*=\s*true/);
});

test("issuing a new setup link replaces the previous nonce", async () => {
    let request;
    state.processDBRequest = async (payload) => {
        request = payload;
        return { rowCount: 1 };
    };

    assert.equal(
        await repository.setPasswordSetupNonce({
            userId: 7,
            userEmail: "student@example.com",
            nonce: "new-nonce",
        }),
        1
    );
    assert.deepEqual(request.queryParams, ["new-nonce", 7, "student@example.com"]);
    assert.match(request.query, /is_email_verified = true/);
});
