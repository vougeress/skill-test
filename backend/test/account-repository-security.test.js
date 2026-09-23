const test = require("node:test");
const assert = require("node:assert/strict");

const utilsPath = require.resolve("../src/utils");
const repositoryPath = require.resolve("../src/modules/account/account-repository");
require.cache[utilsPath] = {
    id: utilsPath,
    filename: utilsPath,
    loaded: true,
    exports: { processDBRequest: async () => ({ rows: [] }) },
};
delete require.cache[repositoryPath];
const { changePassword, findUserByIdForUpdate } = require(repositoryPath);

test("authenticated password change locks the user and invalidates reset links", async () => {
    const requests = [];
    const client = {
        async query(query, params) {
            requests.push({ query, params });
            return { rows: [{ id: 7, password: "old-hash" }] };
        },
    };

    await findUserByIdForUpdate(7, client);
    await changePassword({ userId: 7, hashedPassword: "new-hash" }, client);

    assert.match(requests[0].query, /FOR UPDATE/);
    assert.deepEqual(requests[0].params, [7]);
    assert.match(requests[1].query, /password_setup_nonce = NULL/);
    assert.deepEqual(requests[1].params, ["new-hash", 7]);
});
