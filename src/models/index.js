import { Sequelize } from "sequelize";

import config from "../config/config.js";

import UserModel from "./user.model.js";

import RoleModel from "./role.model.js";

import UnverifiedUserModel from "./unverifiedUser.model.js";

import CaseModel from "./case.model.js";

import CaseworkerProfileModel from "./caseworkerProfile.model.js";

import AdminUserPreferenceModel from "./adminUserPreference.model.js";

import VisaTypeModel from "./visaType.model.js";

import PetitionTypeModel from "./petitionType.model.js";

import CaseCategoryModel from "./caseCategory.model.js";

import EmailTemplateSettingModel from "./emailTemplateSetting.model.js";

import SlaSettingModel from "./slaSetting.model.js";
import SlaRuleModel from "./slaRule.model.js";
import PaymentSettingModel from "./paymentSetting.model.js";
import EscalationModel from "./escalation.model.js";
import PermissionModel from "./permission.model.js";
import RolePermissionModel from "./rolePermission.model.js";

import DocumentModel from "./document.model.js";
import CaseDocumentModel from "./caseDocument.model.js";

import CasePaymentModel from "./casePayment.model.js";

import CaseTimelineModel from "./caseTimeline.model.js";

import CaseCommunicationModel from "./caseCommunication.model.js";

import CaseNoteModel from "./caseNote.model.js";

import TaskModel from "./task.model.js";

import ApplicationFieldSettingModel from "./applicationFieldSetting.model.js";

import ApplicationCustomFieldModel from "./applicationCustomField.model.js";

import MessageModel from "./message.model.js";

import ConversationModel from "./conversation.model.js";

import RescheduleHistoryModel from "./rescheduleHistory.model.js";

import NotificationModel from "./notification.model.js";

import DepartmentModel from "./department.model.js";
import CandidateAccountSettingsModel from "./candidateAccountSettings.model.js";

import CandidateFeedbackModel from "./candidateFeedback.model.js";

import CandidateApplicationModel from "./candidateApplication.model.js";

import SponsorProfileModel from "./sponsorProfile.model.js";

import AuditLogModel from "./auditLog.model.js";

const env = process.env.NODE_ENV || "development";

const dbConfig = config[env];

const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  dbConfig,
);

const db = {};

db.Sequelize = Sequelize;

db.sequelize = sequelize;

db.User = UserModel(sequelize, Sequelize.DataTypes);

db.Role = RoleModel(sequelize, Sequelize.DataTypes);

db.UnverifiedUser = UnverifiedUserModel(sequelize, Sequelize.DataTypes);

db.Case = CaseModel(sequelize, Sequelize.DataTypes);

db.CaseworkerProfile = CaseworkerProfileModel(sequelize, Sequelize.DataTypes);

db.AdminUserPreference = AdminUserPreferenceModel(
  sequelize,
  Sequelize.DataTypes,
);

db.AuditLog = AuditLogModel(sequelize, Sequelize.DataTypes);

db.VisaType = VisaTypeModel(sequelize, Sequelize.DataTypes);

db.PetitionType = PetitionTypeModel(sequelize, Sequelize.DataTypes);

db.CaseCategory = CaseCategoryModel(sequelize, Sequelize.DataTypes);

db.EmailTemplateSetting = EmailTemplateSettingModel(
  sequelize,
  Sequelize.DataTypes,
);

db.SlaSetting = SlaSettingModel(sequelize, Sequelize.DataTypes);
db.SlaRule = SlaRuleModel(sequelize, Sequelize.DataTypes);
db.PaymentSetting = PaymentSettingModel(sequelize, Sequelize.DataTypes);
db.Escalation = EscalationModel(sequelize, Sequelize.DataTypes);
db.Permission = PermissionModel(sequelize, Sequelize.DataTypes);
db.RolePermission = RolePermissionModel(sequelize, Sequelize.DataTypes);

db.Document = DocumentModel(sequelize, Sequelize.DataTypes);
db.CaseDocument = CaseDocumentModel(sequelize, Sequelize.DataTypes);

db.CasePayment = CasePaymentModel(sequelize, Sequelize.DataTypes);

db.CaseTimeline = CaseTimelineModel(sequelize, Sequelize.DataTypes);

db.CaseCommunication = CaseCommunicationModel(sequelize, Sequelize.DataTypes);

db.CaseNote = CaseNoteModel(sequelize, Sequelize.DataTypes);

db.Task = TaskModel(sequelize, Sequelize.DataTypes);

