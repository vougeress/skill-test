const { z } = require("zod");

const POSTGRES_INTEGER_MAX = 2147483647;
const positiveId = z.coerce
    .number()
    .int()
    .positive("ID must be a positive integer")
    .max(POSTGRES_INTEGER_MAX, "ID exceeds the supported range");
const dateString = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format")
    .refine((value) => {
        const parsedDate = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value;
    }, "Invalid calendar date");
const optionalPhone = z.string().max(20).optional().or(z.literal(""));
const rollNumber = z.union([
    z.number().int().nonnegative().max(POSTGRES_INTEGER_MAX),
    z
        .string()
        .refine(
            (value) => /^\d+$/.test(value) && BigInt(value) <= BigInt(POSTGRES_INTEGER_MAX),
            "Roll must be a non-negative PostgreSQL integer"
        ),
]);

const StudentBodySchema = z.object({
    name: z.string().trim().min(1, "Name is required").max(100),
    gender: z.string().trim().min(1, "Gender is required").max(10),
    dob: dateString,
    phone: z.string().trim().min(1, "Phone is required").max(20),
    email: z.string().trim().email("A valid email is required").max(100),
    class: z.string().trim().min(1, "Class is required").max(50),
    section: z.string().trim().min(1, "Section is required").max(50),
    roll: rollNumber,
    admissionDate: dateString,
    fatherName: z.string().trim().min(1, "Father name is required").max(50),
    fatherPhone: optionalPhone,
    motherName: z.string().max(50).optional().or(z.literal("")),
    motherPhone: optionalPhone,
    guardianName: z.string().trim().min(1, "Guardian name is required").max(50),
    guardianPhone: z.string().trim().min(1, "Guardian phone is required").max(20),
    relationOfGuardian: z.string().trim().min(1, "Guardian relation is required").max(30),
    currentAddress: z.string().trim().min(1, "Current address is required").max(50),
    permanentAddress: z.string().trim().min(1, "Permanent address is required").max(50),
});

const StudentIdSchema = z.object({
    params: z.object({ id: positiveId }),
});

const GetStudentsSchema = z.object({
    query: z.object({
        name: z.string().trim().max(100).optional(),
        class: z.string().trim().max(50).optional(),
        className: z.string().trim().max(50).optional(),
        section: z.string().trim().max(50).optional(),
        roll: rollNumber.optional(),
    }),
});

const CreateStudentSchema = z.object({
    // Access is managed only by the audited status endpoint.
    body: StudentBodySchema,
});

const UpdateStudentSchema = z.object({
    params: z.object({ id: positiveId }),
    body: StudentBodySchema,
});

const SetStudentStatusSchema = z.object({
    params: z.object({ id: positiveId }),
    body: z.object({ status: z.boolean() }),
});

module.exports = {
    StudentIdSchema,
    GetStudentsSchema,
    CreateStudentSchema,
    UpdateStudentSchema,
    SetStudentStatusSchema,
};
