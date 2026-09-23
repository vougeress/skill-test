const test = require("node:test");
const assert = require("node:assert/strict");

const state = {};
const configPath = require.resolve("../src/config");
const jwtPath = require.resolve("../src/utils/jwt-handle");
const sendEmailPath = require.resolve("../src/utils/send-email");
const templatesPath = require.resolve("../src/templates");
const verificationPath = require.resolve("../src/utils/send-account-verification-email");
const passwordPath = require.resolve("../src/utils/send-password-setup-email");

require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
        env: {
            EMAIL_VERIFICATION_TOKEN_SECRET: "verification-secret",
            EMAIL_VERIFICATION_TOKEN_TIME_IN_MS: "1h",
            PASSWORD_SETUP_TOKEN_SECRET: "password-secret",
            PASSWORD_SETUP_TOKEN_TIME_IN_MS: "1h",
            API_URL: "https://api.example.com",
            UI_URL: "https://ui.example.com",
            MAIL_FROM_USER: "noreply@example.com",
        },
    },
};
require.cache[jwtPath] = {
    id: jwtPath,
    filename: jwtPath,
    loaded: true,
    exports: {
        generateToken: (payload, secret, time) => {
            state.tokens.push({ payload, secret, time });
            return "token";
        },
    },
};
require.cache[sendEmailPath] = {
    id: sendEmailPath,
    filename: sendEmailPath,
    loaded: true,
    exports: { sendMail: async () => undefined },
};
require.cache[templatesPath] = {
    id: templatesPath,
    filename: templatesPath,
    loaded: true,
    exports: {
        emailVerificationTemplate: () => "verification",
        pwdSetupTemplate: () => "password",
    },
};

delete require.cache[verificationPath];
delete require.cache[passwordPath];
const { sendAccountVerificationEmail } = require(verificationPath);
const { sendPasswordSetupEmail } = require(passwordPath);

test.beforeEach(() => {
    state.tokens = [];
});

test("verification and password tokens are bound to the target email", async () => {
    await sendAccountVerificationEmail({ userId: 7, userEmail: "student@example.com" });
    await sendPasswordSetupEmail({
        userId: 7,
        userEmail: "student@example.com",
        nonce: "one-time-nonce",
    });

    assert.equal(state.tokens.length, 2);
    assert.deepEqual(state.tokens[0].payload, { id: 7, email: "student@example.com" });
    assert.deepEqual(state.tokens[1].payload, {
        id: 7,
        email: "student@example.com",
        nonce: "one-time-nonce",
    });
});