db.ApplicationFieldSetting = ApplicationFieldSettingModel(
  sequelize,
  Sequelize.DataTypes,
);
db.ApplicationCustomField = ApplicationCustomFieldModel(
  sequelize,
  Sequelize.DataTypes,
);
db.Message = MessageModel(sequelize, Sequelize.DataTypes);
db.Conversation = ConversationModel(sequelize, Sequelize.DataTypes);
db.RescheduleHistory = RescheduleHistoryModel(sequelize, Sequelize.DataTypes);

db.Notification = NotificationModel(sequelize, Sequelize.DataTypes);

db.Department = DepartmentModel(sequelize, Sequelize.DataTypes);
db.CandidateAccountSettings = CandidateAccountSettingsModel(
  sequelize,
  Sequelize.DataTypes,
);

db.CandidateFeedback = CandidateFeedbackModel(sequelize, Sequelize.DataTypes);

db.CandidateApplication = CandidateApplicationModel(
  sequelize,
  Sequelize.DataTypes,
);

db.SponsorProfile = SponsorProfileModel(sequelize, Sequelize.DataTypes);

// Associations

db.Conversation.belongsTo(db.User, {
  foreignKey: "participantOneId",
  as: "participantOne",
});
db.Conversation.belongsTo(db.User, {
  foreignKey: "participantTwoId",
  as: "participantTwo",
});
db.Conversation.belongsTo(db.Case, { foreignKey: "caseId", as: "case" });
db.Conversation.hasMany(db.Message, {
  foreignKey: "conversationId",
  as: "messages",
});

db.Message.belongsTo(db.Conversation, {
  foreignKey: "conversationId",
  as: "conversation",
});

db.Role.hasMany(db.User, { foreignKey: "role_id", as: "users" });

db.User.belongsTo(db.Role, { foreignKey: "role_id", as: "role" });

db.Role.hasMany(db.UnverifiedUser, { foreignKey: "role_id" });

db.UnverifiedUser.belongsTo(db.Role, { foreignKey: "role_id" });

db.User.hasOne(db.CaseworkerProfile, {
  foreignKey: "user_id",
  as: "caseworkerProfile",
});

db.CaseworkerProfile.belongsTo(db.User, { foreignKey: "user_id" });

db.User.hasOne(db.AdminUserPreference, {
  foreignKey: "user_id",
  as: "adminPreferences",
});

db.AdminUserPreference.belongsTo(db.User, { foreignKey: "user_id" });

// Case associations
db.Case.belongsTo(db.User, { foreignKey: "candidateId", as: "candidate" });
db.Case.belongsTo(db.User, { foreignKey: "sponsorId", as: "sponsor" });
db.Case.belongsTo(db.VisaType, { foreignKey: "visaTypeId", as: "visaType" });
db.Case.belongsTo(db.PetitionType, {
  foreignKey: "petitionTypeId",
  as: "petitionType",
});
db.Case.belongsTo(db.Department, { foreignKey: "departmentId", as: "department" });
db.Department.hasMany(db.Case, { foreignKey: "departmentId", as: "cases" });

// User has many cases (as candidate or sponsor)
db.User.hasMany(db.Case, { foreignKey: "candidateId", as: "cases" });

// Case has many relationships
db.Case.hasMany(db.Document, { foreignKey: "caseId", as: "documents" });
db.Case.hasMany(db.CasePayment, { foreignKey: "caseId", as: "payments" });
db.Case.hasMany(db.CaseTimeline, { foreignKey: "caseId", as: "timeline" });
db.Case.hasMany(db.CaseCommunication, {
  foreignKey: "caseId",
  as: "communications",
});
db.Case.hasMany(db.CaseNote, { foreignKey: "caseId", as: "caseNotes" });

// Document associations
db.Document.belongsTo(db.User, { foreignKey: "userId", as: "user" });
db.Document.belongsTo(db.User, { foreignKey: "uploadedBy", as: "uploader" });
db.Document.belongsTo(db.User, { foreignKey: "reviewedBy", as: "reviewer" });
db.Document.belongsTo(db.Case, { foreignKey: "caseId", as: "case" });

// User associations with Documents
db.User.hasMany(db.Document, { foreignKey: "userId", as: "documents" });
db.User.hasMany(db.Document, {
  foreignKey: "uploadedBy",
  as: "uploadedDocuments",
});
db.User.hasMany(db.Document, {
  foreignKey: "reviewedBy",
  as: "reviewedDocuments",
});

db.Message.belongsTo(db.User, { foreignKey: "senderId", as: "sender" });
db.Message.belongsTo(db.User, { foreignKey: "receiverId", as: "receiver" });
db.User.hasMany(db.Message, { foreignKey: "senderId", as: "sentMessages" });
db.User.hasMany(db.Message, {
  foreignKey: "receiverId",
  as: "receivedMessages",
});

