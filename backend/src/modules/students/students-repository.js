const { db } = require("../../config");
const { ERROR_MESSAGES } = require("../../constants");
const { ApiError, processDBRequest } = require("../../utils");

const findStudentById = async (id) => {
    const query = `
        SELECT
            u.id,
            u.email,
            u.is_active AS "isActive",
            u.is_email_verified AS "isEmailVerified",
            (u.password IS NOT NULL) AS "hasPassword"
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1 AND r.name ILIKE 'student'
    `;
    const { rows } = await processDBRequest({ query, queryParams: [id] });
    return rows[0];
};

const resolveStudentAcademicValues = async ({ classValue, sectionValue }) => {
    const query = `
        SELECT
            (
                SELECT name
                FROM classes
                WHERE name = $1 OR id::text = $1
                LIMIT 1
            ) AS "className",
            (
                SELECT s.name
                FROM sections s
                WHERE (s.name = $2 OR s.id::text = $2)
                AND EXISTS (
                    SELECT 1
                    FROM classes c
                    CROSS JOIN LATERAL unnest(
                        string_to_array(COALESCE(c.sections, ''), ',')
                    ) AS allowed_section(name)
                    WHERE (c.name = $1 OR c.id::text = $1)
                    AND btrim(allowed_section.name) = s.name
                )
                LIMIT 1
            ) AS "sectionName"
    `;
    const { rows } = await processDBRequest({
        query,
        queryParams: [String(classValue), String(sectionValue)],
    });
    return rows[0];
};

const findAllStudents = async (payload) => {
    const { name, class: classFilter, className, section, roll } = payload;
    const selectedClass = classFilter || className;
    let query = `
        SELECT
            t1.id,
            t1.name,
            t1.email,
            t4.name AS role,
            t1.last_login AS "lastLogin",
            t1.is_active AS "systemAccess"
        FROM users t1
        LEFT JOIN user_profiles t3 ON t1.id = t3.user_id
        JOIN roles t4 ON t4.id = t1.role_id
        WHERE t4.name ILIKE 'student'`;
    let queryParams = [];
    if (name) {
        query += ` AND t1.name ILIKE $${queryParams.length + 1}`;
        queryParams.push(`%${name}%`);
    }
    if (selectedClass) {
        query += ` AND t3.class_name = (
            SELECT name
            FROM classes
            WHERE name = $${queryParams.length + 1} OR id::text = $${queryParams.length + 1}
            LIMIT 1
        )`;
        queryParams.push(selectedClass);
    }
    if (section) {
        query += ` AND t3.section_name = $${queryParams.length + 1}`;
        queryParams.push(section);
    }
    if (roll) {
        query += ` AND t3.roll = $${queryParams.length + 1}`;
        queryParams.push(roll);
    }

    query += ' ORDER BY t1.id';

    const { rows } = await processDBRequest({ query, queryParams });
    return rows;
};

const addOrUpdateStudent = async (payload) => {
    const query = "SELECT * FROM student_add_update($1)";
    const queryParams = [payload];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows[0];
};

const findStudentDetail = async (id) => {
    const query = `
        SELECT
            u.id,
            u.name,
            u.email,
            u.is_active AS "systemAccess",
            p.phone,
            p.gender,
            p.dob,
            p.class_name AS "class",
            p.section_name AS "section",
            p.roll,
            p.father_name AS "fatherName",
            p.father_phone AS "fatherPhone",
            p.mother_name AS "motherName",
            p.mother_phone AS "motherPhone",
            p.guardian_name AS "guardianName",
            p.guardian_phone AS "guardianPhone",
            p.relation_of_guardian as "relationOfGuardian",
            p.current_address AS "currentAddress",
            p.permanent_address AS "permanentAddress",
            p.admission_dt AS "admissionDate",
            r.name as "reporterName"
        FROM users u
        LEFT JOIN user_profiles p ON u.id = p.user_id
        LEFT JOIN users r ON u.reporter_id = r.id
        JOIN roles ur ON ur.id = u.role_id
        WHERE u.id = $1 AND ur.name ILIKE 'student'`;
    const queryParams = [id];
    const { rows } = await processDBRequest({ query, queryParams });
    return rows[0];
};

