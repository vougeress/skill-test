const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "../..");
const tablesSql = fs.readFileSync(path.join(repositoryRoot, "seed_db/tables.sql"), "utf8");
const migrationSql = fs.readFileSync(
    path.join(repositoryRoot, "seed_db/migrations/001_complete_student_crud.sql"),
    "utf8"
);

for (const [name, sql] of [
    ["bootstrap schema", tablesSql],
    ["existing-database migration", migrationSql],
]) {
    test(`${name} keeps create inactive and makes update concurrency-safe`, () => {
        assert.match(sql, /INSERT INTO users \(name,email,role_id,created_dt,reporter_id,is_active\)/);
        assert.match(sql, /VALUES \(_name,_email,_roleId,now\(\),_reporterId,false\)/);
        assert.match(sql, /WHERE id = _userId AND role_id = _roleId\s+FOR UPDATE/);
        assert.match(sql, /WHERE user_id = _userId\s+FOR UPDATE/);
        assert.match(sql, /GET DIAGNOSTICS _affectedRows = ROW_COUNT/);
        assert.match(sql, /WHEN unique_violation THEN/);
        assert.match(sql, /r\.name ILIKE 'admin'/);
        assert.match(sql, /Student role not configured/);
        assert.match(sql, /email IS DISTINCT FROM _email/);
        assert.match(sql, /password = CASE WHEN _emailChanged THEN NULL ELSE password END/);
        assert.match(sql, /password_setup_nonce = CASE WHEN _emailChanged THEN NULL/);
        assert.match(sql, /is_email_verified = CASE WHEN _emailChanged THEN false/);
        assert.match(sql, /DELETE FROM user_refresh_tokens\s+WHERE user_id = _userId/);
        assert.match(sql, /'email_changed'/);
        assert.match(sql, /WHEN foreign_key_violation THEN/);
        assert.match(sql, /Invalid class or section/);
    });
}

test("migration can be applied repeatedly and includes DELETE access control", () => {
    assert.match(migrationSql, /^BEGIN;/);
    assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS password_setup_nonce TEXT/);
    assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.student_add_update/);
    assert.match(migrationSql, /ON CONFLICT \(path, method\) DO UPDATE/);
    assert.match(migrationSql, /'\/api\/v1\/students\/:id'/);
    assert.match(migrationSql, /'DELETE'/);
    assert.match(migrationSql, /ADD CONSTRAINT users_reporter_id_fkey/);
    assert.match(migrationSql, /ON DELETE SET NULL/);
    assert.match(migrationSql, /COMMIT;\s*$/);
});