db.CasePayment.belongsTo(db.Case, { foreignKey: "caseId" });
db.CasePayment.belongsTo(db.User, { foreignKey: "receivedBy", as: "receiver" });

db.CaseTimeline.belongsTo(db.Case, { foreignKey: "caseId" });
db.CaseTimeline.belongsTo(db.User, {
  foreignKey: "performedBy",
  as: "performer",
});

db.CaseCommunication.belongsTo(db.Case, { foreignKey: "caseId" });
db.CaseCommunication.belongsTo(db.User, {
  foreignKey: "senderId",
  as: "sender",
});
db.CaseCommunication.belongsTo(db.User, {
  foreignKey: "recipientId",
  as: "recipient",
});

db.CaseNote.belongsTo(db.Case, { foreignKey: "caseId", as: "case" });
db.CaseNote.belongsTo(db.User, { foreignKey: "authorId", as: "author" });
db.CaseNote.belongsTo(db.CaseNote, {
  foreignKey: "parentNoteId",
  as: "parentNote",
});

// Task associations
db.Task.belongsTo(db.User, { foreignKey: 'assigned_to', as: 'assignee' });
db.Task.belongsTo(db.User, { foreignKey: 'created_by', as: 'creator' });
db.Task.belongsTo(db.Case, { foreignKey: 'case_id', as: 'case' });
db.User.hasMany(db.Task, { foreignKey: 'assigned_to', as: 'assignedTasks' });
db.User.hasMany(db.Task, { foreignKey: 'created_by', as: 'createdTasks' });
db.Case.hasMany(db.Task, { foreignKey: 'case_id', as: 'tasks' });

// Removed obsolete associations for assignedToId and createdById

// Escalation associations
db.Escalation.belongsTo(db.User, {
  foreignKey: "assignedAdminId",
  as: "assignedAdmin",
});
db.User.hasMany(db.Escalation, {
  foreignKey: "assignedAdminId",
  as: "assignedEscalations",
});

db.Escalation.belongsTo(db.Case, {
  foreignKey: "relatedCaseId",
  as: "relatedCase",
});
db.Case.hasMany(db.Escalation, {
  foreignKey: "relatedCaseId",
  as: "escalations",
});

// Reschedule history associations
db.RescheduleHistory.belongsTo(db.Case, { foreignKey: "caseId", as: "case" });
db.RescheduleHistory.belongsTo(db.User, {
  foreignKey: "createdById",
  as: "createdBy",
});
db.Case.hasMany(db.RescheduleHistory, {
  foreignKey: "caseId",
  as: "rescheduleHistory",
});
db.User.hasMany(db.RescheduleHistory, {
  foreignKey: "createdById",
  as: "rescheduleHistory",
});

// Permission associations
db.Role.belongsToMany(db.Permission, {
  through: db.RolePermission,
  foreignKey: "role_id",
  otherKey: "permission_id",
  as: "permissions",
});
db.Permission.belongsToMany(db.Role, {
  through: db.RolePermission,
  foreignKey: "permission_id",
  otherKey: "role_id",
  as: "roles",
});

// Notification associations
db.Notification.belongsTo(db.User, { foreignKey: "userId", as: "user" });
db.Notification.belongsTo(db.Role, { foreignKey: "roleId", as: "role" });
db.User.hasMany(db.Notification, { foreignKey: "userId", as: "notifications" });
db.Role.hasMany(db.Notification, { foreignKey: "roleId", as: "notifications" });

db.User.hasOne(db.CandidateAccountSettings, {
  foreignKey: "user_id",
  as: "candidateAccountSettings",
});
db.CandidateAccountSettings.belongsTo(db.User, {
  foreignKey: "user_id",
  as: "user",
});

db.User.hasMany(db.CandidateFeedback, {
  foreignKey: "user_id",
  as: "candidateFeedbacks",
});
db.CandidateFeedback.belongsTo(db.User, { foreignKey: "user_id", as: "user" });

// Candidate Application associations
db.User.hasOne(db.CandidateApplication, {
  foreignKey: "userId",
  as: "application",
});
db.CandidateApplication.belongsTo(db.User, {
  foreignKey: "userId",
  as: "user",
});
// Sponsor Profile associations
db.User.hasOne(db.SponsorProfile, {
  foreignKey: "userId",
  as: "sponsorProfile",
});
db.SponsorProfile.belongsTo(db.User, { foreignKey: "userId", as: "user" });

export default db;

// Audit Log Associations
db.User.hasMany(db.AuditLog, { foreignKey: 'user_id', as: 'auditLogs' });
db.AuditLog.belongsTo(db.User, { foreignKey: 'user_id', as: 'user' });