const findStudentToSetStatus = async ({ userId, reviewerId, status }) => {
    const now = new Date();
    const client = await db.connect();

    try {
        await client.query("BEGIN");
        const { rows } = await client.query(
            `
                SELECT
                    u.is_email_verified AS "isEmailVerified",
                    (u.password IS NOT NULL) AS "hasPassword"
                FROM users u
                JOIN roles r ON r.id = u.role_id
                WHERE u.id = $1 AND r.name ILIKE 'student'
                FOR UPDATE OF u
            `,
            [userId]
        );

        const student = rows[0];
        if (!student) {
            await client.query("ROLLBACK");
            return { outcome: "not_found" };
        }
        if (status === true && (!student.isEmailVerified || !student.hasPassword)) {
            await client.query("ROLLBACK");
            return { outcome: "not_ready" };
        }

        await client.query(
            `
                UPDATE users
                SET
                    is_active = $1,
                    status_last_reviewed_dt = $2,
                    status_last_reviewer_id = $3
                WHERE id = $4
                AND role_id = (SELECT id FROM roles WHERE name ILIKE 'student')
            `,
            [status, now, reviewerId, userId]
        );

        if (status === false) {
            await client.query("DELETE FROM user_refresh_tokens WHERE user_id = $1", [userId]);
        }

        await client.query("COMMIT");
        return { outcome: "updated" };
    } catch (error) {
        await client.query("ROLLBACK");
        throw new ApiError(500, ERROR_MESSAGES.DATABASE_ERROR);
    } finally {
        client.release();
    }
};

const deleteStudentById = async (id) => {
    const client = await db.connect();

    try {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            try {
                await client.query("BEGIN");

                const { rows } = await client.query(
                    `
                        SELECT u.id
                        FROM users u
                        JOIN roles r ON r.id = u.role_id
                        WHERE u.id = $1 AND r.name ILIKE 'student'
                        FOR UPDATE OF u
                    `,
                    [id]
                );

                if (!rows[0]) {
                    await client.query("ROLLBACK");
                    return 0;
                }

                // Remove owned data and detach optional audit references atomically.
                await client.query("UPDATE users SET status_last_reviewer_id = NULL WHERE status_last_reviewer_id = $1", [id]);
                await client.query("UPDATE user_leaves SET approver_id = NULL WHERE approver_id = $1", [id]);
                await client.query("UPDATE notices SET author_id = NULL WHERE author_id = $1", [id]);
                await client.query("UPDATE notices SET reviewer_id = NULL WHERE reviewer_id = $1", [id]);
                await client.query("UPDATE class_teachers SET teacher_id = NULL WHERE teacher_id = $1", [id]);
                await client.query("DELETE FROM user_leave_policy WHERE user_id = $1", [id]);
                await client.query("DELETE FROM user_leaves WHERE user_id = $1", [id]);
                await client.query("DELETE FROM user_profiles WHERE user_id = $1", [id]);

                const { rowCount } = await client.query("DELETE FROM users WHERE id = $1", [id]);
                await client.query("COMMIT");
                return rowCount;
            } catch (error) {
                await client.query("ROLLBACK");
                if (error.code !== "40P01" || attempt === 2) {
                    throw error;
                }
            }
        }
    } catch (error) {
        throw new ApiError(500, ERROR_MESSAGES.DATABASE_ERROR);
    } finally {
        client.release();
    }
};

module.exports = {
    findStudentById,
    resolveStudentAcademicValues,
    findAllStudents,
    addOrUpdateStudent,
    findStudentDetail,
    findStudentToSetStatus,
    deleteStudentById,
};
