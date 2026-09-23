BEGIN;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS password_setup_nonce TEXT DEFAULT NULL;

CREATE OR REPLACE FUNCTION public.student_add_update(data jsonb)
RETURNS TABLE("userId" INTEGER, status boolean, message TEXT, description TEXT)
LANGUAGE 'plpgsql'
AS $BODY$
DECLARE
    _operationType VARCHAR(10);
    _reporterId INTEGER;
    _userId INTEGER;
    _name TEXT;
    _roleId INTEGER;
    _gender TEXT;
    _phone TEXT;
    _email TEXT;
    _dob DATE;
    _currentAddress TEXT;
    _permanentAddress TEXT;
    _fatherName TEXT;
    _fatherPhone TEXT;
    _motherName TEXT;
    _motherPhone TEXT;
    _guardianName TEXT;
    _guardianPhone TEXT;
    _relationOfGuardian TEXT;
    _emailChanged BOOLEAN;
    _className TEXT;
    _sectionName TEXT;
    _admissionDt DATE;
    _roll INTEGER;
    _affectedRows INTEGER;
BEGIN
    SELECT id INTO _roleId FROM roles WHERE name ILIKE 'student';
    _userId := COALESCE((data ->>'userId')::INTEGER, NULL);
    _name := COALESCE(data->>'name', NULL);
    _gender := COALESCE(data->>'gender', NULL);
    _phone := COALESCE(data->>'phone', NULL);
    _email := COALESCE(data->>'email', NULL);
    _dob := COALESCE((data->>'dob')::DATE, NULL);
    _currentAddress := COALESCE(data->>'currentAddress', NULL);
    _permanentAddress := COALESCE(data->>'permanentAddress', NULL);
    _fatherName := COALESCE(data->>'fatherName', NULL);
    _fatherPhone := COALESCE(data->>'fatherPhone', NULL);
    _motherName := COALESCE(data->>'motherName', NULL);
    _motherPhone := COALESCE(data->>'motherPhone', NULL);
    _guardianName := COALESCE(data->>'guardianName', NULL);
    _guardianPhone := COALESCE(data->>'guardianPhone', NULL);
    _relationOfGuardian := COALESCE(data->>'relationOfGuardian', NULL);
    _className := COALESCE(data->>'class', NULL);
    _sectionName := COALESCE(data->>'section', NULL);
    _admissionDt := COALESCE((data->>'admissionDate')::DATE, NULL);
    _roll := COALESCE((data->>'roll')::INTEGER, NULL);

    IF _userId IS NULL THEN
        _operationType := 'add';
    ELSE
        _operationType := 'update';
    END IF;

    IF _roleId IS NULL THEN
        RETURN QUERY
            SELECT _userId, false, 'Student role not configured', NULL::TEXT;
        RETURN;
    END IF;

    SELECT teacher_id
    FROM class_teachers
    WHERE class_name = _className AND section_name = _sectionName
    INTO _reporterId;

    IF _reporterId IS NULL THEN
        SELECT u.id
        FROM users u
        JOIN roles r ON r.id = u.role_id
        WHERE r.name ILIKE 'admin'
        ORDER BY u.id ASC
        LIMIT 1
        INTO _reporterId;
    END IF;

    IF _operationType = 'add' THEN
        IF EXISTS(SELECT 1 FROM users WHERE email = _email) THEN
            RETURN QUERY
                SELECT NULL::INTEGER, false, 'Email already exists', NULL::TEXT;
            RETURN;
        END IF;

        INSERT INTO users (name,email,role_id,created_dt,reporter_id,is_active)
        VALUES (_name,_email,_roleId,now(),_reporterId,false) RETURNING id INTO _userId;

        INSERT INTO user_profiles
        (user_id,gender,phone,dob,admission_dt,class_name,section_name,roll,current_address,permanent_address,father_name,father_phone,mother_name,mother_phone,guardian_name,guardian_phone,relation_of_guardian)
        VALUES
        (_userId,_gender,_phone,_dob,_admissionDt,_className,_sectionName,_roll,_currentAddress,_permanentAddress,_fatherName,_fatherPhone,_motherName,_motherPhone,_guardianName,_guardianPhone,_relationOfGuardian);

        RETURN QUERY
            SELECT _userId, true, 'Student added successfully', NULL;
        RETURN;
    END IF;

    PERFORM 1
    FROM users
    WHERE id = _userId AND role_id = _roleId
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY
            SELECT _userId, false, 'Student not found', NULL::TEXT;
        RETURN;
    END IF;

    PERFORM 1
    FROM user_profiles
    WHERE user_id = _userId
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY
            SELECT _userId, false, 'Student profile not found', NULL::TEXT;
        RETURN;
    END IF;

    SELECT email IS DISTINCT FROM _email
    FROM users
    WHERE id = _userId
    INTO _emailChanged;

    IF EXISTS(
        SELECT 1 FROM users WHERE email = _email AND id != _userId
    ) THEN
        RETURN QUERY
            SELECT _userId, false, 'Email already exists', NULL::TEXT;
        RETURN;
    END IF;

    UPDATE users
    SET
        name = _name,
        email = _email,
        password = CASE WHEN _emailChanged THEN NULL ELSE password END,
        password_setup_nonce = CASE WHEN _emailChanged THEN NULL ELSE password_setup_nonce END,
        is_active = CASE WHEN _emailChanged THEN false ELSE is_active END,
        is_email_verified = CASE WHEN _emailChanged THEN false ELSE is_email_verified END,
        reporter_id = _reporterId,
        updated_dt = now()
    WHERE id = _userId AND role_id = _roleId;

    GET DIAGNOSTICS _affectedRows = ROW_COUNT;
    IF _affectedRows != 1 THEN
        RAISE EXCEPTION 'Unable to update student account';
    END IF;

    UPDATE user_profiles
    SET
        gender = _gender,
        phone = _phone,
        dob = _dob,
        admission_dt = _admissionDt,
        class_name = _className,
        section_name = _sectionName,
        roll = _roll,
        current_address = _currentAddress,
        permanent_address = _permanentAddress,
        father_name = _fatherName,
        father_phone = _fatherPhone,
        mother_name = _motherName,
        mother_phone = _motherPhone,
        guardian_name = _guardianName,
        guardian_phone = _guardianPhone,
        relation_of_guardian = _relationOfGuardian
    WHERE user_id = _userId;

    GET DIAGNOSTICS _affectedRows = ROW_COUNT;
    IF _affectedRows != 1 THEN
        RAISE EXCEPTION 'Unable to update student profile';
    END IF;

    IF _emailChanged THEN
        DELETE FROM user_refresh_tokens WHERE user_id = _userId;
    END IF;

    RETURN QUERY
        SELECT
            _userId,
            true,
            'Student updated successfully',
            CASE WHEN _emailChanged THEN 'email_changed' ELSE NULL::TEXT END;
