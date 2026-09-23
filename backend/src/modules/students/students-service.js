const { ApiError, sendAccountVerificationEmail } = require("../../utils");
const {
    findAllStudents,
    findStudentById,
    findStudentDetail,
    findStudentToSetStatus,
    addOrUpdateStudent,
    deleteStudentById,
    resolveStudentAcademicValues,
} = require("./students-repository");

const checkStudentId = async (id) => {
    const student = await findStudentById(id);
    if (!student) {
        throw new ApiError(404, "Student not found");
    }
    return student;
};

const throwMutationError = (message) => {
    if (/email already exists/i.test(message)) {
        throw new ApiError(409, message);
    }
    if (/student not found/i.test(message)) {
        throw new ApiError(404, message);
    }
    if (/invalid class or section/i.test(message)) {
        throw new ApiError(422, message);
    }
    throw new ApiError(500, message);
};

const normalizeAcademicValues = async (payload) => {
    const academicValues = await resolveStudentAcademicValues({
        classValue: payload.class,
        sectionValue: payload.section,
    });
    if (!academicValues?.className || !academicValues?.sectionName) {
        throw new ApiError(422, "Invalid class or section");
    }

    return {
        ...payload,
        class: academicValues.className,
        section: academicValues.sectionName,
    };
};

const getAllStudents = async (payload) => {
    return findAllStudents(payload);
};

const getStudentDetail = async (id) => {
    await checkStudentId(id);

    const student = await findStudentDetail(id);
    if (!student) {
        throw new ApiError(404, "Student not found");
    }

    return student;
};

const addNewStudent = async (payload) => {
    const ADD_STUDENT_AND_EMAIL_SEND_SUCCESS = "Student added and verification email sent successfully.";
    const ADD_STUDENT_AND_BUT_EMAIL_SEND_FAIL = "Student added, but failed to send verification email.";
    const normalizedPayload = await normalizeAcademicValues(payload);
    const result = await addOrUpdateStudent(normalizedPayload);
    if (!result.status) {
        throwMutationError(result.message);
    }

    try {
        await sendAccountVerificationEmail({ userId: result.userId, userEmail: normalizedPayload.email });
        return { id: result.userId, message: ADD_STUDENT_AND_EMAIL_SEND_SUCCESS };
    } catch (error) {
        return { id: result.userId, message: ADD_STUDENT_AND_BUT_EMAIL_SEND_FAIL };
    }
};

const updateStudent = async (payload) => {
    await checkStudentId(payload.userId);
    const normalizedPayload = await normalizeAcademicValues(payload);

    const result = await addOrUpdateStudent(normalizedPayload);
    if (!result.status) {
        throwMutationError(result.message);
    }

    if (result.description === "email_changed") {
        try {
            await sendAccountVerificationEmail({
                userId: result.userId,
                userEmail: normalizedPayload.email,
            });
            return { message: "Student updated. Verification email sent to the new address." };
        } catch (error) {
            return { message: "Student updated, but failed to send verification email to the new address." };
        }
    }

    return { message: result.message };
};

const setStudentStatus = async ({ userId, reviewerId, status }) => {
    const result = await findStudentToSetStatus({ userId, reviewerId, status });
    if (result.outcome === "not_found") {
        throw new ApiError(404, "Student not found");
    }
    if (result.outcome === "not_ready") {
        throw new ApiError(409, "Email verification and password setup are required before enabling access");
    }

    return { message: "Student status changed successfully" };
};

const deleteStudent = async (id) => {
    const affectedRow = await deleteStudentById(id);
    if (affectedRow <= 0) {
        throw new ApiError(404, "Student not found");
    }

    return { message: "Student deleted successfully" };
};

module.exports = {
    getAllStudents,
    getStudentDetail,
    addNewStudent,
    setStudentStatus,
    updateStudent,
    deleteStudent,
};
