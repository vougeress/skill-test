const express = require("express");
const router = express.Router();
const studentController = require("./students-controller");
const { checkApiAccess } = require("../../middlewares");
const { validateRequest } = require("../../utils");
const {
    StudentIdSchema,
    GetStudentsSchema,
    CreateStudentSchema,
    UpdateStudentSchema,
    SetStudentStatusSchema,
} = require("./students-schema");

router.get("", validateRequest(GetStudentsSchema), checkApiAccess, studentController.handleGetAllStudents);
router.post("", validateRequest(CreateStudentSchema), checkApiAccess, studentController.handleAddStudent);
router.get("/:id", validateRequest(StudentIdSchema), checkApiAccess, studentController.handleGetStudentDetail);
router.post("/:id/status", validateRequest(SetStudentStatusSchema), checkApiAccess, studentController.handleStudentStatus);
router.put("/:id", validateRequest(UpdateStudentSchema), checkApiAccess, studentController.handleUpdateStudent);
router.delete("/:id", validateRequest(StudentIdSchema), checkApiAccess, studentController.handleDeleteStudent);

module.exports = { studentsRoutes: router };