EXCEPTION
    WHEN unique_violation THEN
        RETURN QUERY
            SELECT _userId::INTEGER, false, 'Email already exists', SQLERRM;
    WHEN foreign_key_violation THEN
        RETURN QUERY
            SELECT _userId::INTEGER, false, 'Invalid class or section', SQLERRM;
    WHEN OTHERS THEN
        RETURN QUERY
            SELECT _userId::INTEGER, false, 'Unable to ' || _operationType || ' student', SQLERRM;
END;
$BODY$;

UPDATE users u
SET reporter_id = NULL
WHERE reporter_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM users reporter WHERE reporter.id = u.reporter_id
);

DO $MIGRATION$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_reporter_id_fkey'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_reporter_id_fkey
        FOREIGN KEY (reporter_id)
        REFERENCES users(id)
        ON DELETE SET NULL;
    END IF;
END;
$MIGRATION$;

INSERT INTO access_controls(
    name,
    path,
    icon,
    parent_path,
    hierarchy_id,
    type,
    method
)
VALUES (
    'Delete student',
    '/api/v1/students/:id',
    NULL,
    'students_parent',
    NULL,
    'api',
    'DELETE'
)
ON CONFLICT (path, method) DO UPDATE
SET
    name = EXCLUDED.name,
    parent_path = EXCLUDED.parent_path,
    type = EXCLUDED.type;

COMMIT;
