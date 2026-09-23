const { db } = require("../../config");
const { processDBRequest } = require("../../utils");

const findUserByUsername = async (username, client) => {
    // Lock the user before refresh-token rows so login and session revocation
    // always acquire locks in the same order.
    const query = "SELECT * FROM users WHERE email = $1 FOR UPDATE";
    const { rows } = await client.query(query, [username]);
    return rows[0];
};

const invalidateRefreshToken = async (token) => {
    const query = "DELETE FROM user_refresh_tokens WHERE token = $1";
    const queryParams = [token];
    const { rowCount } = await processDBRequest({ query, queryParams });
    return rowCount;
}

const findUserByRefreshToken = async (refreshToken) => {
    const query = `
        SELECT u.* 
        FROM users u
        JOIN user_refresh_tokens rt ON u.id = rt.user_id
        WHERE rt.token = $1`;
    const { rows } = await db.query(query, [refreshToken]);
    return rows[0];
};

const updateUserRefreshToken = async (newRefreshToken, expiresAt, userId, oldRefreshToken) => {
    const query = `
    UPDATE user_refresh_tokens
    SET token = $1, expires_at = $2
    WHERE user_id = $3 AND token = $4`;
    await db.query(query, [newRefreshToken, expiresAt, userId, oldRefreshToken]);
};

const getMenusByRoleId = async (roleId, client) => {
    const isUserAdmin = Number(roleId) === 1 ? true : false;
    const query = isUserAdmin
        ? `SELECT * FROM access_controls`
        : `
            SELECT
                ac.id,
                ac.name,
                ac.path,
                ac.icon,
                ac.parent_path,
                ac.hierarchy_id,
                ac.type
            FROM permissions p
            JOIN access_controls ac ON p.access_control_id = ac.id
            WHERE p.role_id = $1
        `;
    const queryParams = isUserAdmin ? [] : [roleId];
    const { rows } = await client.query(query, queryParams);
    return rows;
}

const getRoleNameByRoleId = async (id, client) => {
    const query = "SELECT lower(name) AS name from roles WHERE id = $1";
    const queryParams = [id];
    const { rows } = await client.query(query, queryParams);
    return rows[0].name;
}

const saveUserLastLoginDate = async (userId, client) => {
    const now = new Date();
    const query = `UPDATE users SET last_login = $1 WHERE id = $2`;
    const queryParams = [now, userId];
    await client.query(query, queryParams);
}

const deleteOldRefreshTokenByUserId = async (userId, client) => {
    const query = `DELETE FROM user_refresh_tokens WHERE user_id = $1`;
    const queryParams = [userId];
    await client.query(query, queryParams);
}

const isEmailVerified = async (id, email) => {
    const query = 'SELECT is_email_verified FROM users WHERE id = $1 AND email = $2';
    const queryParams = [id, email];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows[0]?.is_email_verified;
}

const verifyAccountEmail = async (id, email) => {
    const query = `
        UPDATE users
        SET is_email_verified = true
        WHERE id = $1 AND email = $2 AND is_email_verified = false
        RETURNING *
    `;
    const queryParams = [id, email];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows[0];
}

const doesEmailExist = async (id, email) => {
    const query = `SELECT email FROM users WHERE email = $1 AND id = $2`;
    const queryParams = [email, id];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows[0]
}

const setupUserPassword = async (payload) => {
    const { userId, userEmail, nonce, password } = payload;
    const query = `
        WITH updated_user AS (
            UPDATE users
            SET
                password = $1,
                password_setup_nonce = NULL,
                updated_dt = NOW()
            WHERE id = $2
              AND email = $3
              AND is_email_verified = true
              AND password_setup_nonce = $4
            RETURNING id
        ), deleted_sessions AS (
            DELETE FROM user_refresh_tokens
            WHERE user_id IN (SELECT id FROM updated_user)
            RETURNING id
        )
        SELECT COUNT(*)::INTEGER AS "updatedCount" FROM updated_user
    `;
    const queryParams = [password, userId, userEmail, nonce];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows[0]?.updatedCount || 0;
}

const setPasswordSetupNonce = async ({ userId, userEmail, nonce }) => {
    const query = `
        UPDATE users
        SET password_setup_nonce = $1
        WHERE id = $2 AND email = $3 AND is_email_verified = true
    `;
    const queryParams = [nonce, userId, userEmail];
    const { rowCount } = await processDBRequest({ query, queryParams });
    return rowCount;
}

module.exports = {
    findUserByUsername,
    invalidateRefreshToken,
    findUserByRefreshToken,
    updateUserRefreshToken,
    getMenusByRoleId,
    getRoleNameByRoleId,
    saveUserLastLoginDate,
    deleteOldRefreshTokenByUserId,
    isEmailVerified,
    verifyAccountEmail,
    doesEmailExist,
    setupUserPassword,
    setPasswordSetupNonce,
};
